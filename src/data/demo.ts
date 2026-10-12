import { dayContext, targetFor } from '../domain/program'
import type { DayId, Difficulty, Program, Session } from '../domain/types'
import { sessionId } from './WorkoutRepository'

/** Two example sessions before the program start, so "Last time" has something to show. */
export function demoSessions(program: Program): Session[] {
  const plan: [string, DayId][] = [
    ['2026-10-06', 'A'],
    ['2026-10-10', 'B'],
  ]
  const moods: Difficulty[] = ['Right', 'Easy', 'Right', 'Hard']
  return plan.map(([date, dayId], si) => {
    const ctx = dayContext(program, program.start)
    const exercises: Session['exercises'] = {}
    const ids = program.days[dayId].items.flatMap((it) => ('ex' in it ? [it.ex] : it.items))
    ids.forEach((id, i) => {
      const ex = program.exercises[id]
      const t = targetFor(ex, ctx, program)
      const reps = Array.isArray(t.reps) ? t.reps[0] : t.reps
      const kg = ex.load === 'none' ? undefined : (ex.start ?? 24) - (ex.load === 'kg' && (ex.start ?? 0) > 50 ? 5 : 0)
      exercises[id] = {
        sets: Array.from({ length: t.sets }, (_, n) => ({
          kg,
          value: (i + si) % 5 === 3 && n === t.sets - 1 ? Math.max(1, reps - 1) : reps,
          done: true,
        })),
        difficulty: moods[(i + si) % moods.length],
      }
    })
    return {
      id: sessionId(date, dayId),
      date,
      dayId,
      blockId: null,
      status: 'done',
      exercises,
      updatedAt: new Date().toISOString(),
    }
  })
}
