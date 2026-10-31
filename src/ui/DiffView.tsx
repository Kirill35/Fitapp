import type { ProgramDiff } from '../domain/programDiff'

const MARK = {
  add: { sym: '+', cls: 'text-done' },
  remove: { sym: '−', cls: 'text-hard' },
  change: { sym: '~', cls: 'text-plate' },
} as const

/** Plain-words list of what a program change would do, grouped by topic. */
export default function DiffView({ diff, warnings }: { diff: ProgramDiff; warnings: string[] }) {
  const { add, remove, change } = diff.counts
  return (
    <div className="flex flex-col gap-4">
      <p className="num text-sm text-muted">
        {diff.same ? 'No differences from the active program.' : `${add} added · ${change} changed · ${remove} removed`}
      </p>

      {warnings.length > 0 && (
        <div role="note" className="flex flex-col gap-2 rounded-2xl border border-plate/50 bg-plate/10 px-4 py-3 text-[15px]">
          <div className="text-sm font-semibold text-plate">Worth knowing</div>
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      {diff.sections.map((s) => (
        <section key={s.title} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">{s.title}</h3>
          <ul className="flex flex-col gap-1.5">
            {s.lines.map((l, i) => (
              <li key={i} className="flex gap-2 text-[15px] leading-snug">
                <span className={`w-4 shrink-0 text-center font-bold ${MARK[l.kind].cls}`} aria-label={l.kind}>
                  {MARK[l.kind].sym}
                </span>
                <span className="min-w-0 break-words">{l.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
