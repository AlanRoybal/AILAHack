// Creates the Booth Brief CREAO agent and stores the Apollo key as a CREAO secret (needs a cr_sk_ account key).
const env = process.env
const api = env.CREAO_DEV_URL ?? 'https://developer.creao.ai/v1'
const headers = { Authorization: `Bearer ${env.CREAO_API_KEY}`, 'Content-Type': 'application/json' }

async function call(path: string, body?: unknown) {
  const r = await fetch(api + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j)}`)
  return j
}

if (!env.CREAO_API_KEY?.startsWith('cr_sk_')) throw new Error('CREAO_API_KEY must be an account key (cr_sk_)')

if (env.APOLLO_API_KEY) {
  const { secrets } = await call('/secrets')
  if (secrets.some((s: any) => s.name === 'APOLLO_API_KEY')) {
    const r = await fetch(`${api}/secrets/APOLLO_API_KEY`, { method: 'PATCH', headers, body: JSON.stringify({ value: env.APOLLO_API_KEY }) })
    if (!r.ok) throw new Error(`secret update ${r.status}`)
  } else await call('/secrets', { name: 'APOLLO_API_KEY', value: env.APOLLO_API_KEY, description: 'Booth Brief rep email lookup' })
  console.log('APOLLO_API_KEY secret stored')
}

if (env.CREAO_AGENT_ID) {
  console.log('agent already set:', env.CREAO_AGENT_ID)
  process.exit(0)
}

const created = await call('/agents', {
  input: `Create an agent named "Booth Brief" with a single text input named "request".
It helps a student at the LA Hacks career fair. Every run receives one request that starts with MODE: and it must follow that request exactly:
- MODE: PREP_BRIEFS researches each listed sponsor (open roles that fit the attached resume, recent news, who staffs the booth) and returns JSON briefs.
- MODE: FIND_AND_DRAFT looks up a recruiter's work email with the Apollo.io API (secret APOLLO_API_KEY, header x-api-key) and drafts a short follow-up email. It never sends anything.
- MODE: SEND_EMAIL sends the given subject and body through the connected Gmail account to the given address.
Always end the reply with one fenced json block holding the requested fields.`,
})
for (;;) {
  await new Promise(r => setTimeout(r, 5000))
  const r = await call(`/runs/${created.run_id}`)
  if (r.status === 'completed') {
    console.log('CREAO_AGENT_ID=' + (r.agent_id ?? r.result?.agent_id))
    break
  }
  if (r.status === 'failed' || r.status === 'cancelled') throw new Error(`agent creation ${r.status} ${JSON.stringify(r.error)}`)
  process.stdout.write('.')
}
