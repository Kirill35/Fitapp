import { useEffect } from 'react'
import { fmtDate, fmtSets, fmtTarget, targetFor, videoUrl, type DayContext } from '../domain/program'
import type { DayItem, Difficulty, ExerciseDef, ExerciseLog, LastPerformance, Program, Session } from '../domain/types'
import { DifficultyTag, Stepper, VideoLink } from './common'

interface Props {
  program: Program
  ctx: DayContext
  item: DayItem
  session: Session | null
  lasts: Record<string, LastPerformance | null>
  onOpen(ids: string[]): void
  onChange(id: string, log: ExerciseLog): void
  onBack(): void
}

const valueStep = { reps: 1, sec: 5, m: 5, min: 1 } as const
const valueUnit = { reps: 'reps', sec: 'sec', m: 'metres', min: 'min' } as const

const DIFFICULTY: { d: Difficulty; hint: string; cls: string }[] = [
  { d: 'Easy', hint: '3+ left', cls: 'border-done text-done bg-done/15' },
  { d: 'Right', hint: '1–2 left', cls: 'border-plate text-plate bg-plate/15' },
  { d: 'Hard', hint: '0–1 left', cls: 'border-hard text-hard bg-hard/15' },
]

export default function LogView({ program, ctx, item, session, lasts, onOpen, onChange, onBack }: Props) {
  const ids = 'ex' in item ? [item.ex] : item.items
  const isGroup = 'group' in item

  useEffect(() => {
    onOpen(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useWakeLock()

  if (!session || ids.some((id) => !session.exercises[id])) return null

  const rounds = Math.max(...ids.map((id) => session.exercises[id].sets.length))
  const allDone = ids.every((id) => {
    const l = session.exercises[id]
    return l.sets.every((s) => s.done) && l.difficulty
  })

  const setField = (id: string, i: number, patch: { kg?: number; value?: number; done?: boolean }) => {
    const log = session.exercises[id]
    const old = log.sets[i]
    const sets = log.sets.map((s, j) => {
      if (j === i) return { ...s, ...patch }
      // A weight change carries forward to later, unconfirmed sets that had the same weight.
      if (patch.kg !== undefined && j > i && !s.done && s.kg === old.kg) return { ...s, kg: patch.kg }
      return s
    })
    onChange(id, { ...log, sets })
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <header className="pt-safe sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-2 pb-2 backdrop-blur">
        <button onClick={onBack} className="flex h-11 items-center gap-1 rounded-xl px-2 text-plate">
          <span className="text-2xl leading-none">‹</span> Today
        </button>
        <span className="truncate text-sm font-semibold tracking-wider text-muted uppercase">
          {isGroup ? item.group : ''}
        </span>
      </header>

      <main className="flex flex-col gap-5 px-4 pt-4 pb-32">
        {/* What and last time */}
        <section className="flex flex-col gap-3">
          {ids.map((id, j) => {
            const ex = program.exercises[id]
            const t = targetFor(ex, ctx, program)
            const last = lasts[id]
            return (
              <div key={id} className="flex items-start gap-3">
                {isGroup && <Letter n={j} />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 className="text-xl leading-tight font-bold">{ex.name}</h2>
                    <span className="num shrink-0 font-display text-xl font-semibold text-plate">{fmtTarget(ex, t)}</span>
                  </div>
                  {t.note && <div className="text-sm text-muted">{t.note}</div>}
                  <div className="num mt-1 text-sm">
                    <span className="text-muted">Last </span>
                    {last ? (
                      <>
                        {fmtDate(last.date)} · {fmtSets(ex, last.sets)} <DifficultyTag d={last.difficulty} />
                      </>
                    ) : (
                      <span className="text-muted">no log yet</span>
                    )}
                  </div>
                </div>
                <VideoLink href={videoUrl(ex)} />
              </div>
            )
          })}
        </section>

        {/* Sets, in the order you do them (A1, B1, A2, B2 …) */}
        <section className="flex flex-col gap-2">
          {Array.from({ length: rounds }, (_, r) =>
            ids.map((id, j) => {
              const ex = program.exercises[id]
              const s = session.exercises[id].sets[r]
              if (!s) return null
              return (
                <SetRow
                  key={`${id}-${r}`}
                  ex={ex}
                  label={isGroup ? `${String.fromCharCode(65 + j)}${r + 1}` : `Set ${r + 1}`}
                  sub={isGroup ? ex.name : undefined}
                  inputId={`${id}-${r}`}
                  set={s}
                  onKg={(kg) => setField(id, r, { kg })}
                  onValue={(value) => setField(id, r, { value })}
                  onDone={() => setField(id, r, { done: !s.done })}
                />
              )
            }),
          )}
        </section>

        {/* One difficulty tap per exercise */}
        <section className="flex flex-col gap-4">
          {ids.map((id, j) => {
            const log = session.exercises[id]
            return (
              <div key={id} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm text-muted">
                  {isGroup && <Letter n={j} small />}
                  How was {isGroup ? program.exercises[id].name : 'it'}?
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {DIFFICULTY.map(({ d, hint, cls }) => (
                    <button
                      key={d}
                      onClick={() => onChange(id, { ...log, difficulty: log.difficulty === d ? undefined : d })}
                      className={`flex h-16 flex-col items-center justify-center rounded-2xl border text-lg font-bold ${
                        log.difficulty === d ? cls : 'border-line bg-panel text-chalk'
                      }`}
                    >
                      {d}
                      <span className="text-xs font-normal opacity-75">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </section>

        {/* Result: today next to last time. Past data only. */}
        {allDone && (
          <section className="rounded-2xl border border-done/40 bg-done/10 px-4 py-3">
            <div className="mb-2 text-sm font-semibold text-done">✓ Logged</div>
            <dl className="num flex flex-col gap-2 text-[15px]">
              {ids.map((id) => {
                const ex = program.exercises[id]
                const log = session.exercises[id]
                const last = lasts[id]
                return (
                  <div key={id} className="grid grid-cols-[3.5rem_1fr] gap-x-2">
                    {ids.length > 1 && <div className="col-span-2 font-semibold">{ex.name}</div>}
                    <dt className="text-muted">Today</dt>
                    <dd>
                      {fmtSets(ex, log.sets)} <DifficultyTag d={log.difficulty} />
                    </dd>
                    <dt className="text-muted">Last</dt>
                    <dd className="text-muted">
                      {last ? (
                        <>
                          {fmtSets(ex, last.sets)} · {last.difficulty ?? '—'}
                        </>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </section>
        )}
      </main>

      <div className="pb-safe fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            onClick={onBack}
            className={`h-14 w-full rounded-2xl text-lg font-bold transition active:scale-[0.99] ${
              allDone ? 'bg-plate text-bg' : 'bg-panel-2 text-chalk'
            }`}
          >
            {allDone ? 'Done · back to today' : 'Back to today'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SetRow({
  ex,
  label,
  sub,
  inputId,
  set,
  onKg,
  onValue,
  onDone,
}: {
  ex: ExerciseDef
  label: string
  sub?: string
  inputId: string
  set: { kg?: number; value: number; done: boolean }
  onKg(v: number): void
  onValue(v: number): void
  onDone(): void
}) {
  const perUnit = ex.per && ex.measure === 'reps' ? `reps/${ex.per}` : valueUnit[ex.measure]
  return (
    <div className={`rounded-2xl border px-2.5 py-2 transition ${set.done ? 'border-done/50 bg-done/10' : 'border-line bg-panel'}`}>
      <div className="mb-1 flex items-baseline gap-2 text-sm">
        <span className="num font-bold">{label}</span>
        {sub && <span className="truncate text-muted">{sub}</span>}
      </div>
      <div className="flex items-center gap-2">
        {ex.load !== 'none' && (
          <Stepper wide id={`${inputId}-kg`} value={set.kg ?? 0} step={2.5} unit={ex.load === 'added' ? '+ kg' : 'kg'} onChange={onKg} />
        )}
        <Stepper id={`${inputId}-v`} value={set.value} step={valueStep[ex.measure]} unit={perUnit} onChange={onValue} />
        <button
          onClick={onDone}
          aria-label={set.done ? 'Undo set' : 'Confirm set'}
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl font-bold transition active:scale-95 ${
            set.done ? 'bg-done text-bg' : 'border-2 border-line text-muted'
          }`}
        >
          ✓
        </button>
      </div>
    </div>
  )
}

function Letter({ n, small }: { n: number; small?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-md bg-panel-2 font-bold text-plate ${
        small ? 'size-5 text-[11px]' : 'mt-0.5 size-6 text-xs'
      }`}
    >
      {String.fromCharCode(65 + n)}
    </span>
  )
}

/** Keep the screen on while logging; ignored where unsupported. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }
    nav.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {})
    return () => {
      lock?.release().catch(() => {})
    }
  }, [])
}
