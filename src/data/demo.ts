import { addDays, dayContext, daysBetween, isGymDay, targetFor } from '../domain/program'
import type { DayId, Difficulty, Program, Session } from '../domain/types'
import { sessionId } from './WorkoutRepository'

/**
 * Example history for trying the prototype: two sessions before the program,
 * then every gym day up to (not including) `today`, with weights creeping up week by week.
 */
export function demoSessions(program: Program, today: string): Session[] {
  const gymDays = Object.keys(program.days)
  const plan: [string, DayId][] = [
    [addDays(program.start, -7), gymDays[0]],
    [addDays(program.start, -3), gymDays[1] ?? gymDays[0]],
  ]
  for (let d = program.start; d < today; d = addDays(d, 1)) {
    const key = dayContext(program, d).dayKey
    if (isGymDay(program, key)) plan.push([d, key])
  }
  const moods: Difficulty[] = ['Right', 'Easy', 'Right', 'Hard']
  return plan.map(([date, dayId], si) => {
    const ctx = dayContext(program, date)
    // Training weeks so far (deload weeks hold the weight); -1 before the program.
    const wi = Math.floor(daysBetween(program.start, date) / 7)
    const deloads = program.blocks.filter((b) => b.deloadOf && b.to < date).length
    const week = wi < 0 ? -1 : wi - deloads - (ctx.deload ? 1 : 0)
    const exercises: Session['exercises'] = {}
    const ids = program.days[dayId].items.flatMap((it) => ('ex' in it ? [it.ex] : it.items))
    ids.forEach((id, i) => {
      const ex = program.exercises[id]
      const t = targetFor(ex, ctx, program)
      const reps = Array.isArray(t.reps) ? t.reps[0] : t.reps
      const start = ex.start ?? 24
      const heavy = ex.load === 'kg' && start > 50
      const kg = ex.load === 'none' ? undefined : start + (heavy ? -5 + 2.5 * week : 0)
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
      blockId: ctx.block?.id ?? null,
      status: 'done',
      exercises,
      updatedAt: new Date().toISOString(),
    }
  })
}
