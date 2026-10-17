import type { ClientMessage, ServerMessage } from '../../shared/protocol.ts'

/** WebSocket to the bridge through the dev server's /bridge proxy. Reconnects forever. */
export class Link {
  private ws: WebSocket | null = null
  constructor(private readonly onMsg: (m: ServerMessage) => void, private readonly onState: (s: string) => void) {
    this.open()
  }
  private open() {
    const url = (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/bridge`
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.onState('connecting')
    ws.onopen = () => this.send({ type: 'hello', role: 'lens', token: import.meta.env.VITE_HANDOFF_TOKEN as string | undefined })
    ws.onmessage = e => {
      const m = JSON.parse(e.data as string) as ServerMessage
      if (m.type === 'ready') this.onState('connected')
      this.onMsg(m)
    }
    ws.onclose = () => {
      this.onState('offline')
      setTimeout(() => this.open(), 1000)
    }
  }
  send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }
  sendPcm(pcm: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm)
  }
}
