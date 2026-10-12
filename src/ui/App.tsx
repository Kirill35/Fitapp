import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkoutRepository } from '../data/WorkoutRepository'
import { sessionId } from '../data/WorkoutRepository'
import { dayContext, isGymDay, targetFor, toIso } from '../domain/program'
import type { DayId, ExerciseLog, LastPerformance, Program, Session } from '../domain/types'
import TodayView from './TodayView'
import LogView from './LogView'
import SettingsView from './SettingsView'

const PREVIEW_KEY = 'liftlog.previewDate'

function readPreview(): string | null {
  try {
    return localStorage.getItem(PREVIEW_KEY)
  } catch {
    return null
  }
}

type View = { name: 'today' } | { name: 'log'; item: number } | { name: 'settings' }

export default function App({ repo }: { repo: WorkoutRepository }) {
  const [program, setProgram] = useState<Program | null>(null)
  const [previewDate, setPreviewDateState] = useState<string | null>(readPreview)
  const date = previewDate ?? toIso(new Date())
  const [session, setSession] = useState<Session | null>(null)
  const [override, setOverride] = useState<DayId | null>(null)
  const [lasts, setLasts] = useState<Record<string, LastPerformance | null>>({})
  const [view, setView] = useState<View>({ name: 'today' })
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    repo.getProgram().then(setProgram)
  }, [repo])

  const ctx = useMemo(() => (program ? dayContext(program, date) : null), [program, date])

  // Load whatever was logged for this date; it decides the day if the user switched days.
  useEffect(() => {
    if (!program) return
    let live = true
    repo.getSessions(date).then((list) => {
      if (!live) return
      const s = list[0] ?? null
      setSession(s)
      setOverride(s && s.dayId !== program.schedule[dayContext(program, date).weekday] ? s.dayId : null)
    })
    return () => {
      live = false
    }
  }, [repo, program, date, reloadKey])

  const dayId: DayId | null = override ?? (ctx && isGymDay(ctx.dayKey) ? ctx.dayKey : null)

  useEffect(() => {
    if (!program || !dayId) return
    let live = true
    const ids = program.days[dayId].items.flatMap((it) => ('ex' in it ? [it.ex] : it.items))
    Promise.all(ids.map((id) => repo.getLastPerformance(id, date))).then((res) => {
      if (live) setLasts(Object.fromEntries(ids.map((id, i) => [id, res[i]])))
    })
    return () => {
      live = false
    }
  }, [repo, program, dayId, date, reloadKey])

  const persist = useCallback(
    (next: Session) => {
      setSession(next)
      void repo.saveSession(next)
    },
    [repo],
  )

  /** Create logs pre-filled from last time (weight) and today's target (reps). */
  const ensureLogs = useCallback(
    (ids: string[]) => {
      if (!program || !ctx || !dayId) return
      const base: Session =
        session && session.dayId === dayId
          ? session
          : {
              id: sessionId(date, dayId),
              date,
              dayId,
              blockId: ctx.block?.id ?? null,
              status: 'in-progress',
              exercises: {},
              updatedAt: '',
            }
      const missing = ids.filter((id) => !base.exercises[id])
      if (missing.length === 0 && base === session) return
      const exercises = { ...base.exercises }
      for (const id of missing) {
        const ex = program.exercises[id]
        const t = targetFor(ex, ctx, program)
        const last = lasts[id]
        const reps = Array.isArray(t.reps) ? t.reps[0] : t.reps
        exercises[id] = {
          sets: Array.from({ length: t.sets }, (_, i) => ({
            kg: ex.load === 'none' ? undefined : (last?.sets[i]?.kg ?? last?.sets.at(-1)?.kg ?? ex.start ?? 0),
            value: reps,
            done: false,
          })),
        }
      }
      persist({ ...base, exercises })
    },
    [program, ctx, dayId, session, date, lasts, persist],
  )

  const updateLog = useCallback(
    (id: string, log: ExerciseLog) => {
      if (!session) return
      persist({ ...session, exercises: { ...session.exercises, [id]: log } })
    },
    [session, persist],
  )

  const setPreviewDate = (d: string | null) => {
    try {
      if (d) localStorage.setItem(PREVIEW_KEY, d)
      else localStorage.removeItem(PREVIEW_KEY)
    } catch {
      /* preview date just won't survive a reload */
    }
    setPreviewDateState(d)
    setOverride(null)
    setSession(null)
  }

  if (!program || !ctx) return null

  if (view.name === 'settings') {
    return (
      <SettingsView
        repo={repo}
        program={program}
        previewDate={previewDate}
        onPreviewDate={setPreviewDate}
        onDataChanged={() => setReloadKey((k) => k + 1)}
        onBack={() => setView({ name: 'today' })}
      />
    )
  }

  if (view.name === 'log' && dayId) {
    return (
      <LogView
        program={program}
        ctx={ctx}
        item={program.days[dayId].items[view.item]}
        session={session}
        lasts={lasts}
        onOpen={ensureLogs}
        onChange={updateLog}
        onBack={() => setView({ name: 'today' })}
      />
    )
  }

  return (
    <TodayView
      program={program}
      ctx={ctx}
      dayId={dayId}
      isOverride={!!override}
      previewDate={previewDate}
      session={session && session.dayId === dayId ? session : null}
      lasts={lasts}
      onPickDay={(d) => setOverride(d)}
      onOpenItem={(i) => setView({ name: 'log', item: i })}
      onFinish={() => session && persist({ ...session, status: 'done' })}
      onSettings={() => setView({ name: 'settings' })}
    />
  )
}
