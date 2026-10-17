import type { Check } from '../../../shared/protocol.ts'
import type { SkillCtx } from './types.ts'

export interface Result {
  label: string
  run: () => Promise<boolean>
}

/** Runs every result of one tilt in parallel and checks each off on the lens as it lands. */
export async function deliver(ctx: SkillCtx, done: string[], results: Result[]) {
  const items: Check[] = [...done.map(label => ({ label, state: 'done' as const })), ...results.map(r => ({ label: r.label, state: 'todo' as const }))]
  ctx.checks(items)
  await Promise.all(
    results.map(async (r, i) => {
      const ok = await r.run().catch(() => false)
      items[done.length + i] = { label: r.label, state: ok ? 'done' : 'fail' }
      ctx.checks([...items])
    }),
  )
  return items
}
