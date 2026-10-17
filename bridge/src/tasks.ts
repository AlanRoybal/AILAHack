import type { ServerMessage } from '../../shared/protocol.ts'
import { config } from './config.ts'
import { detect, type Detected } from './detect.ts'
import { bookingJob } from './skills/opentable.ts'
import { meetJob } from './skills/meet.ts'
import type { Job, SkillCtx } from './skills/types.ts'
import { webJob } from './skills/web.ts'

type Push = (m: ServerMessage) => void

interface Live {
  job: Job
  prepared: Promise<void>
  abort: AbortController
  marks: Record<string, number>
  ctx: SkillCtx
  lastStep?: ServerMessage
  /** A step reported during prepare, shown once the wearer accepts. */
  stepUnseen?: boolean
  /** The tilt that accepted a choice card is also its answer. */
  prePick?: 0 | 1
  timer?: NodeJS.Timeout
  choice?: (pick: 0 | 1 | null) => void
  committing: boolean
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
    if (Date.now() - this.lastCardAt < 6000 || this.live.size) return
    this.detecting?.abort()
    const abort = (this.detecting = new AbortController())
    const heardAt = this.heardAt
    if (final) this.heardAt = 0
    const t0 = Date.now()
    detect(text, abort.signal)
      .then(d => {
        if (!d || abort.signal.aborted || Date.now() - this.lastCardAt < 6000 || this.live.size) return
        this.start(d, { heard: heardAt || t0, detectStart: t0, detected: Date.now() })
      })
      .catch(err => {
        if (!abort.signal.aborted) console.warn('[detect]', (err as Error).message)
      })
  }

  private async start(d: Detected, marks: Record<string, number>) {
    this.lastCardAt = Date.now()
    const id = `t${++seq}`
    const job =
      d.kind === 'booking' && d.booking ? bookingJob(id, d.title, { ...d.booking, area: d.booking.area ?? undefined })
      : d.kind === 'meet' && d.meet ? meetJob(id, d.title, d.meet)
      : webJob(id, d.title, d.request)
    const abort = new AbortController()
    const live: Live = { job, abort, marks, prepared: Promise.resolve(), committing: false } as Live
    live.ctx = {
      signal: abort.signal,
      progress: text => live.committing && this.push({ type: 'status', id, phase: 'working', text }),
      step: (index, total, label) => {
        const prev = live.lastStep
        if (prev?.type === 'step' && prev.index === index && prev.label === label && live.committing) return
        live.lastStep = { type: 'step', id, index, total, label }
        live.stepUnseen = !live.committing
        if (live.committing) this.push(live.lastStep)
      },
      checks: items => live.committing && this.push({ type: 'checks', id, items }),
      choose: (prompt, options) =>
        new Promise(resolve => {
          if (abort.signal.aborted) return resolve(null)
          if (live.prePick !== undefined) return resolve(live.prePick)
          marks.choice = Date.now()
          const done = (pick: 0 | 1 | null) => {
            clearTimeout(live.timer)
            live.choice = undefined
            marks.chosen = Date.now()
            resolve(pick)
          }
          live.choice = done
          abort.signal.addEventListener('abort', () => done(null), { once: true })
          live.timer = setTimeout(() => done(null), config.cardMs)
          this.push({ type: 'choice', id, prompt, options })
        }),
    }
    if (!job.ask) live.prepared = job.prepare(live.ctx).then(
      () => void (marks.prepared = Date.now()),
      err => console.warn(`[${id}] prepare failed: ${(err as Error).message}`),
    )
    this.live.set(id, live)
    if (job.ask) {
      const ok = await job.prepare(live.ctx).then(() => true, err => (console.warn(`[${id}] prepare failed: ${(err as Error).message}`), false))
      if (!ok || abort.signal.aborted) return void this.live.delete(id)
    }
    marks.card = Date.now()
    console.log(`[${id}] card "${d.title}" ${JSON.stringify(d.booking ?? d.meet ?? d.request)}`)
    this.push({ type: 'card', task: job.card })
    // Ignoring the card is a no.
    live.timer = setTimeout(() => void this.decide(id, false), config.cardMs)
  }

  async decide(id: string, accept: boolean, pick?: 0 | 1) {
    const live = this.live.get(id)
    if (!live || live.committing) return
    clearTimeout(live.timer)
    const { job, marks, abort, ctx } = live
    marks.decided = Date.now()
    if (!accept) return this.drop(id)
    live.prePick = pick
    live.committing = true
    this.push({ type: 'status', id, phase: 'working', text: 'On it' })
    try {
      await live.prepared
      if (live.lastStep && live.stepUnseen) this.push(live.lastStep)
      live.stepUnseen = false
      const out = await job.commit(ctx)
      marks.finished = Date.now()
      if (!abort.signal.aborted) this.push({ type: 'status', id, phase: out.phase, text: out.text })
    } catch (err) {
      marks.finished = Date.now()
      if (!abort.signal.aborted) {
        console.warn(`[${id}] commit failed`, err)
        this.push({ type: 'status', id, phase: 'failed', text: 'Could not finish' })
      }
    }
    this.live.delete(id)
    const t = (k: string) => (marks[k] ? ((marks[k] - marks.heard) / 1000).toFixed(1) : '-')
    console.log(`[${id}] heard→card ${t('card')}s, →accept ${t('decided')}s, →done ${t('finished')}s (agent ${((marks.finished - marks.decided) / 1000).toFixed(1)}s)`)
    this.push({ type: 'timing', id, marks })
  }

  choose(id: string, pick: 0 | 1 | null) {
    this.live.get(id)?.choice?.(pick)
  }

  /** Tilt-left while the ring is running: stop before the final commit. */
  async cancel(id: string) {
    const live = this.live.get(id)
    if (!live) return
    console.log(`[${id}] cancelled while working`)
    await this.drop(id)
  }

  private async drop(id: string) {
    const live = this.live.get(id)
    if (!live) return
    clearTimeout(live.timer)
    live.abort.abort()
    this.live.delete(id)
    this.push({ type: 'clear', id })
    await live.job.cancel()
  }

  /** Typed request from the dashboard: same path as speech. */
  inject(text: string) {
    this.lastCardAt = 0
    this.heardAt = Date.now()
    this.hear(text, true)
  }
}
