import { tabFor } from '../browser.ts'
import { config } from '../config.ts'
import { geminiJson } from '../gemini.ts'
import { script } from '../invite.ts'
import type { Job } from './types.ts'

interface Deck {
  slides: { n: number; id: string; texts: { id: string; text: string }[] }[]
}

type Edit =
  | { op: 'setText'; shapeId: string; text: string }
  | { op: 'replace'; slide: number; find: string; replace: string }
  | { op: 'addBullet'; shapeId: string; text: string }
  | { op: 'addSlide'; after: number; title: string; body: string }
  | { op: 'chart'; after: number; title: string; labels: string[]; values: number[]; prefix?: string; suffix?: string }

const STEPS = 2 // planned, edited
const HOST = 'docs.google.com/presentation'
const url = () => `https://docs.google.com/presentation/d/${config.slidesId}/edit`

// Deck text is cached so planning an edit needs only the model call.
let outline: Deck | null = null
export async function refreshOutline(signal?: AbortSignal) {
  if (!config.slidesId) return null
  const r = await script<{ ok?: boolean; slides?: Deck['slides'] }>({ op: 'outline', deck: config.slidesId }, signal)
  if (r.ok && r.slides) outline = { slides: r.slides }
  return outline
}

const PLAN = `You turn a spoken request into edits for a Google Slides deck that is on screen. You get the deck outline (slides with shape ids and text) and the recent conversation, which may hold the numbers or wording the request refers to.
Return {"edits":[...],"summary":"<=26 chars, past tense, e.g. Chart added to slide 4"}.
Ops: {"op":"setText","shapeId":"...","text":"..."} | {"op":"replace","slide":N,"find":"...","replace":"..."} | {"op":"addBullet","shapeId":"...","text":"..."} | {"op":"addSlide","after":N,"title":"...","body":"..."} | {"op":"chart","after":N,"title":"...","labels":["..."],"values":[N],"prefix":"$ or empty","suffix":"% or empty"}
"after" is the slide number the new slide goes after. Keep edits minimal. Use numbers from the conversation when the request refers to them; otherwise write plausible concrete content.`

export function slidesJob(id: string, title: string, request: string, context: string): Job {
  let edits: Edit[] = []
  let summary = 'Deck updated'
  return {
    card: { id, kind: 'slides', title },
    // Planning runs while the card is up; accepting only writes the edit.
    async prepare(ctx) {
      if (!config.slidesId) throw new Error('SLIDES_ID not set')
      void tabFor(HOST, url()).catch(() => {})
      const deck = outline ?? (await refreshOutline(ctx.signal))
      if (!deck) throw new Error('deck unavailable')
      const r = await geminiJson<{ edits?: Edit[]; summary?: string }>(config.detectModel, PLAN, `DECK: ${JSON.stringify(deck)}\nCONVERSATION: ${context}\nREQUEST: ${request}`, ctx.signal)
      edits = r.edits ?? []
      summary = r.summary || summary
      ctx.step(1, STEPS, 'Planned')
    },
    async commit(ctx) {
      if (!edits.length || ctx.signal.aborted) return { phase: 'failed', text: 'No edit made' }
      const r = await script<{ ok?: boolean; slide?: string }>({ op: 'apply', deck: config.slidesId, edits }, ctx.signal)
      if (!r.ok) return { phase: 'failed', text: 'Edit failed' }
      ctx.step(2, STEPS, 'Edited')
      if (r.slide) void show(r.slide)
      void refreshOutline().catch(() => {})
      return { phase: 'done', text: summary }
    },
    async cancel() {},
  }
}

/** Jumps the on-screen deck to the edited slide. */
async function show(slide: string) {
  const page = await tabFor(HOST, url())
  await page.evaluate(s => void (location.hash = `slide=id.${s}`), slide).catch(() => {})
}
