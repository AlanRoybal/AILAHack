import type { Check, TaskCard } from '../../../shared/protocol.ts'

export interface SkillCtx {
  signal: AbortSignal
  /** Short progress line for the lens. */
  progress: (text: string) => void
  /** A real step finished: fills ring segment `index` of `total` and sets the one-word label. */
  step: (index: number, total: number, label: string) => void
  /** Ask the wearer to tilt left or right; null if they decline or ignore it. */
  choose: (prompt: string, options: [string, string]) => Promise<0 | 1 | null>
  /** The separate results one tilt produces (table, invite, text), each checked off as it lands. */
  checks: (items: Check[]) => void
}

export interface Outcome {
  phase: 'done' | 'needs' | 'failed'
  text: string
}

/**
 * A skill splits its work at the point of no return. `prepare` runs while the
 * card is still on the lens (speculative, safe to throw away); `commit` runs
 * after the wearer accepts and must check `ctx.signal` before anything final.
 */
export interface Job {
  card: TaskCard
  /** The card is itself a choice built in `prepare`, so it waits for prepare before showing. */
  ask?: boolean
  prepare(ctx: SkillCtx): Promise<void>
  commit(ctx: SkillCtx): Promise<Outcome>
  cancel(): Promise<void>
}
