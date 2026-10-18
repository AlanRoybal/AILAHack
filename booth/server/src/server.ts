import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { matchRep, type Rep } from './match.ts'

const env = process.env
const port = Number(env.PORT ?? 8790)
const key = env.CREAO_API_KEY ?? ''
const apolloKey = env.APOLLO_API_KEY ?? ''
const mailerUrl = env.MAILER_URL ?? ''
const mailerToken = env.MAILER_TOKEN ?? ''
const appId = env.CREAO_APP_ID ?? ''
const field = env.CREAO_INPUT_FIELD ?? 'request'
const testEmail = env.TEST_EMAIL ?? ''
const sendToRep = env.SEND_TO_REP === '1'
const deepgramKey = env.DEEPGRAM_API_KEY ?? ''
const countdownMs = Number(env.COUNTDOWN_MS ?? 8000)
const base = env.CREAO_BASE_URL ?? 'https://agent.creao.ai/api/v1/apps'

const dataDir = new URL('../data/', import.meta.url)
const resume = readFileSync(new URL('resume.txt', dataDir), 'utf8')
const sponsors: string[] = JSON.parse(readFileSync(new URL('sponsors.json', dataDir), 'utf8'))
const reps: Record<string, Rep[]> = JSON.parse(readFileSync(new URL('reps.json', dataDir), 'utf8'))
const stateFile = new URL('state.json', dataDir)

interface Brief { company: string; match: number; role: string; rep: string; points: string[]; why: string }
interface Run { id?: string; status: string; startedAt: number; endedAt?: number; error?: string; summary?: string }
type Phase = 'drafting' | 'countdown' | 'sending' | 'sent' | 'cancelled' | 'failed'
interface Followup {
  phase: Phase
  heard: string
  rep: string
  matched: boolean
  email?: string
  to?: string
  subject?: string
  body?: string
  sendAt?: number
  error?: string
  runs: Run[]
}
interface State { briefs: Brief[]; prep?: Run; followups: Record<string, Followup> }

const state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { briefs: [], followups: {} }
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 1))
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const timers = new Map<string, NodeJS.Timeout>()

const account = key.startsWith('cr_sk_')
const agentId = env.CREAO_AGENT_ID ?? appId
const devBase = env.CREAO_DEV_URL ?? 'https://developer.creao.ai/v2'

interface CreaoRun { status: string; result?: unknown; error?: string }

/** Project keys (cr_sk_) use the Developer Platform developer.creao.ai/v2/runs; agent keys (capi_) use the app-scoped API Trigger. */
async function creao(runId: string | null, input?: Record<string, string>): Promise<CreaoRun & { id: string }> {
  if (!key || !agentId) throw new Error('set CREAO_API_KEY and CREAO_AGENT_ID')
  const url = account
    ? `${devBase}/runs${runId ? `/${runId}` : ''}`
    : `${base}/${agentId}/runs${runId ? `/${runId}` : ''}`
  const body = input && JSON.stringify(account ? { agent_id: agentId, input } : { inputs: input })
  const r = await fetch(url, {
    method: input ? 'POST' : 'GET',
    body,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`CREAO ${r.status} ${JSON.stringify(j)}`)
  return { id: j.run_id ?? j.id, status: j.status, result: j.result, error: j.error?.code ?? j.errorCode }
}

const resultText = (res: any): string =>
  typeof res === 'string' ? res : res?.chat_text ?? res?.chatText ?? res?.text ?? res?.output ?? JSON.stringify(res ?? '')

/** Starts a CREAO run, polls it to the end and returns the JSON block from its reply. */
async function run(request: string, rs: Run): Promise<any> {
  const started = await creao(null, { [field]: request })
  rs.id = started.id
  rs.status = started.status
  save()
  for (;;) {
    await new Promise(r => setTimeout(r, 3000))
    const r = await creao(rs.id!)
    rs.status = r.status
    if (!['completed', 'failed', 'cancelled'].includes(r.status)) continue
    rs.endedAt = Date.now()
    if (r.status !== 'completed') throw new Error(r.error ?? r.status)
    return lastJson(resultText(r.result))
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
You are Booth Brief. The candidate below is at the LA Hacks AI Hackathon 2026 at UCLA and will walk the sponsor booths.
For EACH sponsor: research the web for current open roles (internships or new grad) that fit this resume, recent company news from the last 3 months, and who from the company is at the event. Known booth staff: ${JSON.stringify(reps)}. Score fit 0-100 against the resume.
Write 3 talking points per sponsor, each under 32 characters, that connect a specific resume item to the company. No em dashes.
Return ONLY one JSON object in a json code block:
{"briefs":[{"company":"","match":0,"role":"best-fit open role, under 30 chars","rep":"who to ask for, under 24 chars","points":["","",""],"why":"one sentence on the fit"}]}
SPONSORS: ${JSON.stringify(sponsors)}
RESUME:
${resume}`

const draftRequest = (b: Brief, rep: string) => `MODE: FIND_AND_DRAFT
You are Booth Brief. The candidate just talked to ${rep} at ${b.company}'s booth at the LA Hacks AI Hackathon 2026 at UCLA.
1. Find ${rep}'s work email with Apollo.io: in your sandbox, call POST https://api.apollo.io/api/v1/people/match with header "x-api-key: ${apolloKey}" and JSON {"name": "${rep}", "organization_name": "${b.company}", "reveal_personal_emails": false}. If there is no match, search https://api.apollo.io/api/v1/mixed_people/api_search for the company (it returns ids but no emails), pick the closest name, then call people/match with {"id": <that person id>}.
2. Write a short follow-up email (under 120 words, no em dashes, plain and specific) from the candidate to ${rep}, referencing ${JSON.stringify(b.points)} and the role "${b.role}".
Do NOT send anything. Return ONLY a json code block:
Nothing is attached to the email, so do not mention an attachment.
{"email":"found address or empty","apolloName":"name on the Apollo record","subject":"","body":""}
Candidate resume:
${resume}`

const sendRequest = (f: Followup) => `MODE: SEND_EMAIL
Send this email now, exactly as written, to ${f.to}, by calling the Booth Brief mail service from your sandbox:
POST ${mailerUrl.replace(/\/$/, '')}/send with headers "Authorization: Bearer ${mailerToken}" and "Content-Type: application/json" and this JSON body:
${JSON.stringify({ to: f.to, subject: f.subject, body: f.body })}
Build the request body from that JSON unchanged. Then return ONLY a json code block: {"sent":true,"to":"${f.to}"}, or {"sent":false,"error":"the service's error"} if it did not return sent:true.`

async function prep() {
  const rs: Run = (state.prep = { status: 'pending', startedAt: Date.now() })
  try {
    const out = (await run(prepRequest(), rs)) as { briefs: Brief[] }
    state.briefs = out.briefs.sort((a, b) => b.match - a.match)
    rs.summary = `${state.briefs.length} briefs`
  } catch (e) {
    rs.error = errText(e)
  }
  save()
}

async function transcribe(pcm: Buffer, names: string[]) {
  if (!deepgramKey) throw new Error('set DEEPGRAM_API_KEY or type the name')
  const q = new URLSearchParams({ model: 'nova-3', encoding: 'linear16', sample_rate: '16000', channels: '1', smart_format: 'true' })
  for (const n of names) q.append('keyterm', n)
  const r = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: 'POST',
    headers: { Authorization: `Token ${deepgramKey}`, 'Content-Type': 'audio/l16' },
    body: new Uint8Array(pcm),
  })
  if (!r.ok) throw new Error(`Deepgram ${r.status}`)
  const j = (await r.json()) as any
  return (j.results?.channels?.[0]?.alternatives?.[0]?.transcript as string) ?? ''
}

async function draft(company: string, heard: string) {
  const b = state.briefs.find(x => x.company === company)!
  const m = matchRep(heard, reps[company] ?? [])
  const f: Followup = (state.followups[company] = { phase: 'drafting', heard, rep: m?.rep.name ?? heard, matched: !!m, runs: [] })
  const rs: Run = { status: 'pending', startedAt: Date.now() }
  f.runs.push(rs)
  save()
  try {
    const out = (await run(draftRequest(b, f.rep), rs)) as { email?: string; subject: string; body: string }
    if (!out?.subject || !out?.body) throw new Error('CREAO returned no draft')
    Object.assign(f, { email: out.email || undefined, subject: out.subject, body: out.body })
    f.to = sendToRep ? f.email : testEmail
    if (!f.to) throw new Error(sendToRep ? 'Apollo found no email' : 'set TEST_EMAIL')
    f.phase = 'countdown'
    f.sendAt = Date.now() + countdownMs
    timers.set(company, setTimeout(() => void send(company), countdownMs))
  } catch (e) {
    f.phase = 'failed'
    f.error = errText(e)
  }
  save()
}

async function send(company: string) {
  const f = state.followups[company]
  timers.delete(company)
  if (f?.phase !== 'countdown') return
  f.phase = 'sending'
  const rs: Run = { status: 'pending', startedAt: Date.now() }
  f.runs.push(rs)
  save()
  try {
    const out = (await run(sendRequest(f), rs)) as { sent?: boolean; error?: string }
    if (out?.sent !== true) throw new Error(out?.error ?? 'CREAO did not confirm the send')
    f.phase = 'sent'
  } catch (e) {
    f.phase = 'failed'
    f.error = errText(e)
  }
  save()
}

function cancel(company: string) {
  const f = state.followups[company]
  if (f?.phase !== 'countdown') return false
  clearTimeout(timers.get(company))
  timers.delete(company)
  f.phase = 'cancelled'
  save()
  return true
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const readRaw = (req: IncomingMessage) =>
  new Promise<Buffer>(r => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => r(Buffer.concat(chunks)))
  })

createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://x')
  const path = u.pathname.replace(/^\/api/, '')
  try {
    if (u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end(readFileSync(new URL('../public/index.html', import.meta.url)))
    }
    if (path === '/state') return json(res, 200, { ...state, now: Date.now(), testEmail, sendToRep })
    if (req.method !== 'POST') return json(res, 404, { error: 'not found' })
    if (path === '/prep') {
      if (state.prep && !state.prep.endedAt && !state.prep.error) return json(res, 409, { error: 'prep already running' })
      void prep()
      return json(res, 202, { ok: true })
    }
    const company = u.searchParams.get('company') ?? ''
    if (!state.briefs.some(b => b.company === company)) return json(res, 404, { error: `no brief for ${company}` })
    if (path === '/cancel') return json(res, 200, { cancelled: cancel(company) })
    if (path === '/name') {
      const phase = state.followups[company]?.phase
      if (phase && !['cancelled', 'failed'].includes(phase)) return json(res, 409, { error: `follow-up is ${phase}` })
      const raw = await readRaw(req)
      const heard =
        req.headers['content-type'] === 'application/json'
          ? String(JSON.parse(raw.toString()).text ?? '')
          : await transcribe(raw, (reps[company] ?? []).map(r => r.name))
      if (!heard.trim()) return json(res, 422, { error: 'no name heard' })
      void draft(company, heard)
      return json(res, 202, { heard })
    }
    json(res, 404, { error: 'not found' })
  } catch (e) {
    json(res, 500, { error: errText(e) })
  }
}).listen(port, () =>
  console.log(`[booth] http://localhost:${port}  ${account ? 'account' : 'app'} agent ${agentId || '(set CREAO_AGENT_ID)'}  stt ${deepgramKey ? 'deepgram' : 'off (typed names only)'}  follow-ups → ${sendToRep ? 'rep (Apollo email)' : testEmail || '(set TEST_EMAIL)'}`),
)
