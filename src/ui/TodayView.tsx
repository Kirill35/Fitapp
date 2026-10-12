import { useState } from 'react'
import { fmtDate, fmtSets, fmtTarget, fmtKg, targetFor, textDayBody, videoUrl, type DayContext } from '../domain/program'
import type { DayId, LastPerformance, Program, Session } from '../domain/types'
import { DifficultyTag, Header, VideoLink } from './common'

interface Props {
  program: Program
  ctx: DayContext
  dayId: DayId | null
  isOverride: boolean
  previewDate: string | null
  session: Session | null
  lasts: Record<string, LastPerformance | null>
  onPickDay(d: DayId | null): void
  onOpenItem(i: number): void
  onFinish(): void
  onSettings(): void
}

export default function TodayView(p: Props) {
  const { program, ctx, dayId, session } = p
  const title = dayId ? program.days[dayId].title : program.textDays[ctx.dayKey].title
  const doneSets = session ? Object.values(session.exercises).some((l) => l.sets.some((s) => s.done)) : false

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <Header ctx={p.ctx} title={title} previewDate={p.previewDate} onSettings={p.onSettings} />

      <main className="flex flex-1 flex-col gap-3 px-4 pb-32">
        {!dayId && <TextDay program={program} ctx={ctx} onPickDay={p.onPickDay} />}

        {dayId && (
          <>
            {p.isOverride && (
              <button onClick={() => p.onPickDay(null)} className="self-start text-sm text-muted underline underline-offset-4">
                Back to {program.textDays[ctx.dayKey]?.title ?? 'scheduled day'}
              </button>
            )}
            <Warmup items={program.warmup} />
            {program.days[dayId].items.map((item, i) => {
              const ids = 'ex' in item ? [item.ex] : item.items
              const allDone =
                !!session && ids.every((id) => session.exercises[id]?.sets.some((s) => s.done))
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => p.onOpenItem(i)}
                  onKeyDown={(e) => e.key === 'Enter' && p.onOpenItem(i)}
                  className={`w-full cursor-pointer rounded-2xl border bg-panel text-left transition active:scale-[0.99] ${
                    allDone ? 'border-done/50' : 'border-line'
                  }`}
                >
                  {'group' in item && (
                    <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs font-semibold tracking-wider text-muted uppercase">
                      <span>{item.group}</span>
                      {allDone && <span className="text-done">✓ Logged</span>}
                    </div>
                  )}
                  <div className="divide-y divide-line">
                    {ids.map((id, j) => (
                      <ExerciseRow
                        key={id}
                        program={program}
                        ctx={ctx}
                        id={id}
                        letter={'group' in item ? String.fromCharCode(65 + j) : undefined}
                        last={p.lasts[id]}
                        session={session}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </main>

      {dayId && (
        <div className="pb-safe fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 px-4 pt-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            {session?.status === 'done' ? (
              <div className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-done/15 font-semibold text-done">
                ✓ Workout saved
                <span className="text-sm font-normal text-muted">· edits save automatically</span>
              </div>
            ) : (
              <button
                disabled={!doneSets}
                onClick={p.onFinish}
                className="h-14 w-full rounded-2xl bg-plate text-lg font-bold text-bg transition active:scale-[0.99] disabled:bg-panel-2 disabled:text-muted"
              >
                Finish workout
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ExerciseRow({
  program,
  ctx,
  id,
  letter,
  last,
  session,
}: {
  program: Program
  ctx: DayContext
  id: string
  letter?: string
  last: LastPerformance | null | undefined
  session: Session | null
}) {
  const ex = program.exercises[id]
  const t = targetFor(ex, ctx, program)
  const today = session?.exercises[id]
  const todayDone = today?.sets.filter((s) => s.done) ?? []

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-start gap-3">
        {letter && (
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-panel-2 text-xs font-bold text-plate">
            {letter}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[17px] leading-snug font-semibold">{ex.name}</span>
            <span className="num shrink-0 font-display text-[17px] font-semibold text-plate">{fmtTarget(ex, t)}</span>
          </div>
          {t.note && <div className="text-sm text-muted">{t.note}</div>}
        </div>
        <VideoLink href={videoUrl(ex)} />
      </div>

      <dl className={`grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1 text-sm ${letter ? 'pl-9' : ''}`}>
        <dt className="text-muted">Last</dt>
        <dd className="num min-w-0">
          {last ? (
            <>
              {fmtDate(last.date)} · {fmtSets(ex, last.sets)} <DifficultyTag d={last.difficulty} />
            </>
          ) : (
            <span className="text-muted">
              No log yet{ex.start !== undefined ? ` · program start ${fmtKg(ex, ex.start)}` : ''}
            </span>
          )}
        </dd>
        {todayDone.length > 0 && (
          <>
            <dt className="text-done">Today</dt>
            <dd className="num min-w-0 text-done">
              {fmtSets(ex, todayDone)} <DifficultyTag d={today?.difficulty} />
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}

function Warmup({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-line bg-panel">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="font-semibold">
          Warm-up <span className="font-normal text-muted">· {items.length}</span>
        </span>
        <span className={`text-muted transition ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <ol className="flex flex-col gap-2 border-t border-line px-4 py-3 text-[15px]">
          {items.map((w) => {
            const [name, dose] = w.split(' · ')
            return (
              <li key={w} className="flex justify-between gap-3">
                <span>{name}</span>
                <span className="num shrink-0 text-muted">{dose}</span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function TextDay({ program, ctx, onPickDay }: { program: Program; ctx: DayContext; onPickDay(d: DayId): void }) {
  const body = textDayBody(program, ctx)
  return (
    <>
      <div className="rounded-2xl border border-line bg-panel px-5 py-5">
        <ul className="flex flex-col gap-2 text-lg leading-snug">
          {body.text.split('\n').map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>Training on a different day?</span>
        {(['A', 'B'] as DayId[]).map((d) => (
          <button key={d} onClick={() => onPickDay(d)} className="rounded-lg border border-line px-3 py-2 font-semibold whitespace-nowrap text-chalk">
            Do {program.days[d].title}
          </button>
        ))}
      </div>
    </>
  )
}
