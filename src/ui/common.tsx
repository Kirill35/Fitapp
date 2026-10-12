import { useEffect, useState } from 'react'
import { fmtDate, type DayContext } from '../domain/program'
import type { Difficulty } from '../domain/types'

export function Header({
  ctx,
  title,
  previewDate,
  onSettings,
}: {
  ctx: DayContext
  title: string
  previewDate: string | null
  onSettings(): void
}) {
  const where =
    ctx.status === 'before'
      ? `Program starts ${fmtDate(ctx.programStart)}`
      : ctx.status === 'after'
        ? 'Program complete'
        : `${ctx.block!.deloadOf ? 'Deload' : ctx.block!.label} · Week ${ctx.weekInBlock}`
  return (
    <header className="pt-safe px-4 pb-4">
      <div className="flex items-center justify-between text-sm text-muted">
        <span className="num">
          {fmtDate(ctx.date)}
          {previewDate && <span className="ml-2 rounded bg-plate/15 px-1.5 py-0.5 text-xs text-plate">preview date</span>}
        </span>
        <button onClick={onSettings} aria-label="Settings" className="-mr-2 grid size-10 place-items-center rounded-full text-lg">
          ⚙︎
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="font-display text-4xl font-bold tracking-tight">{title}</h1>
        {ctx.deload && (
          <span className="rounded-md bg-deload px-2 py-0.5 text-xs font-bold tracking-widest text-bg">DELOAD</span>
        )}
      </div>
      <div className="mt-1 text-[15px] text-muted">{where}</div>
    </header>
  )
}

export function VideoLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label="Technique video"
      className="-mt-1 -mr-2 grid size-10 shrink-0 place-items-center rounded-full text-plate active:bg-panel-2"
    >
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 8.2v7.6l6-3.8z" fill="currentColor" />
      </svg>
    </a>
  )
}

const tagColor: Record<Difficulty, string> = {
  Easy: 'text-done',
  Right: 'text-plate',
  Hard: 'text-hard',
}

export function DifficultyTag({ d }: { d?: Difficulty }) {
  if (!d) return null
  return <span className={tagColor[d]}>· {d}</span>
}

export function Stepper({
  id,
  value,
  step,
  unit,
  onChange,
  disabled,
  wide,
}: {
  id: string
  value: number
  step: number
  unit: string
  onChange(v: number): void
  disabled?: boolean
  wide?: boolean
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'))
    if (Number.isFinite(n) && n >= 0) onChange(n)
    else setText(String(value))
  }
  const btn =
    'grid h-12 w-10 shrink-0 place-items-center rounded-xl bg-panel-2 text-2xl font-medium active:bg-line disabled:opacity-40'
  return (
    <div className={`flex min-w-0 ${wide ? 'flex-[1.4]' : 'flex-1'} items-center gap-0.5 ${disabled ? 'opacity-60' : ''}`}>
      <button type="button" disabled={disabled} className={btn} onClick={() => onChange(Math.max(0, round(value - step)))} aria-label={`Minus ${step}`}>
        −
      </button>
      <label className="flex min-w-0 flex-1 flex-col items-center leading-none">
        <input
          id={id}
          inputMode="decimal"
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="num w-full min-w-0 bg-transparent text-center font-display text-[22px] font-semibold outline-none"
        />
        <span className="mt-0.5 text-[11px] tracking-wide text-muted uppercase">{unit}</span>
      </label>
      <button type="button" disabled={disabled} className={btn} onClick={() => onChange(round(value + step))} aria-label={`Plus ${step}`}>
        +
      </button>
    </div>
  )
}

const round = (n: number) => Math.round(n * 100) / 100
