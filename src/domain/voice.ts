// Turns a spoken phrase like "bench 3 sets 85 kilos 5 reps easy" into numbers.
// Pure function, no imports, so it is easy to test and to move server-side later.

export interface VoiceCandidate {
  id: string
  name: string
  aliases?: string[]
  hasLoad: boolean
}

export interface VoiceResult {
  exerciseId?: string
  sets?: number
  kg?: number
  /** One value per set, or a single value for all sets. Reps, seconds, metres or minutes. */
  values?: number[]
  difficulty?: 'Easy' | 'Right' | 'Hard'
}

const UNIT = '(?:reps?|repetitions?|seconds?|secs?|s|metres?|meters?|m|minutes?|min)\\b'

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** "one hundred twelve point five" → "112.5"; leaves other words alone. */
function wordsToDigits(text: string): string {
  const out: string[] = []
  let cur: number | null = null
  let decimal = false
  const flush = () => {
    if (cur !== null) out.push(String(cur))
    cur = null
    decimal = false
  }
  for (const w of text.split(/\s+/)) {
    if (w in UNITS || w in TENS) {
      const n = UNITS[w] ?? TENS[w]
      if (decimal && cur !== null) {
        cur = Number(`${cur}.${n}`)
        decimal = false
      } else cur = (cur ?? 0) + n
    } else if (w === 'hundred' && cur !== null) cur *= 100
    else if (w === 'hundred') cur = 100
    else if (w === 'and' && cur !== null && cur >= 100) continue
    else if ((w === 'point' || w === 'dot') && cur !== null) decimal = true
    else if (w === 'half' && out.length && out[out.length - 1] === 'and' && cur === null) {
      out.pop()
      const prev = Number(out.pop())
      out.push(String(prev + 0.5))
    } else {
      flush()
      out.push(w)
    }
  }
  flush()
  return out.join(' ')
}

export function normalize(text: string): string {
  let t = text.toLowerCase().replace(/[-–—]/g, ' ').replace(/[^\w\s.,+@']/g, ' ')
  t = t.replace(/\ba half\b/g, 'half').replace(/\bplus\b/g, '+')
  t = wordsToDigits(t.replace(/,/g, ' , ').replace(/\s+/g, ' ').trim())
  return t.replace(/\+\s+(?=\d)/g, '+').replace(/\s+,/g, ',').replace(/\s+/g, ' ')
}

export function parseVoice(text: string, candidates: VoiceCandidate[], fallbackId?: string): VoiceResult {
  let t = ` ${normalize(text)} `
  const r: VoiceResult = {}
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = t.match(re)
    if (m) t = t.replace(m[0], ' ')
    return m
  }

  // Exercise: the longest alias or name found in the phrase.
  let best: { id: string; len: number } | null = null
  for (const c of candidates) {
    for (const a of [c.name, c.name.replace(/\s*\(.*\)/, ''), ...(c.aliases ?? [])]) {
      const n = normalize(a)
      if (n && t.includes(` ${n} `) && (!best || n.length > best.len)) best = { id: c.id, len: n.length }
    }
  }
  if (best) {
    const c = candidates.find((x) => x.id === best!.id)!
    for (const a of [c.name, ...(c.aliases ?? [])].map(normalize).sort((a, b) => b.length - a.length)) {
      if (t.includes(` ${a} `)) {
        t = t.replace(` ${a} `, ' ')
        break
      }
    }
    r.exerciseId = c.id
  } else r.exerciseId = fallbackId
  const hasLoad = candidates.find((c) => c.id === r.exerciseId)?.hasLoad ?? true

  const diff = take(/\b(easy|right|hard|just right|ok|okay|grind(?:ing)?)\b/)
  if (diff) r.difficulty = /easy/.test(diff[1]) ? 'Easy' : /hard|grind/.test(diff[1]) ? 'Hard' : 'Right'

  const NUM = '(\\+?\\d+(?:\\.\\d+)?)'
  const kg =
    take(new RegExp(`${NUM}\\s*(?:kg|kgs|kilo|kilos|kilogram|kilograms|k)\\b`)) ??
    take(/\+(\d+(?:\.\d+)?)/) ??
    take(new RegExp(`(?:at|@|with)\\s*${NUM}`))
  if (kg) r.kg = Math.abs(Number(kg[1]))

  const sxr = take(/(\d+)\s*(?:x|by|times|sets of)\s*(\d+)/)
  if (sxr) {
    r.sets = Number(sxr[1])
    r.values = [Number(sxr[2])]
  }
  const sets = take(/(\d+)\s*sets?\b/) ?? take(/\bsets?\s*(\d+)/)
  if (sets) r.sets = Number(sets[1])

  // An unlabeled big number is the weight ("deadlift 110 5 5 5").
  if (r.kg === undefined && hasLoad) {
    for (const m of t.matchAll(new RegExp(`(?<![\\d.])(\\d+(?:\\.\\d+)?)(?!\\d|\\.\\d|\\s*${UNIT})`, 'g'))) {
      if (Number(m[1]) >= 15) {
        r.kg = Number(m[1])
        t = t.slice(0, m.index) + ' ' + t.slice(m.index! + m[0].length)
        break
      }
    }
  }

  const list = take(new RegExp(`(\\d+(?:(?:\\s*,\\s*|\\s+)\\d+){1,})(?:\\s*${UNIT})?`))
  const single = !list && (take(new RegExp(`(\\d+)\\s*${UNIT}`)) ?? take(/\b(?:reps?|for)\s*(\d+)/))
  if (list) r.values = list[1].split(/[\s,]+/).filter(Boolean).map(Number)
  else if (single) r.values = [Number(single[1])]

  // Leftover bare numbers: a big one is the weight, then sets, then reps.
  const rest = (t.match(/\+?\d+(?:\.\d+)?/g) ?? []).map(Number)
  for (const n of rest) {
    if (r.kg === undefined && hasLoad && n >= 15) r.kg = Math.abs(n)
    else if (r.sets === undefined && n <= 10 && r.values) r.sets = n
    else if (!r.values) r.values = [n]
    else if (r.sets === undefined && n <= 10) r.sets = n
  }

  // "85 kilos 5 5 4": a list of values implies the set count.
  if (r.values && r.values.length > 1 && r.sets === undefined) r.sets = r.values.length
  return r
}

interface LogLike {
  sets: { kg?: number; value: number; done: boolean }[]
  difficulty?: 'Easy' | 'Right' | 'Hard'
}

/**
 * Applies a voice result to an exercise log.
 * With a set count ("3 sets …") it fills and confirms sets 1..n.
 * Without one ("85 kilos 5") it fills and confirms the next unconfirmed set.
 */
export function applyVoice<L extends LogLike>(log: L, r: VoiceResult): L {
  const sets = log.sets.map((s) => ({ ...s }))
  const firstOpen = sets.findIndex((s) => !s.done)
  const from = r.sets ? 0 : firstOpen === -1 ? sets.length : firstOpen
  const count = r.sets ?? (r.values?.length || (r.kg !== undefined ? 1 : 0))
  const oldKg = sets[from]?.kg
  for (let i = 0; i < count; i++) {
    const j = from + i
    const prev = sets[j] ?? sets[sets.length - 1] ?? { value: 0, done: false }
    sets[j] = {
      kg: prev.kg === undefined ? undefined : (r.kg ?? prev.kg),
      value: r.values?.[i] ?? r.values?.[r.values.length - 1] ?? prev.value,
      done: true,
    }
  }
  // Like the stepper: a new weight carries forward to later unconfirmed sets that had the old one.
  if (r.kg !== undefined && oldKg !== undefined) {
    for (let j = from + count; j < sets.length; j++) if (!sets[j].done && sets[j].kg === oldKg) sets[j].kg = r.kg
  }
  return { ...log, sets, difficulty: r.difficulty ?? log.difficulty }
}

/** "3 sets · 85 kg · 5,5,4 · Easy" */
export function describeVoice(r: VoiceResult, unit: string): string {
  const parts: string[] = []
  if (r.sets) parts.push(`${r.sets} set${r.sets > 1 ? 's' : ''}`)
  else if (r.kg !== undefined || r.values) parts.push('next set')
  if (r.kg !== undefined) parts.push(`${r.kg} kg`)
  if (r.values) parts.push(`${r.values.join(',')} ${unit}`)
  if (r.difficulty) parts.push(r.difficulty)
  return parts.join(' · ')
}
