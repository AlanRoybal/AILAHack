// Sends typed requests through the running bridge, accepts each card after a
// short "glance" delay, takes the later time if offered a choice, and prints
// where the time went.
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
        if (m.task.options) console.log(`  ${s()} options: ${m.task.options.join(' | ')}`)
        setTimeout(() => ws.send(JSON.stringify({ type: 'decide', id: m.task.id, accept: true, pick: m.task.options ? 1 : undefined })), GLANCE_MS)
      } else if (m.type === 'choice') {
        console.log(`  ${s()} choice: ${m.prompt} [${m.options.join(' | ')}]`)
        setTimeout(() => ws.send(JSON.stringify({ type: 'choose', id: m.id, pick: 1 })), GLANCE_MS)
      } else if (m.type === 'step') console.log(`  ${s()} step ${m.index}/${m.total}: ${m.label}`)
      else if (m.type === 'checks') console.log(`  ${s()} checks: ${m.items.map(i => `${i.state} ${i.label}`).join(', ')}`)
      else if (m.type === 'status') console.log(`  ${s()} ${m.phase}: ${m.text.replace(/\n/g, ' / ')}`)
      else if (m.type === 'timing' || m.type === 'clear') {
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
  if (process.env.GUEST) ws.send(JSON.stringify({ type: 'guest', email: process.env.GUEST }))
  for (const r of requests) await run(r)
  process.exit(0)
})
