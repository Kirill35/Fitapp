import { useMemo, useState } from 'react'
import { countsForVolume, fmtVolume, monthPace, sessionVolume, volumeByMonth, volumeByWeek, weekPace, type PaceComparison } from '../domain/history'
import {
  addDays,
  blockNotes,
  blockTargets,
  dayContext,
  dayExerciseIds,
  dayTitle,
  fmtDate,
  fmtShort,
  isGymDay,
  parseDate,
  programWeeks,
  textDayBody,
  type ProgramWeek,
} from '../domain/program'
import type { Block, Program, Session } from '../domain/types'
import LineChart from './LineChart'

interface Props {
  program: Program
  today: string
  previewDate: string | null
  sessions: Session[]
  onOpenDay(date: string): void
  onSettings(): void
}

export default function HomeView({ program, today, previewDate, sessions, onOpenDay, onSettings }: Props) {
  const ctx = dayContext(program, today)
  const weeks = useMemo(() => programWeeks(program), [program])
  const blockWeeks = ctx.block ? weeks.filter((w) => w.block.id === ctx.block!.id).length : 0

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col pb-10">
      <header className="pt-safe px-4 pb-3">
        <div className="flex items-center justify-between text-sm text-muted">
          <span className="num">
            {fmtDate(today)}
            {previewDate && <span className="ml-2 rounded bg-plate/15 px-1.5 py-0.5 text-xs text-plate">preview date</span>}
          </span>
          <button onClick={onSettings} aria-label="Settings" className="-mr-2 grid size-10 place-items-center rounded-full text-lg">
            ⚙︎
          </button>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="font-display text-[34px] leading-tight font-bold tracking-tight">
            {ctx.status === 'before'
              ? 'Starts soon'
              : ctx.status === 'after'
                ? 'Program done'
                : `${ctx.block!.deloadOf ? 'Deload' : ctx.block!.label} · Week ${ctx.weekInBlock}`}
          </h1>
          {ctx.block && (
            <span className="num text-[15px] text-muted">
              of {blockWeeks} · until {fmtShort(ctx.block.to)}
            </span>
          )}
          {ctx.status === 'before' && <span className="text-[15px] text-muted">{fmtDate(program.start)}</span>}
        </div>
      </header>

      <main className="flex flex-col gap-6 px-4">
        <BlockStrip program={program} weeks={weeks} today={today} />
        <TodayCard program={program} today={today} sessions={sessions} onOpen={() => onOpenDay(today)} />
        <VolumeCard program={program} today={today} sessions={sessions} />
        <WeekList program={program} weeks={weeks} today={today} sessions={sessions} onOpenDay={onOpenDay} />
      </main>
    </div>
  )
}

function BlockStrip({ program, weeks, today }: { program: Program; weeks: ProgramWeek[]; today: string }) {
  const [sel, setSel] = useState<string | null>(null)
  const selected = program.blocks.find((b) => b.id === sel) ?? null
  return (
    <section className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        {program.blocks.map((b) => {
          const bw = weeks.filter((w) => w.block.id === b.id)
          const isSel = sel === b.id
          return (
            <button
              key={b.id}
              onClick={() => setSel(isSel ? null : b.id)}
              style={{ flexGrow: bw.length }}
              className="flex basis-0 flex-col gap-1.5 rounded-lg pt-1 text-left"
              aria-expanded={isSel}
            >
              <div className="flex gap-0.5">
                {bw.map((w) => {
                  const cur = today >= w.from && today <= w.to
                  const past = today > w.to
                  const tone = b.deloadOf ? 'bg-deload' : 'bg-plate'
                  return (
                    <span
                      key={w.n}
                      className={`h-2.5 flex-1 rounded-sm ${cur ? tone : past ? `${tone} opacity-40` : 'bg-line'} ${
                        cur ? 'ring-2 ring-chalk/70 ring-offset-1 ring-offset-bg' : ''
                      }`}
                    />
                  )
                })}
              </div>
              <span
                className={`text-xs font-semibold tracking-wide ${isSel ? 'text-chalk underline underline-offset-4' : 'text-muted'}`}
              >
                {b.deloadOf ? 'DL' : b.label}
              </span>
            </button>
          )
        })}
      </div>
      {selected ? (
        <BlockDetails program={program} block={selected} />
      ) : (
        <p className="text-xs text-muted">Tap a block to see what changes in it.</p>
      )}
    </section>
  )
}

export function BlockDetails({ program, block }: { program: Program; block: Block }) {
  const cardio = program.textDays.cardio?.text
  const weeks = Math.round((parseDate(block.to).getTime() - parseDate(block.from).getTime()) / 86_400_000 + 1) / 7
  return (
    <div className="rounded-2xl border border-line bg-panel px-4 py-3 text-[15px]">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-semibold">{block.deloadOf ? 'Deload week' : `Block ${block.label}`}</span>
        <span className="num text-sm text-muted">
          {fmtShort(block.from)} – {fmtShort(block.to)} · {weeks} wk
        </span>
      </div>
      {block.deloadOf ? (
        <ul className="flex flex-col gap-1">
          <li>2 sets of every exercise, same weight, {block.deloadOf} reps.</li>
          {cardio?.deload && <li className="text-muted">Cardio: {cardio.deload.replace(/\n/g, ' → ')}</li>}
        </ul>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {blockTargets(program, block.id).map((g) => (
            <li key={g.target} className="flex justify-between gap-3">
              <span className="min-w-0">{g.names.join(', ')}</span>
              <span className="num shrink-0 font-semibold text-plate">{g.target}</span>
            </li>
          ))}
          {blockNotes(program, block.id).map((n) => (
            <li key={n} className="text-muted">
              {n}
            </li>
          ))}
          {cardio?.[block.id] && <li className="text-muted">Cardio: {cardio[block.id].replace(/\n/g, ' → ')}</li>}
          <li className="text-muted">Everything else: same in every block.</li>
        </ul>
      )}
    </div>
  )
}

function TodayCard({ program, today, sessions, onOpen }: { program: Program; today: string; sessions: Session[]; onOpen(): void }) {
  const ctx = dayContext(program, today)
  const session = sessions.find((s) => s.date === today)
  const key = session?.dayId ?? ctx.dayKey
  let sub: string
  if (isGymDay(key)) {
    const ids = dayExerciseIds(program, key)
    const logged = ids.filter((id) => session?.exercises[id]?.sets.some((s) => s.done)).length
    sub =
      session?.status === 'done'
        ? `✓ Saved · ${fmtVolume(sessionVolume(program, session))}`
        : logged
          ? `In progress · ${logged} of ${ids.length} logged`
          : `${ids.length} exercises · warm-up ${program.warmup.length}`
  } else sub = textDayBody(program, ctx).text.replace(/\n/g, ' → ')

  return (
    <button onClick={onOpen} className="flex items-center gap-4 rounded-2xl bg-plate px-5 py-4 text-left text-bg active:scale-[0.99]">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold tracking-widest opacity-70">TODAY</div>
        <div className="flex items-center gap-2">
          <span className="font-display text-3xl font-bold">{dayTitle(program, key)}</span>
          {ctx.deload && <span className="rounded bg-bg px-1.5 py-0.5 text-[11px] font-bold tracking-widest text-deload">DELOAD</span>}
        </div>
        <div className="num text-[15px] font-medium opacity-80">{sub}</div>
      </div>
      <span className="text-4xl leading-none opacity-80">›</span>
    </button>
  )
}

function VolumeCard({ program, today, sessions }: { program: Program; today: string; sessions: Session[] }) {
  const [mode, setMode] = useState<'week' | 'month'>('week')
  const [exId, setExId] = useState('')
  const weekly = useMemo(() => volumeByWeek(program, sessions, today, exId || undefined), [program, sessions, today, exId])
  const monthly = useMemo(() => volumeByMonth(program, sessions, today, exId || undefined), [program, sessions, today, exId])
  const points = mode === 'week' ? weekly : monthly
  const hasData = points.some((p) => p.value > 0)
  const lifts = Object.entries(program.exercises).filter(([, ex]) => countsForVolume(ex))
  // Until today's workout is logged, compare up to yesterday on both sides.
  const loggedToday = sessions.some((s) => s.date === today && Object.values(s.exercises).some((l) => l.sets.some((x) => x.done)))
  const cutoff = loggedToday ? today : addDays(today, -1)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">Volume · weight × reps</h2>
        <div className="flex rounded-lg bg-panel p-0.5 text-sm">
          {(['week', 'month'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 ${mode === m ? 'bg-panel-2 font-semibold text-chalk' : 'text-muted'}`}
            >
              {m === 'week' ? 'Weeks' : 'Months'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tile label="This week so far" pace={weekPace(program, sessions, cutoff, exId || undefined)} prevLabel="last week" />
        <Tile label="This month so far" pace={monthPace(program, sessions, cutoff, exId || undefined)} prevLabel="last month" />
      </div>

      <div className="rounded-2xl border border-line bg-panel px-3 pt-3 pb-2">
        {hasData ? (
          <LineChart points={points} />
        ) : (
          <p className="py-10 text-center text-sm text-muted">Log a workout to see your volume here.</p>
        )}
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-line pt-2">
          <select
            id="volume-exercise"
            value={exId}
            onChange={(e) => setExId(e.target.value)}
            className="min-w-0 bg-transparent text-sm font-semibold text-chalk"
          >
            <option value="">All lifts</option>
            {lifts.map(([id, ex]) => (
              <option key={id} value={id}>
                {ex.name}
              </option>
            ))}
          </select>
          {mode === 'week' && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
              <span className="size-2.5 rounded-sm bg-deload/40" /> deload
            </span>
          )}
        </div>
      </div>
    </section>
  )
}

function Tile({ label, pace, prevLabel }: { label: string; pace: PaceComparison; prevLabel: string }) {
  const { current, previous } = pace
  const pct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : null
  return (
    <div className="rounded-2xl border border-line bg-panel px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="num font-display text-2xl font-bold">{fmtVolume(current)}</div>
      <div className={`num text-xs ${pct === null ? 'text-muted' : pct >= 0 ? 'text-done' : 'text-hard'}`}>
        {pct === null ? `nothing ${prevLabel}` : `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${prevLabel}`}
      </div>
    </div>
  )
}

function WeekList({
  program,
  weeks,
  today,
  sessions,
  onOpenDay,
}: {
  program: Program
  weeks: ProgramWeek[]
  today: string
  sessions: Session[]
  onOpenDay(d: string): void
}) {
  const cur = weeks.findIndex((w) => today >= w.from && today <= w.to)
  const focus = cur === -1 ? (today < program.start ? 0 : weeks.length - 1) : cur
  const past = weeks.slice(0, focus)
  const [showPast, setShowPast] = useState(false)
  const [open, setOpen] = useState<Set<number>>(() => new Set([weeks[focus]?.n]))
  const toggle = (n: number) =>
    setOpen((s) => {
      const x = new Set(s)
      if (x.has(n)) x.delete(n)
      else x.add(n)
      return x
    })

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">Program</h2>
      <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
        {past.length > 0 && (
          <button onClick={() => setShowPast(!showPast)} className="flex w-full items-center justify-between px-4 py-3 text-left text-muted">
            <span>
              Past weeks <span className="num">· {past.length}</span>
            </span>
            <span className={`transition ${showPast ? 'rotate-180' : ''}`}>▾</span>
          </button>
        )}
        {weeks.map((w, i) =>
          i < focus && !showPast ? null : (
            <WeekRow
              key={w.n}
              program={program}
              week={w}
              today={today}
              sessions={sessions}
              open={open.has(w.n)}
              onToggle={() => toggle(w.n)}
              onOpenDay={onOpenDay}
            />
          ),
        )}
      </div>
    </section>
  )
}

function WeekRow({
  program,
  week,
  today,
  sessions,
  open,
  onToggle,
  onOpenDay,
}: {
  program: Program
  week: ProgramWeek
  today: string
  sessions: Session[]
  open: boolean
  onToggle(): void
  onOpenDay(d: string): void
}) {
  const isCur = today >= week.from && today <= week.to
  const gymDays = week.days.filter((d) => isGymDay(d.dayKey))
  const done = week.days.filter((d) => sessions.some((s) => s.date === d.date && s.exercises && Object.values(s.exercises).some((l) => l.sets.some((x) => x.done)))).length
  const blockLabel = week.block.deloadOf ? 'Deload' : `${week.block.label} · wk ${week.weekInBlock}`

  return (
    <div className={isCur ? 'bg-panel-2/50' : ''}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={`num w-8 shrink-0 font-display font-bold ${isCur ? 'text-plate' : ''}`}>W{week.n}</span>
        <span className="num min-w-0 flex-1 text-sm text-muted">
          {fmtShort(week.from)} – {fmtShort(week.to)}
        </span>
        <span className={`shrink-0 text-xs font-semibold ${week.block.deloadOf ? 'text-deload' : 'text-muted'}`}>{blockLabel}</span>
        <span className="num w-9 shrink-0 text-right text-xs text-muted">
          {done}/{gymDays.length}
        </span>
        <span className={`shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {open && (
        <ul className="pb-2">
          {week.days.map((d) => {
            const s = sessions.find((x) => x.date === d.date)
            const key = s?.dayId ?? d.dayKey
            const gym = isGymDay(key)
            const logged = !!s && Object.values(s.exercises).some((l) => l.sets.some((x) => x.done))
            const isToday = d.date === today
            const status = logged ? (
              <span className="text-done">✓ {fmtVolume(sessionVolume(program, s!))}</span>
            ) : isToday ? (
              <span className="rounded bg-plate px-1.5 py-0.5 text-[11px] font-bold text-bg">TODAY</span>
            ) : gym && d.date < today ? (
              <span className="text-muted">not logged</span>
            ) : null
            return (
              <li key={d.date}>
                <button
                  onClick={() => onOpenDay(d.date)}
                  className={`flex w-full items-center gap-3 py-2 pr-4 pl-15 text-left ${isToday ? 'text-chalk' : ''}`}
                >
                  <span className="num w-14 shrink-0 text-sm text-muted">{fmtDate(d.date).replace(/ \w+$/, '')}</span>
                  <span className={`min-w-0 flex-1 ${gym ? 'font-semibold' : 'text-muted'}`}>{dayTitle(program, key)}</span>
                  <span className="num shrink-0 text-xs">{status}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
