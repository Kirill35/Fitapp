import { useState } from 'react'
import type { WorkoutRepository } from '../data/WorkoutRepository'
import { demoSessions } from '../data/demo'
import type { Program } from '../domain/types'

interface Props {
  repo: WorkoutRepository
  program: Program
  previewDate: string | null
  onPreviewDate(d: string | null): void
  onDataChanged(): void
  onBack(): void
}

export default function SettingsView({ repo, program, previewDate, onPreviewDate, onDataChanged, onBack }: Props) {
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
      <header className="pt-safe flex items-center gap-2 border-b border-line px-2 pb-2">
        <button onClick={onBack} className="flex h-11 items-center gap-1 rounded-xl px-2 text-plate">
          <span className="text-2xl leading-none">‹</span> Today
        </button>
        <span className="font-semibold">Settings</span>
      </header>

      <main className="flex flex-col gap-8 px-4 py-5">
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
              ['2026-10-13', 'Tue · Day A'],
              ['2026-10-17', 'Sat · Day B'],
              ['2026-10-15', 'Thu · Cardio'],
              ['2026-11-07', 'Deload Sat'],
              ['2026-11-14', 'B2 Sat'],
            ].map(([d, l]) => (
              <button key={d} onClick={() => onPreviewDate(d)} className="rounded-lg border border-line px-3 py-2">
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={async () => {
              await repo.importData(JSON.stringify(demoSessions(program)))
              onDataChanged()
              flash('Example history added: Tue 6 Oct and Sat 10 Oct.')
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
