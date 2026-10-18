// Lambda (function URL), all with "Authorization: Bearer $SEND_TOKEN":
// POST /send {to, subject, body} sends through Gmail. POST /hold {to, subject, body} returns a signed ticket
// without sending; POST /release {ticket} sends the held email.
import { createHmac, timingSafeEqual } from 'node:crypto'
const { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, SEND_TOKEN, ALLOWED_TO = '' } = process.env

const reply = (statusCode, obj) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) })
const b64url = s => Buffer.from(s).toString('base64url')
const sign = p => createHmac('sha256', SEND_TOKEN).update(p).digest('base64url')
const HOLD_MS = 60 * 60 * 1000
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
  const route = event.rawPath
  if (event.requestContext?.http?.method !== 'POST' || !['/send', '/hold', '/release'].includes(route)) return reply(404, { error: 'not found' })
  if (event.headers?.authorization !== `Bearer ${SEND_TOKEN}`) return reply(401, { error: 'unauthorized' })
  let msg
  try {
    msg = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body)
  } catch {
    return reply(400, { error: 'invalid json' })
  }
  if (route === '/release') {
    const [p = '', sig = ''] = String(msg?.ticket ?? '').split('.')
    const want = Buffer.from(sign(p))
    if (!p || Buffer.from(sig).length !== want.length || !timingSafeEqual(Buffer.from(sig), want)) return reply(403, { error: 'bad ticket' })
    msg = JSON.parse(Buffer.from(p, 'base64url').toString())
    if (!(Date.now() - msg.at < HOLD_MS)) return reply(403, { error: 'ticket expired' })
  }
  const { to, subject, body } = msg ?? {}
  if (![to, subject, body].every(v => typeof v === 'string' && v.trim()) || /[\r\n]/.test(to + subject))
    return reply(400, { error: 'to, subject and body are required' })
  const allowed = ALLOWED_TO.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (allowed.length && !allowed.includes(to.trim().toLowerCase())) return reply(403, { error: 'recipient not allowed' })
  if (route === '/hold') {
    const p = b64url(JSON.stringify({ to, subject, body, at: Date.now() }))
    return reply(200, { held: true, to, ticket: `${p}.${sign(p)}` })
  }
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
