import WebSocket from 'ws'
import { config } from './config.ts'

type Listener = (text: string, final: boolean) => void

/**
 * One Deepgram live socket kept open for the whole demo, so no connect cost per
 * request. Interim results are forwarded too: the detector can start on them
 * before the speaker finishes.
 */
// Words the demo depends on, so Deepgram doesn't hear "Friday" as "Fry".
const KEYTERMS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'tonight', 'tomorrow', 'next week', 'dinner', 'lunch', 'coffee', 'book us', 'table', 'reservation', 'slides', 'deck', 'chart', 'send me']

export class LiveStt {
  private ws: WebSocket | null = null
  private pending: Buffer[] = []
  private keepAlive: NodeJS.Timeout | null = null
  private finals: string[] = []

  constructor(private readonly onText: Listener) {}

  get enabled() {
    return Boolean(config.deepgramKey)
  }

  private connect() {
    const params = new URLSearchParams({
      model: 'nova-3',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      endpointing: '200',
      utterance_end_ms: '1000',
      smart_format: 'true',
      punctuate: 'true',
    })
    for (const k of KEYTERMS) params.append('keyterm', k)
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, { headers: { Authorization: `Token ${config.deepgramKey}` } })
    this.ws = ws
    ws.on('open', () => {
      for (const b of this.pending) ws.send(b)
      this.pending = []
    })
    ws.on('message', raw => {
      let m: { type?: string; is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } }
      try {
        m = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (m.type === 'UtteranceEnd') return this.flush()
      if (m.type !== 'Results') return
      const t = m.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
      if (!t) return
      if (m.is_final) {
        this.finals.push(t)
        if (m.speech_final) this.flush()
        else this.onText(this.finals.join(' '), false)
      } else this.onText([...this.finals, t].join(' '), false)
    })
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null
    })
    ws.on('error', err => console.warn('[stt]', err.message))
    this.keepAlive ??= setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'KeepAlive' }))
    }, 4000)
  }

  private flush() {
    if (!this.finals.length) return
    const text = this.finals.join(' ')
    this.finals = []
    this.onText(text, true)
  }

  push(pcm: Buffer) {
    if (!this.enabled) return
    if (!this.ws) this.connect()
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm)
    else if (this.pending.length < 200) this.pending.push(pcm)
  }

  /** Opens the socket ahead of the first audio frame. */
  warm() {
    if (this.enabled && !this.ws) this.connect()
  }
}
