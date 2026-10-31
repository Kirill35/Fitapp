import { dayTitle, fmtReps, fmtShort, fmtTarget, isGymDay, textDaysByBlock } from '../domain/program'
import type { Program } from '../domain/types'
import { BackBar } from './common'

const ORDER = ['tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'mon']
const DAY = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' } as Record<string, string>

/** One-screen summary of the whole program. */
export default function ProgramView({ program, version, onUpdate, onBack }: { program: Program; version: number; onUpdate?(): void; onBack(): void }) {
  const mainBlocks = program.blocks.filter((b) => !b.deloadOf)
  const main = Object.values(program.exercises).filter((ex) => ex.byBlock)
  const sched = program.schedule as Record<string, string>
  const h2 = 'mb-2 text-xs font-semibold tracking-wider text-muted uppercase'

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      <BackBar label="Settings" onBack={onBack} />
      <main className="flex flex-col gap-7 px-4 pt-3 pb-12 text-[15px]">
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-display text-3xl font-bold">Program</h1>
            <span className="num text-sm text-muted">{version === 0 ? 'Built into the app' : `Version ${version}`}</span>
          </div>
          {onUpdate && (
            <button onClick={onUpdate} className="flex items-center justify-between rounded-2xl border border-line bg-panel px-4 py-4 text-left active:scale-[0.99]">
              <span>
                <span className="block font-semibold">Update program</span>
                <span className="text-sm text-muted">Paste a new one from an AI, review changes, restore older versions</span>
              </span>
              <span className="text-2xl text-muted">›</span>
            </button>
          )}
        </div>

        <section>
          <h2 className={h2}>Every week (Tue–Mon)</h2>
          <ul className="grid grid-cols-[3rem_1fr] gap-y-1">
            {ORDER.map((d) => (
              <li key={d} className="contents">
                <span className="text-muted">{DAY[d]}</span>
                <span className={isGymDay(program, sched[d]) ? 'font-semibold' : ''}>{dayTitle(program, sched[d])}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className={h2}>Blocks</h2>
          <ul className="flex flex-col gap-1">
            {program.blocks.map((b) => (
              <li key={b.id} className="flex justify-between gap-3">
                <span className={b.deloadOf ? 'text-deload' : 'font-semibold'}>{b.deloadOf ? 'Deload' : b.label}</span>
                <span className="num text-muted">
                  {fmtShort(b.from)} – {fmtShort(b.to)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className={h2}>What changes per block</h2>
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="num w-full text-left text-sm">
              <thead className="bg-panel text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Main lift</th>
                  {mainBlocks.map((b) => (
                    <th key={b.id} className="px-2 py-2 text-right font-medium">
                      {b.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {main.map((ex) => (
                  <tr key={ex.name}>
                    <td className="px-3 py-2">{ex.name.replace(' (OHP)', '')}</td>
                    {mainBlocks.map((b) => {
                      const o = ex.byBlock?.[b.id] ?? {}
                      return (
                        <td key={b.id} className="px-2 py-2 text-right font-semibold text-plate">
                          {o.sets ?? ex.sets}×{fmtReps(o.reps ?? ex.reps)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 flex flex-col gap-1 text-muted">
            <li>Deadlift in B2–B3: 3 broad jumps after the last set.</li>
            <li>Everything else: same targets in every block.</li>
            <li>Deload weeks: 2 sets, same weight, previous block's reps.</li>
          </ul>
        </section>

        {textDaysByBlock(program).map((td) => (
          <section key={td.title}>
            <h2 className={h2}>{td.title} by block</h2>
            <ul className="flex flex-col gap-2">
              {td.rows.map((r) => (
                <li key={r.label} className="grid grid-cols-[3.5rem_1fr]">
                  <span className="font-semibold">{r.label}</span>
                  <span className="text-muted">{r.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {Object.keys(program.days).map((d) => (
          <section key={d}>
            <h2 className={h2}>
              {program.days[d].title} · {ORDER.filter((x) => sched[x] === d).map((x) => DAY[x]).join(', ')} · {mainBlocks[0]?.label} targets
            </h2>
            <ul className="flex flex-col gap-1">
              {program.days[d].items.map((it, i) => {
                const ids = 'ex' in it ? [it.ex] : it.items
                return (
                  <li key={i} className="flex gap-2">
                    <span className="w-9 shrink-0 text-xs leading-6 font-semibold text-muted">{'group' in it ? it.group.split(' ')[0].replace('Endurance', 'End.') : ''}</span>
                    <span className="min-w-0">
                      {ids
                        .map((id) => {
                          const ex = program.exercises[id]
                          const w = ex.start !== undefined ? ` @${ex.load === 'added' ? '+' : ''}${ex.start}` : ''
                          return `${ex.name} ${fmtTarget(ex, ex)}${w}`
                        })
                        .join(' · ')}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        <section>
          <h2 className={h2}>Warm-up </h2>
          <p className="text-muted">{program.warmup.map((w) => `${w.name} ${w.dose}`).join(' · ')}</p>
        </section>
      </main>
    </div>
  )
}
