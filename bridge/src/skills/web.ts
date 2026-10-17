import { tabFor } from '../browser.ts'
import { runLoop } from '../loop.ts'
import type { Job, Outcome, SkillCtx } from './types.ts'

/** Anything else that needs a website: the generic loop from a fresh search. */
export function webJob(id: string, title: string, request: string): Job {
  return {
    card: { id, kind: 'web', title },
    async prepare() {},
    async commit(ctx: SkillCtx): Promise<Outcome> {
      const page = await tabFor('bing.com', 'https://www.bing.com/')
      await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(request)}`, { waitUntil: 'domcontentloaded' })
      const r = await runLoop(page, request, { signal: ctx.signal, onStep: ctx.progress })
      if (ctx.signal.aborted) return { phase: 'failed', text: 'Cancelled' }
      return r.status === 'gave_up' ? { phase: 'failed', text: r.message } : { phase: r.status === 'done' ? 'done' : 'needs', text: r.message }
    },
    async cancel() {},
  }
}
