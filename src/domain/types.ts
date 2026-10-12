// ---- Program (seed) ----

export type Load = 'kg' | 'added' | 'none'
export type Measure = 'reps' | 'sec' | 'm' | 'min'
export type Reps = number | [number, number]
export type DayId = 'A' | 'B'
export type Difficulty = 'Easy' | 'Right' | 'Hard'

export interface Target {
  sets: number
  reps: Reps
  note?: string
}

export interface ExerciseDef extends Target {
  name: string
  load: Load
  measure: Measure
  per?: 'side' | 'leg' | 'arm'
  start?: number
  /** Optional own technique URL; otherwise a YouTube search link is used. */
  video?: string
  byBlock?: Record<string, Partial<Target>>
}

export type DayItem = { ex: string } | { group: string; items: string[] }

export interface Block {
  id: string
  label: string
  from: string
  to: string
  /** Set on deload weeks: the block whose reps the deload keeps. */
  deloadOf?: string
}

export interface Program {
  start: string
  blocks: Block[]
  schedule: Record<string, string>
  textDays: Record<string, { title: string; text: Record<string, string> }>
  warmup: string[]
  exercises: Record<string, ExerciseDef>
  days: Record<DayId, { title: string; items: DayItem[] }>
}

// ---- Logged data ----

export interface SetLog {
  /** Weight in kg (or added kg). Absent for unloaded exercises. */
  kg?: number
  /** Reps, seconds, metres or minutes depending on the exercise measure. */
  value: number
  done: boolean
}

export interface ExerciseLog {
  sets: SetLog[]
  difficulty?: Difficulty
}

export interface Session {
  id: string
  date: string // YYYY-MM-DD
  dayId: DayId
  blockId: string | null
  status: 'in-progress' | 'done'
  exercises: Record<string, ExerciseLog>
  updatedAt: string
}

export interface LastPerformance {
  date: string
  sets: SetLog[]
  difficulty?: Difficulty
}
