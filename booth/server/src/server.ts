import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const env = process.env
const port = Number(env.PORT ?? 8790)
const key = env.CREAO_API_KEY ?? ''
const appId = env.CREAO_APP_ID ?? ''
const field = env.CREAO_INPUT_FIELD ?? 'request'
const testEmail = env.TEST_EMAIL ?? ''
const sendToRep = env.SEND_TO_REP === '1'
const base = 'https://agent.creao.ai/api/v1/apps'

const dataDir = new URL('../data/', import.meta.url)
const resume = readFileSync(new URL('resume.txt', dataDir), 'utf8')
const sponsors: string[] = JSON.parse(readFileSync(new URL('sponsors.json', dataDir), 'utf8'))
const stateFile = new URL('state.json', dataDir)
const reps: Record<string, { rep: string; repEmail?: string }> = JSON.parse(readFileSync(new URL('reps.json', dataDir), 'utf8'))

export interface Brief {
  company: string
  match: number
  role: string
  rep: string
  repEmail?: string
  points: string[]
  why: string
}
type RunState = { id: string; status: string; startedAt: number; endedAt?: number; error?: string; summary?: string }
interface State {
  briefs: Brief[]
  prep?: RunState
  followups: Record<string, RunState & { to: string }>
}
const state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { briefs: [], followups: {} }
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 1))

async function creao(path: string, init?: RequestInit) {
  const r = await fetch(`${base}/${appId}/runs${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`CREAO ${r.status} ${JSON.stringify(body)}`)
  return body as { id: string; status: string; result?: { text?: string; chatText?: string }; errorCode?: string }
}

async function startRun(request: string) {
  const run = await creao('', { method: 'POST', body: JSON.stringify({ inputs: { [field]: request } }) })
  return run.id
}

async function waitRun(id: string, rs: RunState) {
  for (;;) {
    await new Promise(r => setTimeout(r, 4000))
    const run = await creao(`/${id}`)
    rs.status = run.status
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      rs.endedAt = Date.now()
      if (run.status !== 'completed') rs.error = run.errorCode ?? run.status
      save()
      return run.result?.text ?? run.result?.chatText ?? ''
    }
  }
}

function lastJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map(m => m[1])
  for (const c of [...fenced.reverse(), text]) {
    const s = c.indexOf('{'), e = c.lastIndexOf('}')
    if (s < 0 || e < s) continue
    try {
      return JSON.parse(c.slice(s, e + 1))
    } catch {}
  }
  throw new Error('no JSON in agent result')
}

const prepRequest = () => `MODE: PREP_BRIEFS
You are Booth Brief. The candidate below is at the LA Hacks AI Hackathon 2026 (UCLA, Oct 17-18, 2026) and will walk the sponsor booths.
For EACH sponsor: research the web for current open roles (internships or new grad) that fit this resume, recent company news from the last 3 months, and who from the company is at or tied to this event (a recruiter, DevRel or engineer; use public posts about LA Hacks or the sponsor's university recruiting team). Score fit 0-100 against the resume.
Write 3 talking points per sponsor, each under 40 characters, that connect a specific resume item to the company. No em dashes.
Return ONLY one JSON object in a json code block:
{"briefs":[{"company":"","match":0,"role":"best-fit open role, under 30 chars","rep":"name and title or 'unknown'","repEmail":"public work email if found, else empty","points":["","",""],"why":"one sentence on the fit"}]}
Sorted by match, highest first.
SPONSORS: ${JSON.stringify(sponsors)}
RESUME:
${resume}`

const followupRequest = (b: Brief, to: string) => `MODE: SEND_FOLLOWUP
You are Booth Brief. The candidate just talked to ${b.company}'s booth at the LA Hacks AI Hackathon 2026 at UCLA.
Write a short follow-up email (under 120 words, no em dashes, plain and specific) from the candidate to ${b.rep}. Reference these talking points: ${JSON.stringify(b.points)} and the role "${b.role}". Attach nothing.
Send it now with the connected Gmail account to: ${to}${to !== b.repEmail ? ` (test recipient; address it to ${b.rep} as if it were going to them)` : ''}.
Then return ONLY a json code block: {"sent":true,"to":"${to}","subject":"","summary":"one line"}
Candidate resume:
${resume}`

async function prep() {
  const id = await startRun(prepRequest())
  const rs: RunState = (state.prep = { id, status: 'running', startedAt: Date.now() })
  save()
  try {
    const text = await waitRun(id, rs)
    if (rs.error) return
    const out = lastJson(text) as { briefs: Brief[] }
    state.briefs = out.briefs.map(b => ({ ...b, ...reps[b.company] })).sort((a, b) => b.match - a.match)
    rs.summary = `${state.briefs.length} briefs`
  } catch (e) {
    rs.error = String(e)
  }
  save()
}

async function followup(company: string) {
  const found = state.briefs.find(x => x.company === company)
  const b = found && { ...found, ...reps[company] }
  if (!b) throw new Error(`no brief for ${company}`)
  const to = sendToRep && b.repEmail ? b.repEmail : testEmail
  if (!to) throw new Error('set TEST_EMAIL')
  const id = await startRun(followupRequest(b, to))
  const rs: RunState & { to: string } = (state.followups[company] = { id, status: 'running', startedAt: Date.now(), to })
  save()
  try {
    const text = await waitRun(id, rs)
    if (!rs.error) rs.summary = (lastJson(text) as { summary?: string }).summary ?? 'sent'
  } catch (e) {
    rs.error = String(e)
  }
  save()
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' })
  res.end(JSON.stringify(body))
}
const readBody = (req: IncomingMessage) =>
  new Promise<any>(r => {
    let s = ''
    req.on('data', c => (s += c))
    req.on('end', () => r(s ? JSON.parse(s) : {}))
  })

createServer(async (req, res) => {
  const url = (req.url ?? '/').replace(/^\/api/, '')
  if (req.method === 'OPTIONS') return json(res, 204, {})
  try {
    if (url === '/' && req.method === 'GET' && !req.url?.startsWith('/api')) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end(readFileSync(new URL('../public/index.html', import.meta.url)))
    }
    if (url === '/state') return json(res, 200, { ...state, appId, testEmail, sendToRep })
    if (url === '/prep' && req.method === 'POST') {
      if (state.prep?.status === 'running') return json(res, 409, { error: 'prep already running' })
      void prep()
      return json(res, 202, { ok: true })
    }
    if (url === '/followup' && req.method === 'POST') {
      const { company } = await readBody(req)
      if (!state.briefs.some(b => b.company === company)) return json(res, 404, { error: `no brief for ${company}` })
      if (!testEmail && !sendToRep) return json(res, 400, { error: 'set TEST_EMAIL' })
      if (state.followups[company]?.status === 'running') return json(res, 409, { error: 'already running' })
      void followup(company).catch(e => console.error(e))
      return json(res, 202, { ok: true })
    }
    json(res, 404, { error: 'not found' })
  } catch (e) {
    json(res, 500, { error: String(e) })
  }
}).listen(port, () => console.log(`[booth] http://localhost:${port}  app ${appId || '(set CREAO_APP_ID)'}  follow-ups → ${sendToRep ? 'rep' : testEmail || '(set TEST_EMAIL)'}`))
