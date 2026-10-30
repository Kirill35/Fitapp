// Types come from the shared schema so the app and the server cannot drift apart.
import type { Program as P, Session as S } from '../../shared/schema'

export type { Program, Session, SetLog, ExerciseLog } from '../../shared/schema'

export type Load = 'kg' | 'added' | 'none'
export type Measure = 'reps' | 'sec' | 'm' | 'min'
export type Difficulty = 'Easy' | 'Right' | 'Hard'
/** Key of a gym day in `program.days` (any name the program defines). */
export type DayId = string

export type ExerciseDef = P['exercises'][string]
export type Reps = ExerciseDef['reps']
export type Target = { sets: number; reps: Reps; note?: string }
export type Block = P['blocks'][number]
export type WarmupItem = P['warmup'][number]
export type DayItem = P['days'][string]['items'][number]
export type SessionStatus = S['status']

export interface LastPerformance {
  date: string
  sets: import('../../shared/schema').SetLog[]
  difficulty?: Difficulty
}
