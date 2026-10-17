import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts'
import { streamFrames, warmBrowser } from './browser.ts'
import { config } from './config.ts'
import { getPhone, setPhone } from './text.ts'
import { getGuest, setGuest } from './invite.ts'
import { LiveStt } from './stt.ts'
import { Tasks } from './tasks.ts'

const clients = new Set<WebSocket>()
const dashes = new Set<WebSocket>()
const push = (m: ServerMessage) => {
  const s = JSON.stringify(m)
  for (const c of clients) c.send(s)
}
const tasks = new Tasks(push)
const stt = new LiveStt((text, final) => tasks.hear(text, final))
streamFrames(data => {
  if (!dashes.size) return
  const s = JSON.stringify({ type: 'frame', data } satisfies ServerMessage)
  for (const c of dashes) if (c.bufferedAmount < 2e6) c.send(s)
})

const dashboard = new URL('../public/index.html', import.meta.url)
const server = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?') || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    return res.end(readFileSync(dashboard))
  }
  res.writeHead(404).end()
})

new WebSocketServer({ server, path: '/ws' }).on('connection', ws => {
  let authed = !config.token
  if (authed) clients.add(ws)
  ws.on('message', (raw, binary) => {
    if (binary) return authed && stt.push(raw as Buffer)
    const m = JSON.parse(raw.toString()) as ClientMessage
    if (m.type === 'hello') {
      authed ||= m.token === config.token
      if (!authed) return ws.close(4001, 'bad token')
      clients.add(ws)
      if (m.role === 'dash') dashes.add(ws)
      ws.send(JSON.stringify({ type: 'ready', guest: getGuest(), phone: getPhone() } satisfies ServerMessage))
      if (m.role === 'lens') stt.warm()
    } else if (!authed) return
    else if (m.type === 'decide') void tasks.decide(m.id, m.accept, m.pick)
    else if (m.type === 'choose') tasks.choose(m.id, m.pick)
    else if (m.type === 'cancel') void tasks.cancel(m.id)
    else if (m.type === 'inject') tasks.inject(m.text)
    else if (m.type === 'guest') {
      setGuest(m.email)
      if (m.phone !== undefined) setPhone(m.phone)
    }
  })
  ws.on('close', () => (clients.delete(ws), dashes.delete(ws)))
})

server.listen(config.port, () => {
  console.log(`[bridge] http://localhost:${config.port}  (lens ws /ws)`)
  console.log(`[bridge] detect ${config.detectModel}, agent ${config.agentModel}, stt ${config.deepgramKey ? 'deepgram nova-3' : 'off (type requests on the dashboard)'}`)
  console.log(`[bridge] invites ${config.inviteScriptUrl ? `on${getGuest() ? ` → ${getGuest()}` : ' (set the guest email on the dashboard)'}` : 'off (no INVITE_SCRIPT_URL)'}`)
  void warmBrowser()
  stt.warm()
})
