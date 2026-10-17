export type TaskKind = 'booking' | 'meet' | 'web'

export interface TaskCard {
  id: string
  kind: TaskKind
  /** What the agent understood, one line for the lens, e.g. "Table · 2 · 7:00 · Italian". */
  title: string
  /** Set when the card itself is a choice (e.g. two lunch times): the tilt picks one. */
  options?: [string, string]
}

export interface Check {
  label: string
  state: 'todo' | 'done' | 'fail'
}

export type Phase = 'working' | 'done' | 'needs' | 'failed'

/** Lens/dashboard -> bridge. Binary frames from the lens are 16 kHz s16le mono PCM. */
export type ClientMessage =
  | { type: 'hello'; role: 'lens' | 'dash'; token?: string }
  | { type: 'decide'; id: string; accept: boolean; pick?: 0 | 1 }
  /** Answer to a choice card; null = ignored or declined. */
  | { type: 'choose'; id: string; pick: 0 | 1 | null }
  /** Tilt-left while working: abort before the final commit. */
  | { type: 'cancel'; id: string }
  | { type: 'inject'; text: string }
  /** Email of the person at the table who gets the result. */
  | { type: 'guest'; email: string; phone?: string }

/** Bridge -> lens/dashboard. */
export type ServerMessage =
  | { type: 'ready'; guest?: string; phone?: string }
  | { type: 'card'; task: TaskCard }
  | { type: 'choice'; id: string; prompt: string; options: [string, string] }
  | { type: 'step'; id: string; index: number; total: number; label: string }
  | { type: 'checks'; id: string; items: Check[] }
  | { type: 'status'; id: string; phase: Phase; text: string }
  | { type: 'clear'; id: string }
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'timing'; id: string; marks: Record<string, number> }
  /** JPEG frame (base64) of the browser the agent drives. Dashboard only. */
  | { type: 'frame'; data: string }
