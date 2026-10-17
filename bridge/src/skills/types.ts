import type { TaskCard } from '../../../shared/protocol.ts'

export interface SkillCtx {
  signal: AbortSignal
  /** Short progress line for the lens. */
  progress: (text: string) => void
}

export interface Outcome {
  phase: 'done' | 'needs' | 'failed'
  text: string
}

/**
 * A skill splits its work at the point of no return. `prepare` runs while the
 * card is still on the lens (speculative, safe to throw away); `commit` runs
 * after the wearer accepts.
 */
export interface Job {
  card: TaskCard
  prepare(ctx: SkillCtx): Promise<void>
  commit(ctx: SkillCtx): Promise<Outcome>
  cancel(): Promise<void>
}
