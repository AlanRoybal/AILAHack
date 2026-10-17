import type { TaskCard } from '../../../shared/protocol.ts'
import { config } from '../config.ts'
import { busy, getGuest, sendInvite, zoned } from '../invite.ts'
import { canText, sendText } from '../text.ts'
import { deliver } from './deliver.ts'
import type { Job } from './types.ts'

export interface MeetParams {
  /** "lunch", "coffee", "a call". */
  what: string
  /** Dates to search, "YYYY-MM-DD", inclusive. */
  from: string
  to: string
  /** Window each day, "HH:MM". */
  earliest: string
  latest: string
  minutes: number
}

const STEPS = 2 // read calendar, sent
const DAY = 86400000

const label = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: config.tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]))
  return `${p.weekday} ${p.hour}:${p.minute}`
}
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** First free start on each day in range, skipping weekends when the range has weekdays. */
export function freeSlots(p: MeetParams, taken: [number, number][], now = Date.now()) {
  const days: string[] = []
  for (let t = Date.parse(`${p.from}T12:00:00Z`); t <= Date.parse(`${p.to}T12:00:00Z`); t += DAY) days.push(new Date(t).toISOString().slice(0, 10))
  const weekdays = days.filter(d => weekday(d) % 6 !== 0)
  const out: Date[] = []
  for (const d of weekdays.length ? weekdays : days) {
    for (let m = toMin(p.earliest); m + p.minutes <= toMin(p.latest); m += 30) {
      const s = zoned(`${d}T${hhmm(m)}`).getTime()
      const e = s + p.minutes * 60000
      if (s < now + 3600000 || taken.some(([a, b]) => a < e && b > s)) continue
      out.push(new Date(s))
      break
    }
  }
  return out
}

/** Two options on different days, spread apart when possible: "Tue 12:30 ← → Thu 1:00". */
export function pickTwo(slots: Date[]): Date[] {
  if (slots.length < 2) return slots
  const later = slots.find(s => s.getTime() - slots[0].getTime() >= 2 * DAY - 3 * 3600000)
  return [slots[0], later ?? slots[1]]
}

export function meetJob(id: string, title: string, p: MeetParams): Job {
  const card: TaskCard = { id, kind: 'meet', title }
  let slots: Date[] = []
  return {
    card,
    // The card is the choice, so the calendar is read before it is shown.
    ask: true,
    async prepare(ctx) {
      const taken = await busy(zoned(`${p.from}T00:00`), zoned(`${p.to}T23:59`), ctx.signal)
      if (!taken) throw new Error('calendar unavailable')
      slots = pickTwo(freeSlots(p, taken))
      if (slots.length < 2) throw new Error('no free times')
      card.options = [label(slots[0]), label(slots[1])]
      ctx.step(1, STEPS, 'Calendar')
    },
    async commit(ctx) {
      const pick = await ctx.choose(title, card.options!)
      if (pick === null || ctx.signal.aborted) return { phase: 'failed', text: 'Not scheduled' }
      const start = slots[pick]
      const when = card.options![pick]
      const what = p.what.charAt(0).toUpperCase() + p.what.slice(1)
      ctx.step(1, STEPS, when)
      await deliver(ctx, [], [
        ...(getGuest() ? [{ label: 'Invite', run: () => sendInvite({ title: what, start, minutes: p.minutes, location: '', description: 'Scheduled by Handoff.' }, ctx.signal) }] : []),
        ...(canText() ? [{ label: 'Text', run: () => sendText(`${what} ${when}. Invite is on your calendar.`, ctx.signal) }] : []),
      ])
      ctx.step(2, STEPS, 'Sent')
      return { phase: 'done', text: `${what} ${when}` }
    },
    async cancel() {},
  }
}
