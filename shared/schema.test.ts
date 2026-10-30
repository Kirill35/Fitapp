import { describe, expect, test } from 'vitest'
import seed from '../src/seed/program.json'
import { checkProgram, SessionSchema } from './schema'
import { blockTextDays, dayContext, dayExerciseIds, dayTitle, isGymDay, programWeeks } from '../src/domain/program'

const clone = () => structuredClone(seed) as any
const errors = (p: unknown) => {
  const r = checkProgram(p)
  return r.ok ? [] : r.errors
}

describe('program schema', () => {
  test('the seed program is valid', () => {
    expect(errors(seed)).toEqual([])
  })

  test.each([
    ['unknown exercise on a day', (p: any) => (p.days.A.items[0].ex = 'nope'), 'unknown exercise "nope"'],
    ['same exercise twice in a day', (p: any) => p.days.A.items.push({ ex: 'zercher' }), 'appears twice'],
    ['gap between blocks', (p: any) => (p.blocks[1].from = '2026-11-05'), 'must start the day after'],
    ['first block not on start date', (p: any) => (p.start = '2026-10-14'), 'first block must start'],
    ['deload pointing at a missing block', (p: any) => (p.blocks[1].deloadOf = 'B9'), 'deloadOf "B9"'],
    ['weekday missing from schedule', (p: any) => delete p.schedule.fri, 'missing fri'],
    ['schedule pointing at nothing', (p: any) => (p.schedule.fri = 'yoga'), '"yoga" is not a day'],
    ['override for a block that does not exist', (p: any) => (p.exercises.bench.byBlock.B7 = { sets: 3 }), '"B7" is not a block'],
    ['text day that does not cover a block', (p: any) => (p.textDays.cardio.text = { B1: 'x' }), 'no text for'],
    ['bad video url', (p: any) => (p.exercises.bench.video = 'javascript:alert(1)'), 'exercises.bench.video'],
    ['rep range backwards', (p: any) => (p.exercises.nordic.reps = [6, 4]), 'low to high'],
    ['gym day name clashes with text day', (p: any) => (p.days.cardio = p.days.A), 'both a gym day and a text day'],
  ])('rejects: %s', (_name, mutate, expected) => {
    const p = clone()
    mutate(p)
    expect(errors(p).join('\n')).toContain(expected)
  })

  test('errors say where the problem is', () => {
    const p = clone()
    p.exercises.bench.sets = 0
    expect(errors(p)).toContainEqual(expect.stringMatching(/^exercises\.bench\.sets:/))
  })

  test('non-objects and junk are rejected without throwing', () => {
    for (const junk of [null, 42, 'x', [], {}]) expect(errors(junk).length).toBeGreaterThan(0)
  })
})

describe('programs are not tied to Day A / Day B', () => {
  // A different program: three gym days with their own names, rest on Sunday.
  const p = clone()
  p.days = {
    push: { title: 'Push', items: [{ ex: 'bench' }, { ex: 'ohp' }] },
    pull: { title: 'Pull', items: [{ ex: 'barbell-row' }, { ex: 'pullups' }] },
    legs: { title: 'Legs', items: [{ ex: 'zercher' }, { ex: 'deadlift' }] },
  }
  p.schedule = { mon: 'push', tue: 'rest', wed: 'pull', thu: 'rest', fri: 'legs', sat: 'rest', sun: 'rest' }
  p.textDays = { rest: { title: 'Rest', text: { default: 'Rest day.' } } }

  test('is valid and drives the calendar', () => {
    const r = checkProgram(p)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const program = r.program
    expect(isGymDay(program, dayContext(program, '2026-10-19').dayKey)).toBe(true) // Monday -> push
    expect(dayContext(program, '2026-10-19').dayKey).toBe('push')
    expect(dayTitle(program, 'legs')).toBe('Legs')
    expect(dayExerciseIds(program, 'pull')).toEqual(['barbell-row', 'pullups'])
    expect(programWeeks(program)).toHaveLength(12)
    expect(blockTextDays(program, program.blocks[0])).toEqual([]) // default-only text is not block-specific
  })
})

describe('session schema', () => {
  const ok = {
    id: '2026-10-13:A',
    date: '2026-10-13',
    dayId: 'A',
    blockId: 'B1',
    status: 'done',
    exercises: { bench: { sets: [{ kg: 85, value: 5, done: true }], difficulty: 'Right' } },
    updatedAt: '2026-10-13T10:00:00.000Z',
  }
  test('accepts a normal session, and what the app saves today', () => {
    expect(SessionSchema.safeParse(ok).success).toBe(true)
    expect(SessionSchema.safeParse({ ...ok, programVersion: 3 }).success).toBe(true)
  })
  test.each([
    ['impossible date', { date: '2026-13-40' }],
    ['negative weight', { exercises: { bench: { sets: [{ kg: -1, value: 5, done: true }] } } }],
    ['unknown status', { status: 'weird' }],
    ['too many sets', { exercises: { bench: { sets: Array.from({ length: 31 }, () => ({ value: 1, done: true })) } } }],
  ])('rejects %s', (_n, patch) => {
    expect(SessionSchema.safeParse({ ...ok, ...patch }).success).toBe(false)
  })
})
