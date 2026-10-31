import { describe, expect, test } from 'vitest'
import seed from '../seed/program.json'
import { checkProgram } from '../../shared/schema'
import { diffPrograms, historyWarnings } from './programDiff'
import { buildProgramPrompt, extractJson } from './programPrompt'
import type { Program, Session } from './types'

const base = (checkProgram(seed) as { ok: true; program: Program }).program
const edit = (fn: (p: any) => void): Program => {
  const p = structuredClone(base) as any
  fn(p)
  const r = checkProgram(p)
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.program
}
const lines = (a: Program, b: Program) => diffPrograms(a, b).sections.flatMap((s) => s.lines.map((l) => `${l.kind}: ${l.text}`))

describe('reading the AI answer', () => {
  const json = JSON.stringify(base)
  test.each([
    ['bare JSON', json],
    ['fenced block', 'Here you go:\n```json\n' + json + '\n```\nLet me know!'],
    ['fence without language', '```\n' + json + '\n```'],
    ['prose around bare JSON', 'Sure! ' + json + ' Enjoy.'],
    ['extra whitespace', '\n\n  ' + json + '  \n'],
  ])('accepts %s', (_n, text) => {
    const r = extractJson(text)
    expect(r.ok).toBe(true)
    if (r.ok) expect(checkProgram(r.value).ok).toBe(true)
  })

  test.each([
    ['empty', '', 'Nothing pasted'],
    ['no JSON at all', 'I think you should add more squats.', 'No JSON object found'],
    ['cut off', json.slice(0, 500), 'not valid JSON'],
    ['a list, not an object', '[1,2,3]', 'No JSON object found'],
  ])('rejects %s with a message', (_n, text, expected) => {
    const r = extractJson(text)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(expected)
  })
})

describe('program diff', () => {
  test('identical programs have no changes', () => {
    expect(diffPrograms(base, base)).toMatchObject({ same: true, sections: [], counts: { add: 0, remove: 0, change: 0 } })
  })

  test('a changed start weight is one readable line', () => {
    const next = edit((p) => (p.exercises.bench.start = 87.5))
    expect(lines(base, next)).toEqual(['change: Bench press: start 85 kg → 87.5 kg'])
  })

  test('block targets', () => {
    const next = edit((p) => (p.exercises.deadlift.byBlock.B2 = { sets: 5, reps: 3 }))
    expect(lines(base, next)).toEqual(['change: Deadlift: B2: 4×3 → 5×3'])
  })

  test('adding an exercise to a day', () => {
    const next = edit((p) => {
      p.exercises.rdl = { name: 'Romanian deadlift', load: 'kg', measure: 'reps', sets: 3, reps: 8, start: 80 }
      p.days.A.items.push({ ex: 'rdl' })
    })
    const l = lines(base, next)
    expect(l).toContain('add: Day A: Romanian deadlift')
    expect(l).toContain('add: Romanian deadlift: 3×8 @ 80 kg')
  })

  test('removing an exercise from a day and the program', () => {
    const next = edit((p) => {
      p.days.A.items = p.days.A.items.filter((i: any) => i.ex !== 'box-jump')
      delete p.exercises['box-jump']
    })
    const l = lines(base, next)
    expect(l).toContain('remove: Day A: Box jump')
    expect(l).toContain('remove: Box jump')
  })

  test('schedule, new day, removed day', () => {
    const next = edit((p) => {
      p.days.C = { title: 'Day C', items: [{ ex: 'bench' }] }
      p.schedule.fri = 'C'
      delete p.days.B
      p.schedule.sat = 'bjj'
    })
    const l = lines(base, next)
    expect(l).toContain('change: Fri: BJJ → Day C')
    expect(l).toContain('change: Sat: Day B → BJJ')
    expect(l.some((x) => x.startsWith('add: New day "Day C"'))).toBe(true)
    expect(l).toContain('remove: Day "Day B" removed')
  })

  test('reordering is reported as an order change', () => {
    const next = edit((p) => p.days.A.items.reverse())
    expect(lines(base, next)).toContain('change: Day A: order or supersets changed')
  })

  test('block dates, warm-up and cardio text', () => {
    const next = edit((p) => {
      p.blocks[4].to = '2027-01-11'
      p.warmup[0].dose = '3 min'
      p.textDays.cardio.text.B1 = 'Easy 40 min'
    })
    const l = lines(base, next)
    expect(l).toContain('change: B3: 2026-12-08 to 2027-01-04 → 2026-12-08 to 2027-01-11')
    expect(l).toContain('change: Warm-up Bike: 2 min → 3 min')
    expect(l).toContain('change: Cardio: text or title changed')
  })

  test('counts add up', () => {
    const next = edit((p) => {
      p.exercises.bench.start = 90
      p.warmup.pop()
    })
    expect(diffPrograms(base, next).counts).toEqual({ add: 0, remove: 1, change: 1 })
  })
})

describe('warnings from your history', () => {
  const session = (date: string, dayId: string, id: string): Session => ({
    id: `${date}:${dayId}`,
    date,
    dayId,
    blockId: 'B1',
    status: 'done',
    updatedAt: '',
    exercises: { [id]: { sets: [{ kg: 85, value: 5, done: true }] } },
  })

  test('nothing to say when history is unaffected', () => {
    expect(historyWarnings(base, edit((p) => (p.exercises.bench.start = 90)), [session('2026-10-13', 'A', 'bench')])).toEqual([])
  })

  test('dropping a movement you have logged', () => {
    const next = edit((p) => {
      p.days.A.items = p.days.A.items.filter((i: any) => i.ex !== 'zercher')
      delete p.exercises.zercher
    })
    const w = historyWarnings(base, next, [session('2026-10-13', 'A', 'zercher'), session('2026-10-20', 'A', 'zercher')])
    expect(w).toEqual(['"Zercher squat" is not in the new program. Its 2 logged sessions stay saved but won\'t appear as "last time".'])
  })

  test('the same movement under a new id is called out, with the fix', () => {
    const next = edit((p) => {
      p.exercises['zercher-squat'] = p.exercises.zercher
      delete p.exercises.zercher
      p.days.A.items.find((i: any) => i.ex === 'zercher').ex = 'zercher-squat'
    })
    const w = historyWarnings(base, next, [session('2026-10-13', 'A', 'zercher')])
    expect(w[0]).toContain('is now called id "zercher-squat" instead of "zercher"')
    expect(w[0]).toContain('keep id "zercher"')
  })

  test('removed days and a moved start date', () => {
    const next = edit((p) => {
      delete p.days.B
      p.schedule.sat = 'bjj'
      p.start = '2026-10-13'
    })
    expect(historyWarnings(base, next, [session('2026-10-17', 'B', 'deadlift')]).some((x) => x.includes('"Day B", which no longer exists'))).toBe(true)
    const moved = edit((p) => {
      p.start = '2026-10-20'
      p.blocks[0].from = '2026-10-20'
    })
    expect(historyWarnings(base, moved, [session('2026-10-13', 'A', 'bench')]).some((x) => x.includes('start date moves'))).toBe(true)
  })
})

describe('the prompt for the AI', () => {
  const sessions: Session[] = [
    { id: '2026-10-13:A', date: '2026-10-13', dayId: 'A', blockId: 'B1', status: 'done', updatedAt: '', exercises: { bench: { sets: [{ kg: 85, value: 5, done: true }, { kg: 85, value: 5, done: true }], difficulty: 'Right' }, zercher: { sets: [{ kg: 62.5, value: 5, done: false }] } } },
  ]
  const prompt = buildProgramPrompt(base, sessions, 'Make block 2 harder', '2026-10-31')

  test('contains the request, the format rules, every exercise id, history and the current program', () => {
    expect(prompt).toContain('Make block 2 harder')
    expect(prompt).toContain('ONE JSON object')
    for (const id of Object.keys(base.exercises)) expect(prompt).toContain(`- ${id}: ${base.exercises[id].name}`)
    expect(prompt).toContain('Bench press (bench): Tue 13 Oct 85 kg · 5,5 Right')
    expect(prompt).not.toContain('Zercher squat (zercher):') // unfinished sets are not history
    expect(prompt).toContain('reuse its id exactly')
  })

  test('the embedded program can be read back and is valid', () => {
    const r = extractJson(prompt.slice(prompt.indexOf('{"start"')))
    expect(r.ok).toBe(true)
    if (r.ok) expect(checkProgram(r.value).ok).toBe(true)
  })

  test('has a helpful placeholder when no request is typed, and says when there is no history', () => {
    const p = buildProgramPrompt(base, [], '', '2026-10-31')
    expect(p).toContain('Describe the change here')
    expect(p).toContain('(nothing logged yet)')
  })

  test('stays a reasonable size', () => {
    expect(prompt.length).toBeLessThan(20_000)
  })
})

describe('every rule in the format description is enforced by the schema', () => {
  test.each([
    ['blocks not back to back', (p: any) => (p.blocks[2].from = '2026-11-12')],
    ['missing weekday', (p: any) => delete p.schedule.mon],
    ['superset of one', (p: any) => (p.days.A.items[3] = { group: 'x', items: ['bench'] })],
    ['uppercase id', (p: any) => (p.exercises.Bench = p.exercises.bench)],
  ])('%s is rejected', (_n, fn) => {
    const p = structuredClone(base) as any
    fn(p)
    expect(checkProgram(p).ok).toBe(false)
  })
})
