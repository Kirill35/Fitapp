import { useState } from 'react'
import { dayExerciseIds, fmtDate, fmtKg, fmtSets, fmtTarget, targetFor, textDayBody, videoUrl, type DayContext } from '../domain/program'
import { applyVoice } from '../domain/voice'
import type { DayId, ExerciseLog, LastPerformance, Program, Session, WarmupItem } from '../domain/types'
import { BackBar, DifficultyTag, VideoLink } from './common'
import VoiceSheet, { MicButton } from './VoiceSheet'

interface Props {
  program: Program
  ctx: DayContext
  isToday: boolean
  dayId: DayId | null
  isOverride: boolean
  session: Session | null
  lasts: Record<string, LastPerformance | null>
  onBack(): void
  onPickDay(d: DayId | null): void
  onOpenItem(i: number): void
  onEdit(ids: string[], mutate: (ex: Record<string, ExerciseLog>) => void): void
  onFinish(): void
}

export default function DayView(p: Props) {
  const { program, ctx, dayId, session } = p
  const [voice, setVoice] = useState(false)
  const title = dayId ? program.days[dayId].title : program.textDays[ctx.dayKey].title
  const doneSets = session ? Object.values(session.exercises).some((l) => l.sets.some((s) => s.done)) : false
  const where = ctx.block ? `${ctx.block.deloadOf ? 'Deload' : ctx.block.label} · Week ${ctx.weekInBlock}` : 'Outside the program'

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <BackBar label="Home" onBack={p.onBack} />
      <header className="px-4 pt-2 pb-4">
        <div className="num text-sm text-muted">
          {fmtDate(ctx.date)}
          {p.isToday && <span className="ml-2 rounded bg-plate/15 px-1.5 py-0.5 text-xs font-semibold text-plate">TODAY</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display text-4xl font-bold tracking-tight">{title}</h1>
          {ctx.deload && <span className="rounded-md bg-deload px-2 py-0.5 text-xs font-bold tracking-widest text-bg">DELOAD</span>}
        </div>
        <div className="mt-1 text-[15px] text-muted">{where}</div>
      </header>

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
              const allDone = !!session && ids.every((id) => session.exercises[id]?.sets.some((s) => s.done))
              return (
                <button
                  key={i}
                  onClick={() => p.onOpenItem(i)}
                  className={`w-full rounded-2xl border bg-panel text-left transition active:scale-[0.99] ${
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
                </button>
              )
            })}
          </>
        )}
      </main>

      {dayId && (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 px-4 pt-3 backdrop-blur">
          <div className="mx-auto flex max-w-lg gap-2">
            <MicButton onClick={() => setVoice(true)} />
            {session?.status === 'done' ? (
              <div className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-done/15 font-semibold text-done">
                ✓ Workout saved
              </div>
            ) : (
              <button
                disabled={!doneSets}
                onClick={p.onFinish}
                className="h-14 flex-1 rounded-2xl bg-plate text-lg font-bold text-bg transition active:scale-[0.99] disabled:bg-panel-2 disabled:text-muted"
              >
                Finish workout
              </button>
            )}
          </div>
        </div>
      )}

      {voice && dayId && (
        <VoiceSheet
          program={program}
          exerciseIds={dayExerciseIds(program, dayId)}
          onApply={(id, r) => p.onEdit([id], (ex) => (ex[id] = applyVoice(ex[id], r)))}
          onClose={() => setVoice(false)}
        />
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
      </div>

      <dl className={`grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1 text-sm ${letter ? 'pl-9' : ''}`}>
        <dt className="text-muted">Last</dt>
        <dd className="num min-w-0">
          {last ? (
            <>
              {fmtDate(last.date)} · {fmtSets(ex, last.sets)} <DifficultyTag d={last.difficulty} />
            </>
          ) : (
            <span className="text-muted">No log yet{ex.start !== undefined ? ` · program start ${fmtKg(ex, ex.start)}` : ''}</span>
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

function Warmup({ items }: { items: WarmupItem[] }) {
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
        <ol className="divide-y divide-line border-t border-line text-[15px]">
          {items.map((w) => (
            <li key={w.name} className="flex items-center gap-3 py-1 pr-3 pl-4">
              <span className="min-w-0 flex-1">{w.name}</span>
              <span className="num shrink-0 text-muted">{w.dose}</span>
              <VideoLink href={videoUrl(w)} small />
            </li>
          ))}
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
