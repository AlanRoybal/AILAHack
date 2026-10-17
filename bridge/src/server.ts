import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts'
import { warmBrowser } from './browser.ts'
import { config } from './config.ts'
import { refreshOutline } from './skills/slides.ts'
import { LiveStt } from './stt.ts'
import { Tasks } from './tasks.ts'

const clients = new Set<WebSocket>()
const push = (m: ServerMessage) => {
  const s = JSON.stringify(m)
  for (const c of clients) c.send(s)
}
const tasks = new Tasks(push)
const stt = new LiveStt((text, final) => tasks.hear(text, final))

const dashboard = new URL('../public/index.html', import.meta.url)
const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
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
      ws.send(JSON.stringify({ type: 'ready' } satisfies ServerMessage))
      if (m.role === 'lens') stt.warm()
    } else if (!authed) return
    else if (m.type === 'decide') void tasks.decide(m.id, m.accept)
    else if (m.type === 'inject') tasks.inject(m.text)
  })
  ws.on('close', () => clients.delete(ws))
})

server.listen(config.port, () => {
  console.log(`[bridge] http://localhost:${config.port}  (lens ws /ws)`)
  console.log(`[bridge] detect ${config.detectModel}, agent ${config.agentModel}, stt ${config.deepgramKey ? 'deepgram nova-3' : 'off (type requests on the dashboard)'}`)
  void warmBrowser()
  void refreshOutline()
  stt.warm()
})
