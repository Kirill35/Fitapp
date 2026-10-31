import { dayExerciseIds, fmtDate, fmtSets } from './program'
import { lastPerformance } from './history'
import type { Program, Session } from './types'

/** Pull a JSON object out of whatever the AI answered (fenced block, prose around it, or bare JSON). */
export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = text.trim()
  if (!t) return { ok: false, error: 'Nothing pasted yet.' }
  const candidates: string[] = []
  for (const m of t.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g)) candidates.push(m[1].trim())
  candidates.push(t)
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first === -1) return { ok: false, error: 'No JSON object found. Ask the AI to reply with the complete program as one JSON object.' }
  if (last > first) candidates.push(t.slice(first, last + 1))
  let firstError = ''
  for (const c of candidates) {
    try {
      const v = JSON.parse(c)
      if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v }
    } catch (e) {
      firstError ||= e instanceof Error ? e.message : 'invalid JSON'
    }
  }
  return {
    ok: false,
    error: firstError
      ? `This is not valid JSON (${firstError}). Ask the AI to reply with the complete JSON only.`
      : 'No JSON object found. Ask the AI to reply with the complete program as one JSON object.',
  }
}

const REFERENCE = `FORMAT (one JSON object, these keys only):
- "start": "YYYY-MM-DD", the first day of the program. Weeks run for 7 days starting on that weekday.
- "blocks": ordered list of { "id", "label", "from", "to", "deloadOf"? }. Blocks must be back to back: each "from" is the day after the previous "to"; the first "from" equals "start". A deload week has "deloadOf" set to the id of an earlier normal block (the app then shows 2 sets, same weight, that block's reps).
- "schedule": all seven weekdays "mon".."sun", each pointing at a key of "days" (a gym day) or of "textDays".
- "days": gym days, in display order: { "<key>": { "title", "items": [ { "ex": "<exercise id>" } or { "group": "Superset 1", "items": ["<id>", "<id>"] } ] } }. Supersets have 2 to 8 exercises. An exercise appears at most once per day.
- "textDays": days that are plain text (cardio, martial arts, rest): { "<key>": { "title", "text": { "<block id>" | "deload" | "default": "text, lines separated by \\n" } } }. Every block needs its own text or a "default".
- "warmup": list of { "name", "dose", "video"? } shown before gym days.
- "exercises": { "<id>": { "name", "load": "kg" | "added" | "none", "measure": "reps" | "sec" | "m" | "min", "sets", "reps" (a number, or [low, high]), "per"?: "side" | "leg" | "arm", "start"? (starting weight in kg; for "added" it is the extra weight), "note"?, "video"? (https link), "aliases"? (words someone would say aloud for voice input), "byBlock"?: { "<block id>": { "sets"?, "reps"?, "note"? } } }.
  - "load": "kg" = barbell or dumbbell weight, "added" = extra weight on bodyweight movements (pull-ups, dips), "none" = no weight.
  - Per-block changes (for example 3×5 in block 1 and 4×3 in block 2) go in "byBlock"; anything not listed uses the base values.
- Exercise ids and block ids use lowercase letters, digits and dashes.`

/** A ready-to-paste prompt: what to change, the exact format, the current program and the recent history. */
export function buildProgramPrompt(program: Program, sessions: Session[], request: string, today: string): string {
  const exerciseOrder = [...new Set(Object.keys(program.days).flatMap((d) => dayExerciseIds(program, d)))]
  const known = Object.entries(program.exercises).map(([id, e]) => `- ${id}: ${e.name}`).join('\n')

  const history = exerciseOrder
    .flatMap((id) => {
      const ex = program.exercises[id]
      const recent = sessions
        .filter((s) => s.exercises[id]?.sets.some((x) => x.done))
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 3)
      if (!recent.length || !ex) return []
      const parts = recent.map((s) => {
        const last = lastPerformance([s], id, '9999-12-31')!
        return `${fmtDate(s.date)} ${fmtSets(ex, last.sets)}${last.difficulty ? ` ${last.difficulty}` : ''}`
      })
      return [`- ${ex.name} (${id}): ${parts.join(' | ')}`]
    })
    .join('\n')

  return `You are helping me update my strength training program for a workout tracking app. Today is ${today}.

WHAT I WANT:
${request.trim() || '(Describe the change here, for example: "Plan the next 8 weeks as two 4-week blocks with a deload week in between. Keep my current exercises, but add one more pulling movement on day A.")'}

HOW TO ANSWER:
Reply with the COMPLETE updated program as ONE JSON object and nothing else: no explanation, no comments, no trailing commas. Keep everything I did not ask to change exactly as it is. Use fixed targets only (sets, reps, a starting weight); do not add rules that depend on how a session goes.

${REFERENCE}

EXERCISE IDS I ALREADY HAVE. When a movement stays in the program, reuse its id exactly (my logged history is linked by id). Only invent a new id for a genuinely new movement:
${known}

MY RECENT HISTORY (most recent first, weight · reps per set):
${history || '(nothing logged yet)'}

MY CURRENT PROGRAM (the format to follow, and the starting point for changes):
${JSON.stringify(program)}`
}
