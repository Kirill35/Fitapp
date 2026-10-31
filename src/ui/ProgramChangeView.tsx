import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProgramControl, ProgramVersionInfo } from '../data/WorkoutRepository'
import { diffPrograms, historyWarnings } from '../domain/programDiff'
import { buildProgramPrompt, extractJson } from '../domain/programPrompt'
import type { Program, Session } from '../domain/types'
import { checkProgram } from '../../shared/schema'
import { BackBar } from './common'
import DiffView from './DiffView'

interface Props {
  program: Program
  version: number
  sessions: Session[]
  today: string
  programs: ProgramControl
  onBack(): void
}

const SOURCE = { seed: 'Built in', ai: 'AI', manual: 'Edited' } as const
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export default function ProgramChangeView({ program, version, sessions, today, programs, onBack }: Props) {
  const [request, setRequest] = useState('')
  const [pasted, setPasted] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [versions, setVersions] = useState<ProgramVersionInfo[] | null>(null)
  const [restore, setRestore] = useState<{ info: ProgramVersionInfo; program: Program } | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const connected = programs.available()

  const prompt = useMemo(() => buildProgramPrompt(program, sessions, request, today), [program, sessions, request, today])

  // What was pasted: JSON found? valid? what would change?
  const parsed = useMemo(() => (pasted.trim() ? extractJson(pasted) : null), [pasted])
  const check = useMemo(() => (parsed?.ok ? checkProgram(parsed.value) : null), [parsed])
  const proposal = check?.ok ? check.program : null
  const diff = useMemo(() => (proposal ? diffPrograms(program, proposal) : null), [program, proposal])
  const warnings = useMemo(() => (proposal ? historyWarnings(program, proposal, sessions) : []), [program, proposal, sessions])

  const loadVersions = () => {
    if (!connected) return
    programs.list().then(setVersions, () => setVersions(null))
  }
  useEffect(loadVersions, [programs, connected, version])

  const flash = (text: string, bad = false) => {
    setMsg({ text, bad })
    if (!bad) setTimeout(() => setMsg((m) => (m?.text === text ? null : m)), 4000)
  }

  const errorText = !parsed ? '' : !parsed.ok ? parsed.error : check && !check.ok ? check.errors.join('\n') : ''

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Something went wrong.', true)
    } finally {
      setBusy(false)
    }
  }

  const activate = () =>
    run(async () => {
      const v = await programs.save(proposal!, { source: 'ai', note: note.trim() || undefined })
      setPasted('')
      setNote('')
      flash(`Program updated. You are on version ${v}.`)
    })

  const openRestore = (info: ProgramVersionInfo) =>
    run(async () => {
      setRestore({ info, program: await programs.get(info.version) })
    })

  const confirmRestore = () =>
    run(async () => {
      await programs.activate(restore!.info.version)
      flash(`Switched to version ${restore!.info.version}.`)
      setRestore(null)
    })

  const restoreDiff = useMemo(() => (restore ? diffPrograms(program, restore.program) : null), [program, restore])
  const restoreWarnings = useMemo(() => (restore ? historyWarnings(program, restore.program, sessions) : []), [program, restore, sessions])

  const btn = 'h-12 rounded-xl px-4 font-semibold active:scale-[0.99] disabled:opacity-40'
  const h2 = 'text-xs font-semibold tracking-wider text-muted uppercase'

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <BackBar label="Program" title="Update" onBack={onBack} />
      <main className="flex flex-col gap-8 px-4 pt-4 pb-32 text-[15px]">
        {!connected && (
          <p role="note" className="rounded-2xl border border-line bg-panel px-4 py-3">
            Updating the program needs the server. Connect this phone in Settings → Sync first.
          </p>
        )}

        {/* 1. Ask an AI */}
        <section className="flex flex-col gap-3">
          <h2 className={h2}>1 · Ask an AI</h2>
          <label htmlFor="program-request" className="text-muted">
            What should change?
          </label>
          <textarea
            id="program-request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder="Example: plan the next 8 weeks as two 4-week blocks with a deload in between; add one more pulling exercise on day A"
            className="h-28 rounded-xl border border-line bg-panel p-3"
          />
          <button
            onClick={async () => flash((await copy(prompt)) ? 'Prompt copied. Paste it into Claude or another AI.' : 'Could not copy. Open “Show the prompt” and copy it by hand.', false)}
            className={`${btn} bg-plate text-bg`}
          >
            Copy prompt for the AI
          </button>
          <p className="text-sm text-muted">The prompt contains the exact format, your current program and your recent numbers.</p>
          <button onClick={() => setShowPrompt(!showPrompt)} className="self-start text-sm text-muted underline underline-offset-4">
            {showPrompt ? 'Hide the prompt' : 'Show the prompt'}
          </button>
          {showPrompt && (
            <textarea
              id="program-prompt"
              ref={promptRef}
              readOnly
              value={prompt}
              onFocus={(e) => e.target.select()}
              className="h-48 rounded-xl border border-line bg-panel p-3 font-mono text-xs"
            />
          )}
        </section>

        {/* 2. Paste the answer */}
        <section className="flex flex-col gap-3">
          <h2 className={h2}>2 · Paste the answer</h2>
          <textarea
            id="program-answer"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste the AI’s reply here"
            aria-label="The AI's answer"
            className="h-32 rounded-xl border border-line bg-panel p-3 font-mono text-xs"
          />
          {pasted.trim() && errorText && (
            <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-hard/50 bg-hard/10 px-4 py-3">
              <div className="text-sm font-semibold text-hard">Can’t use this yet</div>
              <pre className="font-sans text-sm leading-snug whitespace-pre-wrap">{errorText}</pre>
              <button
                onClick={async () => flash((await copy(`Your answer had these problems. Please fix them and reply with the complete corrected JSON only:\n${errorText}`)) ? 'Copied. Paste it back to the AI.' : 'Could not copy.')}
                className={`${btn} border border-line`}
              >
                Copy the problems for the AI
              </button>
            </div>
          )}
          {proposal && <p className="font-semibold text-done">✓ This is a valid program</p>}
        </section>

        {/* 3. Review and activate */}
        {proposal && diff && (
          <section className="flex flex-col gap-3">
            <h2 className={h2}>3 · What changes</h2>
            <DiffView diff={diff} warnings={warnings} />
            <label htmlFor="program-note" className="text-muted">
              Note (optional)
            </label>
            <input id="program-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: block 2 plan" className="h-12 rounded-xl border border-line bg-panel px-3" />
            <button disabled={busy || !connected || diff.same} onClick={activate} className={`${btn} bg-plate text-bg`}>
              {busy ? 'Saving…' : 'Make this my program'}
            </button>
            <p className="text-sm text-muted">The current version stays saved. You can switch back below.</p>
          </section>
        )}

        {/* Versions */}
        {connected && (
          <section className="flex flex-col gap-3">
            <h2 className={h2}>Versions</h2>
            {!versions ? (
              <p className="text-muted">Loading…</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
                {versions.map((v) => (
                  <li key={v.version} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="num font-semibold">Version {v.version}</span>
                        <span className="text-sm text-muted">{SOURCE[v.source]}</span>
                        {v.active && <span className="rounded bg-done/20 px-1.5 py-0.5 text-xs font-semibold text-done">ACTIVE</span>}
                      </div>
                      <div className="num text-sm text-muted">
                        {when(v.createdAt)}
                        {v.note ? ` · ${v.note}` : ''}
                      </div>
                    </div>
                    {!v.active && (
                      <button disabled={busy} onClick={() => openRestore(v)} className="h-10 rounded-lg border border-line px-3 text-sm font-semibold">
                        Review
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {restore && restoreDiff && (
              <div className="flex flex-col gap-3 rounded-2xl border border-line bg-panel px-4 py-4">
                <h3 className="font-semibold">Switch to version {restore.info.version}?</h3>
                <DiffView diff={restoreDiff} warnings={restoreWarnings} />
                <div className="flex gap-2">
                  <button disabled={busy || restoreDiff.same} onClick={confirmRestore} className={`${btn} flex-1 bg-plate text-bg`}>
                    Switch
                  </button>
                  <button onClick={() => setRestore(null)} className={`${btn} border border-line`}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {msg && (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-30 px-4">
          <div role="status" className={`mx-auto mb-3 flex max-w-lg items-start gap-3 rounded-xl px-4 py-3 font-semibold ${msg.bad ? 'bg-hard text-bg' : 'bg-chalk text-bg'}`}>
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{msg.text}</span>
            {msg.bad && (
              <button onClick={() => setMsg(null)} aria-label="Dismiss" className="shrink-0 text-lg leading-none">
                ×
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
