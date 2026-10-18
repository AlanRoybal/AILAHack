// Creates the Booth Brief hosted agent on the CREAO Developer Platform (/v2) and prints CREAO_AGENT_ID.
const env = process.env
const api = env.CREAO_DEV_URL ?? 'https://developer.creao.ai/v2'
const headers = { Authorization: `Bearer ${env.CREAO_API_KEY}`, 'Content-Type': 'application/json' }
const NAME = 'Booth Brief'

async function call(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(api + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`)
  return j
}
const find = async () => ((await call('/agents?limit=100')).agents as any[]).find(a => a.name === NAME)

let agent = await find()
if (!agent) {
  await call('/agents', 'POST', {
    input: `Create a hosted agent named "${NAME}" with one text input named "request" and the gmail connector. Do not persist any memory fields.
It helps a student at the LA Hacks AI Hackathon career fair. Each run gets one request starting with MODE: and must follow it exactly:
- MODE: PREP_BRIEFS: research each listed sponsor on the live web (open roles or internships that fit the given resume, recent news, who staffs the booth) and return ranked JSON briefs.
- MODE: FIND_AND_DRAFT: find a recruiter's work email by calling the Apollo.io REST API (POST https://api.apollo.io/api/v1/people/match, falling back to /mixed_people/api_search then people/match by id) with the API key given in the request as header x-api-key, then draft a short follow-up email. Never send anything in this mode.
- MODE: SEND_EMAIL: send the given subject and body through the connected Gmail account to the given address, exactly as written.
Never reveal API keys in replies. Always end the reply with one fenced json block holding the requested fields.`,
  })
  while (!(agent = await find())) {
    await new Promise(r => setTimeout(r, 5000))
    process.stdout.write('.')
  }
}
if (agent.write_autonomy !== 'full_auto') await call(`/agents/${agent.agent_id}`, 'PATCH', { write_autonomy: 'full_auto' })
console.log(`\nCREAO_AGENT_ID=${agent.agent_id}`)
