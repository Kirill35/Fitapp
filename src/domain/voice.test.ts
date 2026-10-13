// Run: npm test  (Node's built-in TypeScript stripping, no extra deps)
import assert from 'node:assert/strict'
import { applyVoice, parseVoice } from './voice.ts'

const c = [
  { id: 'bench', name: 'Bench press', aliases: ['bench'], hasLoad: true },
  { id: 'deadlift', name: 'Deadlift', aliases: ['deadlift'], hasLoad: true },
  { id: 'pullups', name: 'Pull-ups', aliases: ['pull ups', 'pullups'], hasLoad: true },
  { id: 'farmer', name: 'Farmer carry', aliases: ['farmer'], hasLoad: true },
  { id: 'nordic', name: 'Nordic hamstring curl', aliases: ['nordic'], hasLoad: false },
]
const cases: [string, object][] = [
  ['Bench 3 sets 85 kilos 5 reps easy', { exerciseId: 'bench', sets: 3, kg: 85, values: [5], difficulty: 'Easy' }],
  ['bench press three sets of five at eighty five', { exerciseId: 'bench', sets: 3, kg: 85, values: [5] }],
  ['deadlift 110 5 5 4 hard', { exerciseId: 'deadlift', sets: 3, kg: 110, values: [5, 5, 4], difficulty: 'Hard' }],
  ['deadlift one hundred twelve point five for five, five, five', { exerciseId: 'deadlift', sets: 3, kg: 112.5, values: [5, 5, 5] }],
  ['pull ups plus ten 3 sets 5 reps', { exerciseId: 'pullups', sets: 3, kg: 10, values: [5] }],
  ['farmer 3 sets 30 metres 32 kg', { exerciseId: 'farmer', sets: 3, kg: 32, values: [30] }],
  ['nordic 2 sets 5 reps right', { exerciseId: 'nordic', sets: 2, values: [5], difficulty: 'Right' }],
  ['85 kilos 5', { exerciseId: 'bench', kg: 85, values: [5] }],
]
for (const [text, want] of cases) assert.deepEqual(parseVoice(text, c, 'bench'), want, text)

const log = { sets: [{ kg: 80, value: 5, done: true }, { kg: 80, value: 5, done: false }, { kg: 80, value: 5, done: false }] }
assert.deepEqual(applyVoice(log, { kg: 82.5, values: [5] }).sets, [
  { kg: 80, value: 5, done: true },
  { kg: 82.5, value: 5, done: true },
  { kg: 82.5, value: 5, done: false },
])
assert.deepEqual(applyVoice(log, { sets: 2, kg: 85, values: [5, 4] }).sets.map((s) => [s.kg, s.value, s.done]), [
  [85, 5, true],
  [85, 4, true],
  [85, 5, false],
])
console.log(`voice: ${cases.length + 2} checks passed`)
