import type { Block, DayId, ExerciseDef, Program, SetLog, Target } from './types'

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const daysBetween = (a: string, b: string) =>
  Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000)

export interface DayContext {
  date: string
  programStart: string
  weekday: string
  block: Block | null
  weekInBlock: number | null
  deload: boolean
  status: 'before' | 'active' | 'after'
  /** A key of program.days (gym day) or program.textDays. */
  dayKey: string
}

export function dayContext(program: Program, date: string): DayContext {
  const weekday = WEEKDAYS[parseDate(date).getDay()]
  const block = program.blocks.find((b) => date >= b.from && date <= b.to) ?? null
  const last = program.blocks[program.blocks.length - 1]
  return {
    date,
    programStart: program.start,
    weekday,
    block,
    weekInBlock: block ? Math.floor(daysBetween(block.from, date) / 7) + 1 : null,
    deload: !!block?.deloadOf,
    status: date < program.start ? 'before' : date > last.to ? 'after' : 'active',
    dayKey: (program.schedule as Record<string, string>)[weekday],
  }
}

/** Gym days are the ones the program defines in `days`; everything else is a plain-text day. */
export const isGymDay = (program: Program, key: string): key is DayId => key in program.days

/** Block whose targets apply (deload weeks use the block they follow). */
function targetBlockId(ctx: DayContext, program: Program): string {
  if (ctx.block) return ctx.block.deloadOf ?? ctx.block.id
  return ctx.status === 'after' ? program.blocks[program.blocks.length - 1].id : program.blocks[0].id
}

export function targetFor(ex: ExerciseDef, ctx: DayContext, program: Program): Target {
  const over = ex.byBlock?.[targetBlockId(ctx, program)] ?? {}
  const t: Target = { sets: over.sets ?? ex.sets, reps: over.reps ?? ex.reps, note: over.note ?? ex.note }
  if (ctx.deload) t.sets = Math.min(t.sets, 2)
  return t
}

export function textDayBody(program: Program, ctx: DayContext): { title: string; text: string } {
  const td = program.textDays[ctx.dayKey] ?? { title: ctx.dayKey, text: {} }
  const key = ctx.deload ? 'deload' : targetBlockId(ctx, program)
  return { title: td.title, text: td.text[key] ?? td.text.default ?? '' }
}

// ---- Formatting ----

const unit = { reps: '', sec: ' s', m: ' m', min: ' min' } as const

export function fmtReps(r: Target['reps']): string {
  return Array.isArray(r) ? `${r[0]}–${r[1]}` : String(r)
}

export function fmtTarget(ex: ExerciseDef, t: Target): string {
  const per = ex.per ? `/${ex.per}` : ''
  if (ex.measure === 'min') return `${fmtReps(t.reps)} min`
  return `${t.sets}×${fmtReps(t.reps)}${unit[ex.measure]}${per}`
}

export function fmtKg(ex: ExerciseDef, kg: number | undefined): string {
  if (kg === undefined) return '—'
  const n = Number.isInteger(kg) ? String(kg) : kg.toFixed(1).replace(/\.0$/, '')
  return ex.load === 'added' ? `+${n} kg` : `${n} kg`
}

export function fmtDate(iso: string): string {
  const d = parseDate(iso)
  const wd = d.toLocaleDateString('en-GB', { weekday: 'short' })
  return `${wd} ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}

/** "110 kg · 5,5,5" or "110×5 · 105×5" when weights differ. */
export function fmtSets(ex: ExerciseDef, sets: SetLog[]): string {
  if (sets.length === 0) return '—'
  const values = sets.map((s) => s.value).join(',') + unit[ex.measure]
  if (ex.load === 'none') return values
  const kgs = new Set(sets.map((s) => s.kg))
  if (kgs.size === 1) return `${fmtKg(ex, sets[0].kg)} · ${values}`
  return sets.map((s) => `${fmtKg(ex, s.kg).replace(' kg', '')}×${s.value}`).join(' · ') + ' kg'
}

export function videoUrl(ex: { name: string; video?: string }): string {
  return ex.video ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${ex.name} technique`)}`
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso)
  d.setDate(d.getDate() + n)
  return toIso(d)
}

export function fmtShort(iso: string): string {
  return parseDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export interface ProgramWeek {
  n: number
  from: string
  to: string
  block: Block
  weekInBlock: number
  days: { date: string; dayKey: string }[]
}

/** Program weeks (Tue–Mon) from start to the end of the last block. */
export function programWeeks(program: Program): ProgramWeek[] {
  const last = program.blocks[program.blocks.length - 1].to
  const weeks: ProgramWeek[] = []
  for (let from = program.start, n = 1; from <= last; from = addDays(from, 7), n++) {
    const ctx = dayContext(program, from)
    weeks.push({
      n,
      from,
      to: addDays(from, 6),
      block: ctx.block!,
      weekInBlock: ctx.weekInBlock!,
      days: Array.from({ length: 7 }, (_, i) => {
        const date = addDays(from, i)
        return { date, dayKey: dayContext(program, date).dayKey }
      }),
    })
  }
  return weeks
}

export function dayTitle(program: Program, dayKey: string): string {
  return isGymDay(program, dayKey) ? program.days[dayKey].title : (program.textDays[dayKey]?.title ?? dayKey)
}

/** Exercises whose targets change between blocks, grouped by identical targets. */
export function blockTargets(program: Program, blockId: string): { names: string[]; target: string; note?: string }[] {
  const out: { names: string[]; target: string; note?: string }[] = []
  for (const ex of Object.values(program.exercises)) {
    if (!ex.byBlock) continue
    const o = ex.byBlock[blockId] ?? {}
    const target = fmtTarget(ex, { sets: o.sets ?? ex.sets, reps: o.reps ?? ex.reps })
    const g = out.find((x) => x.target === target)
    const name = ex.name.replace(/ \(.*\)/, '').replace('Standing press', 'OHP')
    if (g) g.names.push(name)
    else out.push({ names: [name], target })
  }
  return out
}

/** Block-specific notes, e.g. "Deadlift: 3 broad jumps after the last set". */
export function blockNotes(program: Program, blockId: string): string[] {
  return Object.values(program.exercises)
    .filter((ex) => ex.byBlock?.[blockId]?.note && ex.byBlock[blockId].note !== ex.note)
    .map((ex) => `${ex.name}: ${ex.byBlock![blockId].note}`)
}

export const dayExerciseIds = (program: Program, dayId: DayId) =>
  program.days[dayId].items.flatMap((it) => ('ex' in it ? [it.ex] : it.items))

/** Plain-text days whose content changes per block (e.g. cardio), for one block. */
export function blockTextDays(program: Program, block: Block): { title: string; text: string }[] {
  const key = block.deloadOf ? 'deload' : block.id
  return Object.values(program.textDays)
    .filter((td) => key in td.text)
    .map((td) => ({ title: td.title, text: td.text[key].replace(/\n/g, ' → ') }))
}

/** Text days that vary by block, with one line per block (for the program summary). */
export function textDaysByBlock(program: Program): { title: string; rows: { label: string; text: string }[] }[] {
  return Object.values(program.textDays)
    .filter((td) => Object.keys(td.text).some((k) => k !== 'default'))
    .map((td) => ({
      title: td.title,
      rows: program.blocks
        .filter((b, i, all) => !b.deloadOf || all.findIndex((x) => x.deloadOf) === i)
        .map((b) => ({ label: b.deloadOf ? 'Deload' : b.label, text: (td.text[b.deloadOf ? 'deload' : b.id] ?? td.text.default ?? '').replace(/\n/g, ' → ') })),
    }))
}
