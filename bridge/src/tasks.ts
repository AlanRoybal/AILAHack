import type { ServerMessage } from '../../shared/protocol.ts'
import { detect, type Detected } from './detect.ts'
import { bookingJob } from './skills/opentable.ts'
import { slidesJob } from './skills/slides.ts'
import type { Job } from './skills/types.ts'
import { webJob } from './skills/web.ts'

type Push = (m: ServerMessage) => void

interface Live {
  job: Job
  prepared: Promise<void>
  abort: AbortController
  marks: Record<string, number>
}

let seq = 0

/**
 * Speech in, cards out. Detection runs on interim transcripts too, so a card can
 * appear before the speaker finishes; the skill's safe prep then starts at once,
 * and accepting only runs the part that commits.
 */
export class Tasks {
  private live = new Map<string, Live>()
  private detecting: AbortController | null = null
  private lastText = ''
  private lastCardAt = 0
  private heardAt = 0

  constructor(private readonly push: Push) {}

  hear(text: string, final: boolean) {
    this.push({ type: 'transcript', text, final })
    if (!this.heardAt) this.heardAt = Date.now()
    // Interim results repeat; only re-run detection when a few new words arrived.
    if (!final && text.split(' ').length - this.lastText.split(' ').length < 3) return
    this.lastText = final ? '' : text
    if (Date.now() - this.lastCardAt < 6000) return
    this.detecting?.abort()
    const abort = (this.detecting = new AbortController())
    const heardAt = this.heardAt
    if (final) this.heardAt = 0
    const t0 = Date.now()
    detect(text, abort.signal)
      .then(d => {
        if (!d || abort.signal.aborted || Date.now() - this.lastCardAt < 6000) return
        this.start(d, { heard: heardAt || t0, detectStart: t0, detected: Date.now() })
      })
      .catch(err => {
        if (!abort.signal.aborted) console.warn('[detect]', (err as Error).message)
      })
  }

  private start(d: Detected, marks: Record<string, number>) {
    this.lastCardAt = Date.now()
    const id = `t${++seq}`
    const job =
      d.kind === 'booking' && d.booking
        ? bookingJob(id, d.title, { ...d.booking, area: d.booking.area ?? undefined })
        : d.kind === 'slides'
          ? slidesJob(id, d.title, d.request)
          : webJob(id, d.title, d.request)
    const abort = new AbortController()
    const ctx = { signal: abort.signal, progress: (text: string) => this.push({ type: 'status', id, phase: 'working', text }) }
    const live: Live = { job, abort, marks, prepared: Promise.resolve() }
    live.prepared = job.prepare(ctx).then(
      () => void (marks.prepared = Date.now()),
      err => console.warn(`[${id}] prepare failed: ${(err as Error).message}`),
    )
    this.live.set(id, live)
    marks.card = Date.now()
    console.log(`[${id}] card "${d.title}" ${JSON.stringify(d.booking ?? d.request)}`)
    this.push({ type: 'card', task: job.card })
  }

  async decide(id: string, accept: boolean) {
    const live = this.live.get(id)
    if (!live) return
    const { job, marks, abort } = live
    marks.decided = Date.now()
    if (!accept) {
      abort.abort()
      this.live.delete(id)
      this.push({ type: 'clear', id })
      await job.cancel()
      return
    }
    const ctx = { signal: abort.signal, progress: (text: string) => this.push({ type: 'status', id, phase: 'working', text }) }
    this.push({ type: 'status', id, phase: 'working', text: 'On it' })
    try {
      await live.prepared
      const out = await job.commit(ctx)
      marks.finished = Date.now()
      this.push({ type: 'status', id, phase: out.phase, text: out.text })
    } catch (err) {
      marks.finished = Date.now()
      console.warn(`[${id}] commit failed`, err)
      this.push({ type: 'status', id, phase: 'failed', text: 'Could not finish' })
    }
    this.live.delete(id)
    const t = (k: string) => ((marks[k] - marks.heard) / 1000).toFixed(1)
    console.log(`[${id}] heard→card ${t('card')}s, →accept ${t('decided')}s, →done ${t('finished')}s (agent ${((marks.finished - marks.decided) / 1000).toFixed(1)}s)`)
    this.push({ type: 'timing', id, marks })
  }

  /** Typed request from the dashboard: same path as speech. */
  inject(text: string) {
    this.lastCardAt = 0
    this.heardAt = Date.now()
    this.hear(text, true)
  }
}
