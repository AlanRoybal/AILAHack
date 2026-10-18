// Lambda (function URL): POST /send {to, subject, body} with "Authorization: Bearer $SEND_TOKEN" sends through Gmail.
const { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, SEND_TOKEN, ALLOWED_TO = '' } = process.env

const reply = (statusCode, obj) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) })
const b64url = s => Buffer.from(s).toString('base64url')
const header = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`)

async function accessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token' }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`token ${r.status} ${j.error ?? ''}`)
  return j.access_token
}

export async function handler(event) {
  if (event.requestContext?.http?.method !== 'POST' || event.rawPath !== '/send') return reply(404, { error: 'not found' })
  if (event.headers?.authorization !== `Bearer ${SEND_TOKEN}`) return reply(401, { error: 'unauthorized' })
  let msg
  try {
    msg = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body)
  } catch {
    return reply(400, { error: 'invalid json' })
  }
  const { to, subject, body } = msg ?? {}
  if (![to, subject, body].every(v => typeof v === 'string' && v.trim()) || /[\r\n]/.test(to + subject))
    return reply(400, { error: 'to, subject and body are required' })
  const allowed = ALLOWED_TO.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (allowed.length && !allowed.includes(to.trim().toLowerCase())) return reply(403, { error: 'recipient not allowed' })
  const raw = [`To: ${to}`, `Subject: ${header(subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n')
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: b64url(raw) }),
  })
  const j = await r.json()
  if (!r.ok) return reply(502, { error: `gmail ${r.status} ${j.error?.message ?? ''}` })
  return reply(200, { sent: true, to, id: j.id })
}
