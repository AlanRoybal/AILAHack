import { tabFor } from '../browser.ts'
import { config } from '../config.ts'
import { geminiJson } from '../gemini.ts'
import { runLoop } from '../loop.ts'
import type { Job, Outcome, SkillCtx } from './types.ts'

/** Deck text by slide, from the Apps Script web app. Cached so a request needs no round trip. */
let outline: { slides: { n: number; id: string; texts: { id: string; text: string }[] }[] } | null = null

async function script<T>(body: object): Promise<T> {
  const res = await fetch(config.slidesScriptUrl, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' }, redirect: 'follow' })
  const text = await res.text()
  if (!res.ok) throw new Error(`slides script ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text) as T
}

export async function refreshOutline() {
  if (!config.slidesScriptUrl) return
  try {
    outline = await script({ op: 'outline' })
    console.log(`[slides] outline: ${outline?.slides.length} slides`)
  } catch (err) {
    console.warn(`[slides] outline failed: ${(err as Error).message}`)
  }
}

type Edit =
  | { op: 'setText'; shapeId: string; text: string }
  | { op: 'replace'; slide: number; find: string; replace: string }
  | { op: 'addBullet'; shapeId: string; text: string }
  | { op: 'addSlide'; after: number; title: string; body: string }

const PLAN = `You turn a spoken request into edits for a Google Slides deck. You get the deck outline as JSON (slides with shape ids and text).
Return {"edits":[...],"summary":"<=34 chars past tense, e.g. Slide 3 numbers updated"}.
Edit ops: {"op":"setText","shapeId":"...","text":"..."} | {"op":"replace","slide":N,"find":"...","replace":"..."} | {"op":"addBullet","shapeId":"...","text":"..."} | {"op":"addSlide","after":N,"title":"...","body":"..."}
Keep edits minimal. Invent plausible concrete content when the request implies it.`

export function slidesJob(id: string, title: string, request: string): Job {
  let edits: Edit[] = []
  let summary = 'Slides updated'
  return {
    card: { id, kind: 'slides', title },
    // Planning the edit (one model call) runs while the card is up; accepting only applies it.
    async prepare(ctx: SkillCtx) {
      void tabFor('docs.google.com/presentation', config.slidesUrl || 'https://docs.google.com/presentation/').catch(() => {})
      if (!config.slidesScriptUrl) return
      if (!outline) await refreshOutline()
      const r = await geminiJson<{ edits: Edit[]; summary: string }>(config.detectModel, PLAN, `DECK: ${JSON.stringify(outline)}\nREQUEST: ${request}`, ctx.signal)
      edits = r.edits ?? []
      summary = r.summary || summary
    },
    async commit(ctx: SkillCtx): Promise<Outcome> {
      if (config.slidesScriptUrl && edits.length) {
        ctx.progress('Editing deck')
        await script({ op: 'apply', edits })
        void refreshOutline()
        return { phase: 'done', text: summary }
      }
      const page = await tabFor('docs.google.com/presentation', config.slidesUrl || 'https://docs.google.com/presentation/')
      const r = await runLoop(page, `In this Google Slides deck: ${request}`, { signal: ctx.signal, onStep: ctx.progress })
      return r.status === 'gave_up' ? { phase: 'failed', text: r.message } : { phase: r.status === 'done' ? 'done' : 'needs', text: r.message || summary }
    },
    async cancel() {},
  }
}
