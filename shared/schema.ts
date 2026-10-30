// Single source of truth for the shapes that cross the app/server boundary.
// The app, the Worker and the "import program" screen all validate with this file.
import { z } from 'zod'

// ---- Program ----

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'use lowercase letters, digits and dashes')
const dayKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/, 'letters, digits and dashes only')
const isoDate = z.iso.date()
const label = z.string().min(1).max(120)

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

const Reps = z.union([
  z.number().int().min(1).max(500),
  z.tuple([z.number().int().min(1).max(500), z.number().int().min(1).max(500)]).refine(([a, b]) => a <= b, 'range must go low to high'),
])

const Target = z.object({
  sets: z.number().int().min(1).max(20),
  reps: Reps,
  note: z.string().max(200).optional(),
})

export const ExerciseDef = Target.extend({
  name: label,
  load: z.enum(['kg', 'added', 'none']),
  measure: z.enum(['reps', 'sec', 'm', 'min']),
  per: z.enum(['side', 'leg', 'arm']).optional(),
  start: z.number().min(0).max(1000).optional(),
  /** Own technique link; otherwise the app builds a YouTube search link. */
  video: z.url({ protocol: /^https?$/ }).max(500).optional(),
  /** Words that identify the exercise in voice input. */
  aliases: z.array(z.string().min(1).max(60)).max(20).optional(),
  byBlock: z.record(z.string(), Target.partial()).optional(),
})

const DayItem = z.union([
  z.object({ ex: key }).strict(),
  z.object({ group: label, items: z.array(key).min(2).max(8) }).strict(),
])

const Block = z.object({
  id: dayKey,
  label: label,
  from: isoDate,
  to: isoDate,
  /** Set on deload weeks: the block whose reps the deload keeps. */
  deloadOf: dayKey.optional(),
})

const WarmupItem = z.object({ name: label, dose: z.string().max(60), video: z.url({ protocol: /^https?$/ }).max(500).optional() })

const addDaysUtc = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10)

export const ProgramSchema = z
  .object({
    start: isoDate,
    blocks: z.array(Block).min(1).max(40),
    /** weekday -> a key of `days` (gym) or `textDays` (plain text) */
    schedule: z.record(z.string(), z.string()),
    /** Days with plain text only (cardio, BJJ, rest). Text is per block id, "deload" or "default". */
    textDays: z.record(dayKey, z.object({ title: label, text: z.record(z.string(), z.string().max(600)) })),
    warmup: z.array(WarmupItem).max(40),
    exercises: z.record(key, ExerciseDef),
    /** Gym days, in the order shown. */
    days: z.record(dayKey, z.object({ title: label, items: z.array(DayItem).min(1).max(40) })),
  })
  .superRefine((p, ctx) => {
    const bad = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })

    // Blocks: contiguous, ordered, unique, deloads point at an earlier normal block.
    const ids = new Set<string>()
    p.blocks.forEach((b, i) => {
      if (ids.has(b.id)) bad(`duplicate block id "${b.id}"`, ['blocks', i, 'id'])
      if (b.to < b.from) bad('block ends before it starts', ['blocks', i, 'to'])
      if (i === 0 && b.from !== p.start) bad(`first block must start on the program start (${p.start})`, ['blocks', 0, 'from'])
      if (i > 0 && b.from !== addDaysUtc(p.blocks[i - 1].to, 1)) bad(`block must start the day after "${p.blocks[i - 1].id}" ends`, ['blocks', i, 'from'])
      if (b.deloadOf) {
        const target = p.blocks.slice(0, i).find((x) => x.id === b.deloadOf)
        if (!target || target.deloadOf) bad(`deloadOf "${b.deloadOf}" must be an earlier, non-deload block`, ['blocks', i, 'deloadOf'])
      }
      ids.add(b.id)
    })
    const normal = new Set(p.blocks.filter((b) => !b.deloadOf).map((b) => b.id))

    // Days: no clash with text days, every exercise exists, no exercise twice in a day.
    for (const [d, day] of Object.entries(p.days)) {
      if (d in p.textDays) bad(`"${d}" is both a gym day and a text day`, ['days', d])
      const seen = new Set<string>()
      day.items.forEach((it, i) => {
        for (const id of 'ex' in it ? [it.ex] : it.items) {
          if (!(id in p.exercises)) bad(`unknown exercise "${id}"`, ['days', d, 'items', i])
          if (seen.has(id)) bad(`exercise "${id}" appears twice on ${d}`, ['days', d, 'items', i])
          seen.add(id)
        }
      })
    }

    // Schedule: all seven weekdays, each pointing at a real day.
    for (const k of Object.keys(p.schedule)) if (!(WEEKDAYS as readonly string[]).includes(k)) bad(`"${k}" is not a weekday (use mon..sun)`, ['schedule', k])
    for (const w of WEEKDAYS) {
      const v = p.schedule[w]
      if (!v) bad(`missing ${w}`, ['schedule', w])
      else if (!(v in p.days) && !(v in p.textDays)) bad(`"${v}" is not a day`, ['schedule', w])
    }

    // Per-block overrides must name real, non-deload blocks.
    for (const [id, ex] of Object.entries(p.exercises))
      for (const b of Object.keys(ex.byBlock ?? {})) if (!normal.has(b)) bad(`"${b}" is not a block`, ['exercises', id, 'byBlock', b])

    // Text days must cover every block (own text or "default").
    for (const [d, td] of Object.entries(p.textDays)) {
      for (const k of Object.keys(td.text)) if (k !== 'default' && k !== 'deload' && !normal.has(k)) bad(`"${k}" is not a block`, ['textDays', d, 'text', k])
      for (const b of p.blocks) {
        const k = b.deloadOf ? 'deload' : b.id
        if (!(k in td.text) && !('default' in td.text)) bad(`no text for "${k}" and no "default"`, ['textDays', d, 'text'])
      }
    }
  })

export type Program = z.infer<typeof ProgramSchema>

export type ProgramCheck = { ok: true; program: Program } | { ok: false; errors: string[] }

/** Validate unknown JSON and return readable errors ("exercises.bench.sets: ..."). */
export function checkProgram(input: unknown): ProgramCheck {
  const r = ProgramSchema.safeParse(input)
  if (r.success) return { ok: true, program: r.data }
  return { ok: false, errors: r.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || 'program'}: ${i.message}`) }
}

// ---- Logged sessions ----

export const SetLog = z.object({
  /** Weight in kg (or added kg). Absent for unloaded exercises. */
  kg: z.number().min(0).max(2000).optional(),
  /** Reps, seconds, metres or minutes depending on the exercise. */
  value: z.number().min(0).max(100_000),
  done: z.boolean(),
})

export const ExerciseLog = z.object({
  sets: z.array(SetLog).max(30),
  difficulty: z.enum(['Easy', 'Right', 'Hard']).optional(),
})

export const SessionSchema = z.object({
  /** `${date}:${dayId}` */
  id: z.string().min(3).max(80),
  date: isoDate,
  dayId: dayKey,
  blockId: z.string().max(40).nullable(),
  /** Which program version this was logged against. */
  programVersion: z.number().int().min(0).optional(),
  status: z.enum(['in-progress', 'done']),
  exercises: z.record(z.string().max(40), ExerciseLog).refine((e) => Object.keys(e).length <= 80, 'too many exercises'),
  /** Client time of the last edit; decides conflicts. */
  updatedAt: z.string().max(40),
})

export type Session = z.infer<typeof SessionSchema>
export type SetLog = z.infer<typeof SetLog>
export type ExerciseLog = z.infer<typeof ExerciseLog>
