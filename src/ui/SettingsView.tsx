import { useState } from 'react'
import type { SyncControl, SyncInfo, WorkoutRepository } from '../data/WorkoutRepository'
import { DEV_TOOLS } from '../dev'
import { demoSessions } from '../data/demo'
import { BackBar } from './common'
import type { Program } from '../domain/types'

interface Props {
  repo: WorkoutRepository
  program: Program
  today: string
  previewDate: string | null
  onPreviewDate(d: string | null): void
  sync: { control: SyncControl; info: SyncInfo | null } | null
  onDataChanged(): void
  onProgram(): void
  onBack(): void
}

export default function SettingsView({ repo, program, today, previewDate, onPreviewDate, sync, onDataChanged, onProgram, onBack }: Props) {
  const [exported, setExported] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const flash = (m: string) => {
    setMsg(m)
    setTimeout(() => setMsg(null), 2500)
  }

  const doExport = async () => {
    const json = await repo.exportData()
    setExported(json)
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const a = Object.assign(document.createElement('a'), { href: url, download: `lift-log-${new Date().toISOString().slice(0, 10)}.json` })
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      /* the text below is the fallback */
    }
  }

  const doImport = async (json: string) => {
    try {
      await repo.importData(json)
      onDataChanged()
      setImportText('')
      flash('Backup imported.')
    } catch (e) {
      flash(e instanceof Error ? `Import failed: ${e.message}` : 'Import failed.')
    }
  }

  const btn = 'h-12 rounded-xl px-4 font-semibold active:scale-[0.99]'

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <BackBar label="Home" title="Settings" onBack={onBack} />

      <main className="flex flex-col gap-8 px-4 py-5">
        <button onClick={onProgram} className="flex items-center justify-between rounded-2xl border border-line bg-panel px-4 py-4 text-left">
          <span>
            <span className="block font-semibold">Program summary</span>
            <span className="text-sm text-muted">Schedule, blocks, what changes, cardio</span>
          </span>
          <span className="text-2xl text-muted">›</span>
        </button>

        {sync && <SyncSection control={sync.control} info={sync.info ?? sync.control.info()} />}

        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">Backup</h2>
          <button onClick={doExport} className={`${btn} bg-plate text-bg`}>
            Export JSON
          </button>
          {exported && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">If no file was saved, copy the text instead.</p>
              <textarea id="export-text" readOnly value={exported} className="num h-32 rounded-xl border border-line bg-panel p-3 font-mono text-xs" />
              <button
                onClick={() =>
                  navigator.clipboard.writeText(exported).then(
                    () => flash('Copied.'),
                    () => {
                      ;(document.getElementById('export-text') as HTMLTextAreaElement | null)?.select()
                      flash('Select the text and copy it.')
                    },
                  )
                }
                className={`${btn} bg-panel-2`}
              >
                Copy
              </button>
            </div>
          )}

          <label className={`${btn} grid cursor-pointer place-items-center bg-panel-2`}>
            Import JSON file
            <input
              id="import-file"
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) await doImport(await f.text())
                e.target.value = ''
              }}
            />
          </label>
          <textarea
            id="import-text"
            placeholder="…or paste backup JSON here"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            className="h-20 rounded-xl border border-line bg-panel p-3 font-mono text-xs"
          />
          {importText && (
            <button onClick={() => doImport(importText)} className={`${btn} bg-panel-2`}>
              Import pasted JSON
            </button>
          )}
        </section>

        {DEV_TOOLS && (
        <section className="flex flex-col gap-3 rounded-2xl border border-dashed border-line p-4">
          <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">Prototype testing only</h2>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Pretend today is</span>
            <div className="flex gap-2">
              <input
                id="preview-date"
                type="date"
                value={previewDate ?? ''}
                onChange={(e) => onPreviewDate(e.target.value || null)}
                className="h-12 flex-1 rounded-xl border border-line bg-panel px-3"
              />
              {previewDate && (
                <button onClick={() => onPreviewDate(null)} className={`${btn} bg-panel-2`}>
                  Real date
                </button>
              )}
            </div>
          </label>
          <div className="flex flex-wrap gap-2 text-sm">
            {[
              ['2026-10-13', 'Tue 13 Oct · Day A'],
              ['2026-10-15', 'Thu 15 Oct · Cardio'],
              ['2026-11-07', 'Sat 7 Nov · Deload'],
              ['2026-11-21', 'Sat 21 Nov · B2'],
              ['2026-12-15', 'Tue 15 Dec · B3'],
            ].map(([d, l]) => (
              <button key={d} onClick={() => onPreviewDate(d)} className="rounded-lg border border-line px-3 py-2">
                {l}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">Tip: pick a later date first, then add example history to fill the weeks before it.</p>
          <button
            onClick={async () => {
              await repo.importData(JSON.stringify(demoSessions(program, today)))
              onDataChanged()
              flash('Example history added up to yesterday.')
            }}
            className={`${btn} bg-panel-2`}
          >
            Add example history
          </button>
          {confirmClear ? (
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await repo.clearSessions()
                  onDataChanged()
                  setConfirmClear(false)
                  flash('All logs deleted.')
                }}
                className={`${btn} flex-1 bg-hard text-bg`}
              >
                Delete all logs
              </button>
              <button onClick={() => setConfirmClear(false)} className={`${btn} bg-panel-2`}>
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmClear(true)} className={`${btn} border border-hard/50 text-hard`}>
              Delete all logs…
            </button>
          )}
        </section>
        )}
      </main>

      {msg && (
        <div className="pb-safe fixed inset-x-0 bottom-0 px-4">
          <div role="status" className="mx-auto mb-3 max-w-lg rounded-xl bg-chalk px-4 py-3 text-center font-semibold text-bg">
            {msg}
          </div>
        </div>
      )}
    </div>
  )
}

function describe(i: SyncInfo): string {
  const n = i.pending ? ` ${i.pending} change${i.pending > 1 ? 's' : ''} waiting.` : ''
  switch (i.state) {
    case 'local':
      return 'Not connected. Your data is only on this phone.'
    case 'syncing':
      return 'Syncing…'
    case 'synced':
      return `Up to date${i.lastSync ? ` · ${new Date(i.lastSync).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`
    case 'pending':
      return `Waiting to upload.${n}`
    case 'offline':
      return `Offline.${n} Everything is saved on this phone and uploads when the connection is back.`
    case 'unauthorized':
      return `The server did not accept the token. Paste it again.${n}`
    case 'error':
      return i.error ?? 'Sync problem.'
  }
}

function SyncSection({ control, info }: { control: SyncControl; info: SyncInfo }) {
  const [token, setToken] = useState('')
  const connected = control.hasToken()
  const btn = 'h-12 rounded-xl px-4 font-semibold active:scale-[0.99]'
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">Sync</h2>
      <p role="status" className={`text-[15px] ${info.state === 'unauthorized' || info.state === 'error' ? 'text-hard' : ''}`}>
        {describe(info)}
      </p>
      {connected ? (
        <div className="flex gap-2">
          <button onClick={() => void control.syncNow()} className={`${btn} flex-1 bg-panel-2`}>
            Sync now
          </button>
          <button onClick={() => control.setToken(null)} className={`${btn} border border-line text-muted`}>
            Disconnect
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (token.trim()) {
              control.setToken(token)
              setToken('')
            }
          }}
        >
          <input
            id="sync-token"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Paste your access token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="h-12 rounded-xl border border-line bg-panel px-3"
          />
          <button type="submit" disabled={!token.trim()} className={`${btn} bg-plate text-bg disabled:bg-panel-2 disabled:text-muted`}>
            Connect
          </button>
        </form>
      )}
    </section>
  )
}
