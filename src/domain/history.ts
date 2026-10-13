import { addDays, daysBetween, parseDate, toIso } from './program'
import type { ExerciseDef, LastPerformance, Program, Session, SetLog } from './types'

/** Most recent logged sets for an exercise strictly before `beforeDate`. */
export function lastPerformance(sessions: Session[], exerciseId: string, beforeDate: string): LastPerformance | null {
  let best: LastPerformance | null = null
  for (const s of sessions) {
    if (s.date >= beforeDate || (best && s.date <= best.date)) continue
    const log = s.exercises[exerciseId]
    const done = log?.sets.filter((x) => x.done) ?? []
    if (done.length) best = { date: s.date, sets: done, difficulty: log.difficulty }
  }
  return best
}

/** Does this exercise count toward volume (weight × reps)? */
export const countsForVolume = (ex: ExerciseDef) => ex.load !== 'none' && ex.measure === 'reps'

/** Volume of one set in kg: weight × reps (both sides for per-side work). */
export function setVolume(ex: ExerciseDef, s: SetLog): number {
  if (!s.done || !s.kg || !countsForVolume(ex)) return 0
  return s.kg * s.value * (ex.per ? 2 : 1)
}

export function sessionVolume(program: Program, s: Session, exerciseId?: string): number {
  let v = 0
  for (const [id, log] of Object.entries(s.exercises)) {
    if (exerciseId && id !== exerciseId) continue
    const ex = program.exercises[id]
    if (ex) for (const set of log.sets) v += setVolume(ex, set)
  }
  return v
}

export interface VolumePoint {
  key: string
  label: string
  /** Long label for the tooltip. */
  title: string
  value: number
  deload: boolean
  /** The current, unfinished period. */
  partial?: boolean
}

/** Program week index (0 = first week); negative before the program starts. */
const weekIndex = (program: Program, date: string) => Math.floor(daysBetween(program.start, date) / 7)

export function volumeByWeek(program: Program, sessions: Session[], today: string, exerciseId?: string): VolumePoint[] {
  const totals = new Map<number, number>()
  for (const s of sessions) {
    if (s.date > today) continue
    const w = weekIndex(program, s.date)
    totals.set(w, (totals.get(w) ?? 0) + sessionVolume(program, s, exerciseId))
  }
  const current = weekIndex(program, today)
  const first = Math.min(current, ...totals.keys())
  const out: VolumePoint[] = []
  for (let w = first; w <= current; w++) {
    const from = addDays(program.start, w * 7)
    const block = program.blocks.find((b) => from >= b.from && from <= b.to)
    const short = parseDate(from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    out.push({
      key: from,
      label: w >= 0 ? `W${w + 1}` : short,
      title: `${w >= 0 ? `Week ${w + 1}` : 'Before program'} · from ${short}${block ? ` · ${block.deloadOf ? 'Deload' : block.label}` : ''}`,
      value: totals.get(w) ?? 0,
      deload: !!block?.deloadOf,
      partial: w === current,
    })
  }
  return out
}

export function volumeByMonth(program: Program, sessions: Session[], today: string, exerciseId?: string): VolumePoint[] {
  const totals = new Map<string, number>()
  for (const s of sessions) {
    if (s.date > today) continue
    const m = s.date.slice(0, 7)
    totals.set(m, (totals.get(m) ?? 0) + sessionVolume(program, s, exerciseId))
  }
  const current = today.slice(0, 7)
  const first = [current, ...totals.keys()].sort()[0]
  const out: VolumePoint[] = []
  for (let d = parseDate(`${first}-01`); toIso(d).slice(0, 7) <= current; d.setMonth(d.getMonth() + 1)) {
    const m = toIso(d).slice(0, 7)
    out.push({
      key: m,
      label: d.toLocaleDateString('en-GB', { month: 'short' }),
      title: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      value: totals.get(m) ?? 0,
      deload: false,
      partial: m === current,
    })
  }
  return out
}

export function fmtVolume(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)} t`
  return `${Math.round(kg)} kg`
}

export function volumeBetween(program: Program, sessions: Session[], from: string, to: string, exerciseId?: string): number {
  return sessions.filter((s) => s.date >= from && s.date <= to).reduce((v, s) => v + sessionVolume(program, s, exerciseId), 0)
}

export interface PaceComparison {
  current: number
  /** Same span of the previous period (e.g. Tue–Sat last week when today is Saturday). */
  previous: number
}

/** This program week so far vs the same days of last week. */
export function weekPace(program: Program, sessions: Session[], today: string, exerciseId?: string): PaceComparison {
  const from = addDays(program.start, weekIndex(program, today) * 7)
  return {
    current: volumeBetween(program, sessions, from, today, exerciseId),
    previous: volumeBetween(program, sessions, addDays(from, -7), addDays(today, -7), exerciseId),
  }
}

/** This month so far vs the same days of last month. */
export function monthPace(program: Program, sessions: Session[], today: string, exerciseId?: string): PaceComparison {
  const d = parseDate(today)
  const prevStart = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  const prevEnd = new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth(), 0).getDate()))
  return {
    current: volumeBetween(program, sessions, `${today.slice(0, 7)}-01`, today, exerciseId),
    previous: volumeBetween(program, sessions, toIso(prevStart), toIso(prevEnd), exerciseId),
  }
}
