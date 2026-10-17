import type { TaskCard } from '../../../shared/protocol.ts'
import { config } from '../config.ts'
import { geminiJson } from '../gemini.ts'
import { getGuest, script } from '../invite.ts'
import { canText, sendText } from '../text.ts'
import { deliver } from './deliver.ts'
import type { Job } from './types.ts'

export interface SendParams {
  /** "slides", "paper", "resume". */
  what: string
  keywords: string[]
}

interface File {
  id: string
  name: string
  type: string
  modified: string
  url: string
}

const STEPS = 2 // found, sent

const PICK = `Someone asked the wearer to send them a file. From the wearer's Drive search results, pick the file they mean, using the request and the recent conversation. "Your slides" or "your deck" means the wearer's own recently edited presentation, not an old one. Prefer recent files and files matching the conversation's topic.
Return {"pick":i,"alt":j or null,"names":["<=16 char name for pick","<=16 char name for alt"]}. Set alt only when two files are equally likely; otherwise null and one name.`

export function sendJob(id: string, title: string, p: SendParams, request: string, context: string): Job {
  const card: TaskCard = { id, kind: 'send', title }
  let files: File[] = []
  return {
    card,
    // The card names the file, so the search runs before it is shown.
    ask: true,
    async prepare(ctx) {
      if (!getGuest() && !canText()) throw new Error('no requester email or phone')
      const r = await script<{ ok?: boolean; files?: File[] }>({ op: 'find', keywords: p.keywords }, ctx.signal)
      const found = r.files ?? []
      if (!found.length) throw new Error('no matching file')
      const list = found.map((f, i) => `${i}. ${f.name} (${f.type.split(/[./]/).pop()}, ${f.modified.slice(0, 10)})`).join('\n')
      const c = found.length === 1 ? { pick: 0, alt: null, names: [found[0].name.slice(0, 16)] } : await geminiJson<{ pick: number; alt: number | null; names: string[] }>(config.detectModel, PICK, `FILES:\n${list}\nCONVERSATION: ${context}\nREQUEST: ${request}`, ctx.signal)
      const a = found[c.pick] ?? found[0]
      const b = c.alt !== null && c.alt !== c.pick ? found[c.alt] : undefined
      files = b ? [a, b] : [a]
      const names = files.map((f, i) => c.names?.[i] || f.name.slice(0, 16))
      if (b) card.options = [names[0], names[1]]
      else card.title = `Send · ${names[0]}`.slice(0, 30)
      ctx.step(1, STEPS, 'Found')
    },
    async commit(ctx) {
      const pick = card.options ? await ctx.choose(card.title, card.options) : 0
      if (pick === null || ctx.signal.aborted) return { phase: 'failed', text: 'Not sent' }
      const f = files[pick]
      ctx.step(1, STEPS, 'Found')
      await deliver(ctx, [], [
        ...(getGuest() ? [{ label: 'Email', run: async () => !!(await script<{ ok?: boolean }>({ op: 'share', id: f.id, guest: getGuest() }, ctx.signal)).ok }] : []),
        ...(canText() ? [{ label: 'Text', run: () => sendText(`${f.name}: ${f.url}`, ctx.signal) }] : []),
      ])
      ctx.step(2, STEPS, 'Sent')
      return { phase: 'done', text: `Sent ${f.name}`.slice(0, 34) }
    },
    async cancel() {},
  }
}
