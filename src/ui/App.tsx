import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProgramInfo, SyncInfo, WorkoutRepository } from '../data/WorkoutRepository'
import { sessionId } from '../data/WorkoutRepository'
import { lastPerformance } from '../domain/history'
import { dayContext, dayExerciseIds, isGymDay, targetFor, toIso } from '../domain/program'
import type { DayId, ExerciseLog, LastPerformance, Program, Session } from '../domain/types'
import { DEV_TOOLS } from '../dev'
import HomeView from './HomeView'
import DayView from './DayView'
import LogView from './LogView'
import SettingsView from './SettingsView'
import ProgramView from './ProgramView'
import ProgramChangeView from './ProgramChangeView'

const PREVIEW_KEY = 'liftlog.previewDate'

function readPreview(): string | null {
  if (!DEV_TOOLS) return null
  try {
    return localStorage.getItem(PREVIEW_KEY)
  } catch {
    return null
  }
}

type View =
  | { name: 'home' }
  | { name: 'day'; date: string }
  | { name: 'log'; date: string; item: number }
  | { name: 'settings' }
  | { name: 'program' }
  | { name: 'program-change' }

export default function App({ repo }: { repo: WorkoutRepository }) {
  const [programInfo, setProgramInfo] = useState<ProgramInfo | null>(null)
  const program: Program | null = programInfo?.program ?? null
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(repo.sync?.info() ?? null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [previewDate, setPreviewDateState] = useState<string | null>(readPreview)
  const today = previewDate ?? toIso(new Date())
  const [overrides, setOverrides] = useState<Record<string, DayId>>({})
  const [view, setViewState] = useState<View>({ name: 'home' })

  const setView = (v: View) => {
    setViewState(v)
    window.scrollTo(0, 0)
  }

  // The ref is the source of truth for edits, so two edits in one tick (e.g. rapid taps) never overwrite each other.
  const sessionsRef = useRef<Session[]>([])
  const commit = useCallback((next: Session[]) => {
    sessionsRef.current = next
    setSessions(next)
  }, [])
  const reload = useCallback(() => repo.listSessions().then(commit), [repo, commit])
  const loadProgram = useCallback(
    () => repo.getProgram().then((p) => setProgramInfo((prev) => (prev && prev.version === p.version ? prev : p))),
    [repo],
  )
  useEffect(() => {
    void loadProgram()
    void reload()
  }, [loadProgram, reload])

  // Background sync: show its state, and reload when it brought in new sessions or a new program.
  useEffect(() => {
    const sync = repo.sync
    if (!sync) return
    let rev = sync.info().revision
    return sync.subscribe(() => {
      const info = sync.info()
      setSyncInfo(info)
      if (info.revision !== rev) {
        rev = info.revision
        void reload()
        void loadProgram()
      }
    })
  }, [repo, reload, loadProgram])

  // A logged workout can belong to a day the current program no longer has; prefer one that still exists.
  const sessionFor = (date: string) => {
    const all = sessions.filter((s) => s.date === date)
    return all.find((s) => !program || s.dayId in program.days) ?? all[0] ?? null
  }
  const dayIdFor = (date: string): DayId | null => {
    if (!program) return null
    const logged = sessionFor(date)?.dayId
    if (logged && logged in program.days) return logged
    const picked = overrides[date]
    if (picked && picked in program.days) return picked
    const key = dayContext(program, date).dayKey
    return isGymDay(program, key) ? key : null
  }

  const date = view.name === 'day' || view.name === 'log' ? view.date : today
  const dayId = dayIdFor(date)
  const lasts = useMemo(() => {
    const out: Record<string, LastPerformance | null> = {}
    if (program && dayId) for (const id of dayExerciseIds(program, dayId)) out[id] = lastPerformance(sessions, id, date)
    return out
  }, [program, dayId, sessions, date])

  /** Make sure logs exist for `ids` (pre-filled from last time and today's target), then apply `mutate`. */
  const editSession = useCallback(
    (date: string, ids: string[], mutate?: (ex: Record<string, ExerciseLog>) => void) => {
      if (!program) return
      const dId = dayIdFor(date)
      if (!dId) return
      const ctx = dayContext(program, date)
      const all = sessionsRef.current
      const existing = all.find((s) => s.date === date && s.dayId === dId)
      const base: Session = existing ?? {
        id: sessionId(date, dId),
        date,
        dayId: dId,
        blockId: ctx.block?.id ?? null,
        programVersion: programInfo?.version,
        status: 'in-progress',
        exercises: {},
        updatedAt: '',
      }
      const exercises = { ...base.exercises }
      let changed = false
      for (const id of ids) {
        if (exercises[id]) continue
        const ex = program.exercises[id]
        const t = targetFor(ex, ctx, program)
        const last = lastPerformance(all, id, date)
        const reps = Array.isArray(t.reps) ? t.reps[0] : t.reps
        exercises[id] = {
          sets: Array.from({ length: t.sets }, (_, i) => ({
            kg: ex.load === 'none' ? undefined : (last?.sets[i]?.kg ?? last?.sets.at(-1)?.kg ?? ex.start ?? 0),
            value: reps,
            done: false,
          })),
        }
        changed = true
      }
      if (mutate) {
        mutate(exercises)
        changed = true
      }
      if (!changed) return
      const next = { ...base, exercises, updatedAt: new Date().toISOString() }
      commit([...all.filter((s) => s.id !== next.id), next])
      void repo.saveSession(next)
    },
    // dayIdFor reads `overrides`; it is recreated every render, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [program, programInfo, overrides, repo, commit],
  )

  const finish = (date: string) => {
    const s = sessionsRef.current.find((x) => x.date === date)
    if (!s) return
    const next: Session = { ...s, status: 'done', updatedAt: new Date().toISOString() }
    commit(sessionsRef.current.map((x) => (x.id === s.id ? next : x)))
    void repo.saveSession(next)
  }

  const setPreviewDate = (d: string | null) => {
    try {
      if (d) localStorage.setItem(PREVIEW_KEY, d)
      else localStorage.removeItem(PREVIEW_KEY)
    } catch {
      /* preview date just won't survive a reload */
    }
    setPreviewDateState(d)
    setOverrides({})
  }

  if (!program) return null

  switch (view.name) {
    case 'settings':
      return (
        <SettingsView
          repo={repo}
          program={program}
          today={today}
          previewDate={previewDate}
          onPreviewDate={setPreviewDate}
          sync={repo.sync ? { control: repo.sync, info: syncInfo } : null}
          onDataChanged={reload}
          onProgram={() => setView({ name: 'program' })}
          onBack={() => setView({ name: 'home' })}
        />
      )
    case 'program':
      return (
        <ProgramView
          program={program}
          version={programInfo?.version ?? 0}
          onUpdate={repo.programs ? () => setView({ name: 'program-change' }) : undefined}
          onBack={() => setView({ name: 'settings' })}
        />
      )
    case 'program-change':
      if (!repo.programs) break
      return (
        <ProgramChangeView
          program={program}
          version={programInfo?.version ?? 0}
          sessions={sessions}
          today={today}
          programs={repo.programs}
          onBack={() => setView({ name: 'program' })}
        />
      )
    case 'log': {
      const item = dayId ? program.days[dayId]?.items[view.item] : undefined
      // The program can change while this screen is open (another phone, or a rollback): fall back to the day.
      if (!dayId || !item) return <DayFallback onBack={() => setView({ name: 'day', date: view.date })} />
      return (
        <LogView
          program={program}
          ctx={dayContext(program, view.date)}
          item={item}
          session={sessionFor(view.date)}
          lasts={lasts}
          onOpen={(ids) => editSession(view.date, ids)}
          onEdit={(ids, mutate) => editSession(view.date, ids, mutate)}
          onBack={() => setView({ name: 'day', date: view.date })}
        />
      )
    }
    case 'day':
      return (
        <DayView
          program={program}
          ctx={dayContext(program, view.date)}
          isToday={view.date === today}
          dayId={dayId}
          isOverride={!!overrides[view.date] && !sessionFor(view.date)}
          session={sessionFor(view.date)?.dayId === dayId ? sessionFor(view.date) : null}
          lasts={lasts}
          onBack={() => setView({ name: 'home' })}
          onPickDay={(d) =>
            setOverrides((o) => {
              const n = { ...o }
              if (d) n[view.date] = d
              else delete n[view.date]
              return n
            })
          }
          onOpenItem={(i) => setView({ name: 'log', date: view.date, item: i })}
          onEdit={(ids, mutate) => editSession(view.date, ids, mutate)}
          onFinish={() => finish(view.date)}
        />
      )
  }

  return (
    <HomeView
      program={program}
      today={today}
      previewDate={previewDate}
      sessions={sessions}
      sync={syncInfo}
      onOpenDay={(d) => setView({ name: 'day', date: d })}
      onSettings={() => setView({ name: 'settings' })}
    />
  )
}

function DayFallback({ onBack }: { onBack(): void }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-lg">The program changed while this exercise was open.</p>
      <button onClick={onBack} className="h-12 rounded-xl bg-plate px-6 font-semibold text-bg">
        Back to the day
      </button>
    </div>
  )
}
