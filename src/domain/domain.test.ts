import { describe, expect, test } from 'vitest'
import seed from '../seed/program.json'
import { addDays, dayContext, dayExerciseIds, fmtTarget, programWeeks, targetFor } from './program'
import { monthPace, sessionVolume, volumeByMonth, volumeByWeek, weekPace } from './history'
import type { Program, Session } from './types'

const program = seed as unknown as Program

describe('calendar', () => {
  test('block and week boundaries (Tue-Mon weeks)', () => {
    expect(dayContext(program, '2026-10-13')).toMatchObject({ block: { id: 'B1' }, weekInBlock: 1, dayKey: 'A', status: 'active' })
    expect(dayContext(program, '2026-10-19')).toMatchObject({ weekInBlock: 1, dayKey: 'bjj' }) // Monday ends week 1
    expect(dayContext(program, '2026-10-20')).toMatchObject({ weekInBlock: 2 })
    expect(dayContext(program, '2026-11-03')).toMatchObject({ block: { id: 'D1' }, deload: true })
    expect(dayContext(program, '2026-11-10').block?.id).toBe('B2')
    expect(dayContext(program, '2026-10-12').status).toBe('before')
    expect(dayContext(program, '2027-01-05').status).toBe('after')
  })

  test('schedule by weekday', () => {
    const key = (d: string) => dayContext(program, d).dayKey
    expect([key('2026-10-13'), key('2026-10-15'), key('2026-10-17'), key('2026-10-18')]).toEqual(['A', 'cardio', 'B', 'sunday'])
  })

  test('12 program weeks, each starting on a Tuesday, no gaps', () => {
    const weeks = programWeeks(program)
    expect(weeks).toHaveLength(12)
    weeks.forEach((w, i) => expect(w.from).toBe(addDays(program.start, i * 7)))
    expect(weeks.filter((w) => w.block.deloadOf)).toHaveLength(2)
  })
})

describe('targets', () => {
  test('main lifts change per block, others do not', () => {
    const t = (id: string, date: string) => fmtTarget(program.exercises[id], targetFor(program.exercises[id], dayContext(program, date), program))
    expect([t('deadlift', '2026-10-17'), t('deadlift', '2026-11-14'), t('deadlift', '2026-12-12')]).toEqual(['3×5', '4×3', '3×2'])
    expect([t('bench', '2026-10-13'), t('bench', '2026-11-10'), t('bench', '2026-12-08')]).toEqual(['3×5', '3×4', '3×3'])
    expect(t('hip-thrust', '2026-10-13')).toBe(t('hip-thrust', '2026-12-08'))
  })

  test('deload keeps the previous block reps with 2 sets', () => {
    const ex = program.exercises.deadlift
    expect(fmtTarget(ex, targetFor(ex, dayContext(program, '2026-11-07'), program))).toBe('2×5')
    expect(fmtTarget(ex, targetFor(ex, dayContext(program, '2026-12-05'), program))).toBe('2×3')
  })

  test('every exercise referenced by a day exists', () => {
    for (const d of ['A', 'B'] as const) for (const id of dayExerciseIds(program, d)) expect(program.exercises[id], id).toBeDefined()
  })
})

const session = (date: string, kg: number, reps: number[], id = 'bench'): Session => ({
  id: `${date}:A`,
  date,
  dayId: 'A',
  blockId: 'B1',
  status: 'done',
  updatedAt: '',
  exercises: { [id]: { sets: reps.map((value) => ({ kg, value, done: true })) } },
})

describe('volume', () => {
  test('weight x reps; per-side work counts both sides; unloaded and timed do not count', () => {
    expect(sessionVolume(program, session('2026-10-13', 80, [5, 5, 5]))).toBe(1200)
    expect(sessionVolume(program, session('2026-10-13', 30, [5, 5, 5], 'sandbag-shoulder'))).toBe(900)
    expect(sessionVolume(program, session('2026-10-13', 40, [30], 'farmer-carry'))).toBe(0)
    expect(sessionVolume(program, { ...session('2026-10-13', 80, [5]), exercises: { bench: { sets: [{ kg: 80, value: 5, done: false }] } } })).toBe(0)
  })

  const history = [session('2026-10-13', 80, [5, 5, 5]), session('2026-10-17', 80, [5, 5, 5]), session('2026-10-20', 82.5, [5, 5, 5])]

  test('weekly totals follow program weeks and include empty weeks', () => {
    const w = volumeByWeek(program, history, '2026-10-30')
    expect(w.map((p) => p.value)).toEqual([2400, 1237.5, 0])
    expect(w.at(-1)?.partial).toBe(true)
  })

  test('monthly totals', () => {
    expect(volumeByMonth(program, history, '2026-10-30').map((p) => p.value)).toEqual([3637.5])
  })

  test('so-far comparison uses the same span of the previous period', () => {
    // Week 2 started Tue 20 Oct. Through Thu 22 Oct: 1237.5 this week vs 1200 (Tue 13 only) last week.
    expect(weekPace(program, history, '2026-10-22')).toEqual({ current: 1237.5, previous: 1200 })
    // Through Sat 24 Oct: last week's equivalent includes Sat 17 Oct.
    expect(weekPace(program, history, '2026-10-24').previous).toBe(2400)
    expect(monthPace(program, history, '2026-11-05')).toEqual({ current: 0, previous: 0 }) // Oct 1-5: nothing yet
    expect(monthPace(program, history, '2026-11-30')).toEqual({ current: 0, previous: 3637.5 })
  })
})
