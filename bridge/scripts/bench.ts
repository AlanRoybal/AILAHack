// Sends typed requests through the running bridge, accepts each card after a
// short "glance" delay, and prints where the time went.
//   npm run bench -- "can you book us a table for two tomorrow at 7, Italian"
import WebSocket from 'ws'
import type { ServerMessage } from '../../shared/protocol.ts'

const requests = process.argv.slice(2)
const GLANCE_MS = Number(process.env.GLANCE_MS ?? 1200)
const ws = new WebSocket(`ws://localhost:${process.env.PORT ?? 8787}/ws`)

function run(text: string): Promise<void> {
  return new Promise(resolve => {
    const t0 = Date.now()
    const s = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
    const on = (raw: WebSocket.RawData) => {
      const m = JSON.parse(raw.toString()) as ServerMessage
      if (m.type === 'card') {
        console.log(`  ${s()} card: ${m.task.title}`)
        setTimeout(() => ws.send(JSON.stringify({ type: 'decide', id: m.task.id, accept: true })), GLANCE_MS)
      } else if (m.type === 'status') console.log(`  ${s()} ${m.phase}: ${m.text}`)
      else if (m.type === 'timing') {
        ws.off('message', on)
        resolve()
      }
    }
    ws.on('message', on)
    console.log(`> ${text}`)
    ws.send(JSON.stringify({ type: 'inject', text }))
  })
}

ws.on('open', async () => {
  ws.send(JSON.stringify({ type: 'hello', role: 'dash', token: process.env.HANDOFF_TOKEN ?? '' }))
  for (const r of requests) await run(r)
  process.exit(0)
})
