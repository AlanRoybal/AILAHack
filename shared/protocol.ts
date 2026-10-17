export type TaskKind = 'booking' | 'slides' | 'web'

export interface TaskCard {
  id: string
  kind: TaskKind
  /** One line for the lens, <= 40 chars. */
  title: string
}

export type Phase = 'working' | 'done' | 'needs' | 'failed'

/** Lens/dashboard -> bridge. Binary frames from the lens are 16 kHz s16le mono PCM. */
export type ClientMessage =
  | { type: 'hello'; role: 'lens' | 'dash'; token?: string }
  | { type: 'decide'; id: string; accept: boolean }
  | { type: 'inject'; text: string }

/** Bridge -> lens/dashboard. */
export type ServerMessage =
  | { type: 'ready' }
  | { type: 'card'; task: TaskCard }
  | { type: 'status'; id: string; phase: Phase; text: string }
  | { type: 'clear'; id: string }
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'timing'; id: string; marks: Record<string, number> }
