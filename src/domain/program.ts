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

const daysBetween = (a: string, b: string) =>
  Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000)

export interface DayContext {
  date: string
  programStart: string
  weekday: string
  block: Block | null
  weekInBlock: number | null
  deload: boolean
  status: 'before' | 'active' | 'after'
  /** 'A' | 'B' for gym days, otherwise a key of program.textDays. */
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
    dayKey: program.schedule[weekday],
  }
}

export const isGymDay = (key: string): key is DayId => key === 'A' || key === 'B'

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
  const td = program.textDays[ctx.dayKey]
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

export function videoUrl(ex: ExerciseDef): string {
  return ex.video ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${ex.name} technique`)}`
}
