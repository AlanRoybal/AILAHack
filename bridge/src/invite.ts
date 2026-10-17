import { config } from './config.ts'

let guest = config.guestEmail
export const getGuest = () => guest
export const setGuest = (email: string) => void (guest = email.trim())

/** "YYYY-MM-DDTHH:MM" in config.tz to a UTC instant. */
export function zoned(local: string) {
  const guess = new Date(`${local}:00Z`)
  const f = new Intl.DateTimeFormat('en-US', { timeZone: config.tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p = Object.fromEntries(f.formatToParts(guess).map(x => [x.type, Number(x.value)]))
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess.getTime()
  return new Date(guess.getTime() - offset)
}

/** Sends the person who asked a calendar invite, so their phone shows the result. */
export async function sendInvite(o: { title: string; start: Date; minutes?: number; location: string; description: string }, signal?: AbortSignal) {
  if (!config.inviteScriptUrl || !guest) return false
  const r = await script<{ ok?: boolean }>({ op: 'invite', guest, title: o.title, start: o.start.toISOString(), minutes: o.minutes, location: o.location, description: o.description }, signal)
  return !!r.ok
}

/** The wearer's timed events between two instants, as [start, end] epoch ms. */
export async function busy(from: Date, to: Date, signal?: AbortSignal): Promise<[number, number][] | null> {
  if (!config.inviteScriptUrl) return null
  const r = await script<{ ok?: boolean; busy?: [string, string][] }>({ op: 'busy', from: from.toISOString(), to: to.toISOString() }, signal)
  return r.ok && r.busy ? r.busy.map(([a, b]) => [Date.parse(a), Date.parse(b)]) : null
}

/** POST to the Apps Script web app. */
export async function script<T>(body: object, signal?: AbortSignal): Promise<T> {
  const res = await fetch(config.inviteScriptUrl, { method: 'POST', body: JSON.stringify(body), signal })
  return (await res.json().catch(() => ({}))) as T
}
