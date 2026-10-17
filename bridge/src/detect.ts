import { config } from './config.ts'
import { geminiJson } from './gemini.ts'
import type { TaskKind } from '../../shared/protocol.ts'
import type { MeetParams } from './skills/meet.ts'

export interface Detected {
  kind: TaskKind
  title: string
  booking?: { query: string; when: string; party: number; area?: string }
  meet?: MeetParams & { label: string }
  request: string
}

interface Raw extends Detected {
  addressed: boolean
  confidence: number
}

// Cheap gate so the model only sees speech that sounds like a request.
const ASK = /\b(book|reserve|reservation|table|send|find|look up|order|get|grab|can you|could you|would you|will you|lunch|coffee|dinner|meet|catch up|schedule|sync)\b/i

const SYSTEM = `Someone is talking to the wearer of smart glasses. Decide if they just asked the wearer to do a task an agent can do online right now.
Return {"task":null} or {"task":{"kind":"booking"|"meet"|"web","addressed":bool,"confidence":0..1,"title":"<=30 chars, what the agent will do","request":"the task restated fully","booking":{"query":"cuisine or restaurant","when":"YYYY-MM-DDTHH:MM","party":N,"area":"neighborhood or null"},"meet":{"what":"lunch","label":"<=12 chars, e.g. next week","from":"YYYY-MM-DD","to":"YYYY-MM-DD","earliest":"HH:MM","latest":"HH:MM","minutes":N}}}.
booking = book a restaurant table now (OpenTable). meet = find a time for the speaker and the wearer to meet later ("we should get lunch next week"); pick a sensible daily window (lunch 11:30-14:00, coffee 09:00-17:00, dinner 18:00-21:00, call 09:00-18:00). web = any other website task.
addressed = the speaker is asking the wearer ("can you", "book us", "send me") or proposing to meet them ("we should get lunch"), not describing, quoting, or talking to someone else.
confidence = how sure you are this is a real request the wearer would want done now. Ignore small talk, questions about the product, and anything already done.
Only include "booking" for kind booking and "meet" for kind meet. Now is ${new Date().toString().slice(0, 21)}. Default party 2, default time 7:00 PM, default area ${config.city}.`

const hhmm = (when: string) => {
  const [h, m] = when.slice(11, 16).split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export async function detect(text: string, signal?: AbortSignal): Promise<Detected | null> {
  if (!ASK.test(text)) return null
  const r = await geminiJson<{ task: Raw | null }>(config.detectModel, SYSTEM, text, signal)
  const t = r.task
  if (!t?.title || !t.addressed || !(t.confidence >= config.minConfidence)) {
    if (t) console.log(`[detect] dropped "${t.title}" addressed=${t.addressed} conf=${t.confidence}`)
    return null
  }
  // The card shows what was understood, in a fixed shape the wearer can read at a glance.
  if (t.kind === 'booking' && t.booking) t.title = `Table · ${t.booking.party} · ${hhmm(t.booking.when)} · ${cap(t.booking.query)}`.slice(0, 34)
  if (t.kind === 'meet' && t.meet) t.title = `${cap(t.meet.what)} · ${t.meet.label}`.slice(0, 30)
  return t
}
