import { config } from './config.ts'
import { geminiJson } from './gemini.ts'
import type { TaskKind } from '../../shared/protocol.ts'

export interface Detected {
  kind: TaskKind
  title: string
  booking?: { query: string; when: string; party: number; area?: string }
  request: string
}

// Cheap gate so the model only sees speech that sounds like a request.
const ASK = /\b(book|reserve|reservation|table|send|update|change|edit|fix|add|put|make|swap|replace|rename|find|look up|can you|could you|would you)\b/i

const SYSTEM = `Someone is talking to the wearer of smart glasses. Decide if they just asked the wearer to do a task an agent can do online right now.
Return {"task":null} or {"task":{"kind":"booking"|"slides"|"web","title":"<=38 chars, imperative, for the lens","request":"the task restated fully","booking":{"query":"cuisine or restaurant","when":"YYYY-MM-DDTHH:MM","party":N,"area":"neighborhood or null"}}}.
booking = restaurant reservation (OpenTable). slides = change the demo slide deck. web = any other website task.
Only include "booking" for kind booking. Ignore small talk, questions about the product, and anything already done.
Now is ${new Date().toString().slice(0, 21)}. Default party 2, default time 7:00 PM, default area ${config.city}.`

export async function detect(text: string, signal?: AbortSignal): Promise<Detected | null> {
  if (!ASK.test(text)) return null
  const r = await geminiJson<{ task: Detected | null }>(config.detectModel, SYSTEM, text, signal)
  return r.task?.title ? r.task : null
}
