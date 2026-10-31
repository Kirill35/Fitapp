import { fmtReps, fmtTarget } from './program'
import type { ExerciseDef, Program, Session } from './types'

export interface DiffLine {
  kind: 'add' | 'remove' | 'change'
  text: string
}
export interface DiffSection {
  title: string
  lines: DiffLine[]
}
export interface ProgramDiff {
  sections: DiffSection[]
  counts: { add: number; remove: number; change: number }
  same: boolean
}

const DAYS = [
  ['tue', 'Tue'],
  ['wed', 'Wed'],
  ['thu', 'Thu'],
  ['fri', 'Fri'],
  ['sat', 'Sat'],
  ['sun', 'Sun'],
  ['mon', 'Mon'],
] as const

const dayName = (p: Program, key: string | undefined) => (key === undefined ? 'nothing' : (p.days[key]?.title ?? p.textDays[key]?.title ?? key))
const exName = (p: Program, id: string) => p.exercises[id]?.name ?? id
const kg = (n: number | undefined, ex: ExerciseDef) => (n === undefined ? 'none' : ex.load === 'added' ? `+${n} kg` : `${n} kg`)
const ids = (p: Program, day: string) => p.days[day].items.flatMap((it) => ('ex' in it ? [it.ex] : it.items))
const shape = (p: Program, day: string) => p.days[day].items.map((it) => ('ex' in it ? it.ex : `[${it.group}: ${it.items.join('+')}]`)).join(' ')

function exerciseChanges(a: ExerciseDef, b: ExerciseDef, blocks: string[]): string[] {
  const out: string[] = []
  if (a.name !== b.name) out.push(`renamed from "${a.name}"`)
  if (a.load !== b.load) out.push(`load ${a.load} → ${b.load}`)
  if (a.measure !== b.measure) out.push(`measured in ${a.measure} → ${b.measure}`)
  if ((a.per ?? '') !== (b.per ?? '')) out.push(`per ${a.per ?? 'whole'} → ${b.per ?? 'whole'}`)
  if (a.start !== b.start) out.push(`start ${kg(a.start, a)} → ${kg(b.start, b)}`)
  if (a.sets !== b.sets || fmtReps(a.reps) !== fmtReps(b.reps)) out.push(`target ${a.sets}×${fmtReps(a.reps)} → ${b.sets}×${fmtReps(b.reps)}`)
  if ((a.note ?? '') !== (b.note ?? '')) out.push(b.note ? `note "${b.note}"` : 'note removed')
  if ((a.video ?? '') !== (b.video ?? '')) out.push(b.video ? 'technique link changed' : 'technique link removed')
  for (const blk of blocks) {
    const x = a.byBlock?.[blk]
    const y = b.byBlock?.[blk]
    if (JSON.stringify(x ?? null) === JSON.stringify(y ?? null)) continue
    const t = (e: ExerciseDef, o: typeof x) => (o ? fmtTarget(e, { sets: o.sets ?? e.sets, reps: o.reps ?? e.reps }) : 'as base')
    out.push(`${blk}: ${t(a, x)} → ${t(b, y)}`)
  }
  return out
}

/** What would change if `next` replaced `prev`, in plain words. */
export function diffPrograms(prev: Program, next: Program): ProgramDiff {
  const sections: DiffSection[] = []
  const add = (title: string, lines: DiffLine[]) => lines.length && sections.push({ title, lines })

  // Dates and blocks
  const blockLines: DiffLine[] = []
  if (prev.start !== next.start) blockLines.push({ kind: 'change', text: `Start date ${prev.start} → ${next.start}` })
  const pb = new Map(prev.blocks.map((b) => [b.id, b]))
  const nb = new Map(next.blocks.map((b) => [b.id, b]))
  for (const b of next.blocks) {
    const o = pb.get(b.id)
    const name = b.deloadOf ? `Deload (${b.id})` : b.label
    if (!o) blockLines.push({ kind: 'add', text: `${name}: ${b.from} to ${b.to}` })
    else if (o.from !== b.from || o.to !== b.to || o.label !== b.label || o.deloadOf !== b.deloadOf)
      blockLines.push({ kind: 'change', text: `${name}: ${o.from} to ${o.to} → ${b.from} to ${b.to}` })
  }
  for (const b of prev.blocks) if (!nb.has(b.id)) blockLines.push({ kind: 'remove', text: `${b.deloadOf ? `Deload (${b.id})` : b.label}: ${b.from} to ${b.to}` })
  add('Blocks and dates', blockLines)

  // Week
  const sched = (p: Program, d: string) => (p.schedule as Record<string, string>)[d]
  add(
    'Weekly schedule',
    DAYS.flatMap(([d, label]): DiffLine[] =>
      sched(prev, d) === sched(next, d) && dayName(prev, sched(prev, d)) === dayName(next, sched(next, d))
        ? []
        : [{ kind: 'change', text: `${label}: ${dayName(prev, sched(prev, d))} → ${dayName(next, sched(next, d))}` }],
    ),
  )

  // Training days
  const dayLines: DiffLine[] = []
  for (const d of Object.keys(next.days)) {
    if (!(d in prev.days)) {
      dayLines.push({ kind: 'add', text: `New day "${next.days[d].title}": ${ids(next, d).map((i) => exName(next, i)).join(', ')}` })
      continue
    }
    const before = ids(prev, d)
    const after = ids(next, d)
    const title = next.days[d].title
    if (prev.days[d].title !== title) dayLines.push({ kind: 'change', text: `"${prev.days[d].title}" renamed to "${title}"` })
    const added = after.filter((i) => !before.includes(i))
    const removed = before.filter((i) => !after.includes(i))
    if (added.length) dayLines.push({ kind: 'add', text: `${title}: ${added.map((i) => exName(next, i)).join(', ')}` })
    if (removed.length) dayLines.push({ kind: 'remove', text: `${title}: ${removed.map((i) => exName(prev, i)).join(', ')}` })
    if (!added.length && !removed.length && shape(prev, d) !== shape(next, d)) dayLines.push({ kind: 'change', text: `${title}: order or supersets changed` })
  }
  for (const d of Object.keys(prev.days)) if (!(d in next.days)) dayLines.push({ kind: 'remove', text: `Day "${prev.days[d].title}" removed` })
  add('Training days', dayLines)

  // Exercise details
  const exLines: DiffLine[] = []
  const blockIds = [...new Set([...prev.blocks, ...next.blocks].filter((b) => !b.deloadOf).map((b) => b.id))]
  for (const [id, ex] of Object.entries(next.exercises)) {
    const o = prev.exercises[id]
    if (!o) exLines.push({ kind: 'add', text: `${ex.name}: ${fmtTarget(ex, ex)}${ex.start !== undefined ? ` @ ${kg(ex.start, ex)}` : ''}` })
    else {
      const ch = exerciseChanges(o, ex, blockIds)
      if (ch.length) exLines.push({ kind: 'change', text: `${ex.name}: ${ch.join('; ')}` })
    }
  }
  for (const [id, ex] of Object.entries(prev.exercises)) if (!(id in next.exercises)) exLines.push({ kind: 'remove', text: ex.name })
  add('Exercises', exLines)

  // Plain-text days and warm-up
  const textLines: DiffLine[] = []
  for (const [k, td] of Object.entries(next.textDays)) {
    const o = prev.textDays[k]
    if (!o) textLines.push({ kind: 'add', text: td.title })
    else if (JSON.stringify(o) !== JSON.stringify(td)) textLines.push({ kind: 'change', text: `${td.title}: text or title changed` })
  }
  for (const [k, td] of Object.entries(prev.textDays)) if (!(k in next.textDays)) textLines.push({ kind: 'remove', text: td.title })
  const pw = new Map(prev.warmup.map((w) => [w.name, w]))
  const nw = new Map(next.warmup.map((w) => [w.name, w]))
  for (const w of next.warmup) {
    const o = pw.get(w.name)
    if (!o) textLines.push({ kind: 'add', text: `Warm-up: ${w.name} ${w.dose}` })
    else if (o.dose !== w.dose) textLines.push({ kind: 'change', text: `Warm-up ${w.name}: ${o.dose} → ${w.dose}` })
  }
  for (const w of prev.warmup) if (!nw.has(w.name)) textLines.push({ kind: 'remove', text: `Warm-up: ${w.name}` })
  add('Cardio, rest days and warm-up', textLines)

  const all = sections.flatMap((s) => s.lines)
  const counts = { add: 0, remove: 0, change: 0 }
  for (const l of all) counts[l.kind]++
  return { sections, counts, same: all.length === 0 }
}

/** Things worth knowing about before switching, given what has already been logged. Never blocks. */
export function historyWarnings(prev: Program, next: Program, sessions: Session[]): string[] {
  const out: string[] = []
  const used = new Map<string, number>() // exercise id -> number of sessions with logged sets
  for (const s of sessions)
    for (const [id, log] of Object.entries(s.exercises)) if (log.sets.some((x) => x.done)) used.set(id, (used.get(id) ?? 0) + 1)

  const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const newByName = new Map(Object.entries(next.exercises).map(([id, e]) => [norm(e.name), id]))

  for (const [id, n] of used) {
    if (id in next.exercises) continue
    const name = prev.exercises[id]?.name ?? id
    const twin = newByName.get(norm(name))
    out.push(
      twin
        ? `"${name}" is now called id "${twin}" instead of "${id}". Your ${n} logged session${n > 1 ? 's' : ''} won't show as "last time". Ask the AI to keep id "${id}".`
        : `"${name}" is not in the new program. Its ${n} logged session${n > 1 ? 's' : ''} stay saved but won't appear as "last time".`,
    )
  }
  const goneDays = Object.keys(prev.days).filter((d) => !(d in next.days))
  for (const d of goneDays) {
    const n = sessions.filter((s) => s.dayId === d).length
    if (n) out.push(`${n} logged workout${n > 1 ? 's' : ''} used the day "${prev.days[d].title}", which no longer exists. They stay in your history and volume.`)
  }
  if (prev.start !== next.start && sessions.length)
    out.push(`The start date moves from ${prev.start} to ${next.start}. Week numbers and the volume chart weeks shift with it.`)
  return out
}
