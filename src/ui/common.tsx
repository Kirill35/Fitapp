import { useEffect, useState } from 'react'
import type { Difficulty } from '../domain/types'

export function BackBar({ label, title, onBack }: { label: string; title?: string; onBack(): void }) {
  return (
    <header className="pt-safe sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/95 px-2 pb-2 backdrop-blur">
      <button onClick={onBack} className="flex h-11 items-center gap-1 rounded-xl px-2 text-plate">
        <span className="text-2xl leading-none">‹</span> {label}
      </button>
      {title && <span className="truncate text-sm font-semibold tracking-wider text-muted uppercase">{title}</span>}
    </header>
  )
}

export function VideoLink({ href, small }: { href: string; small?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label="Technique video"
      className={`grid size-10 shrink-0 place-items-center rounded-full text-plate active:bg-panel-2 ${small ? '' : '-mt-1 -mr-2'}`}
    >
      <svg viewBox="0 0 24 24" className={small ? 'size-5' : 'size-6'} aria-hidden="true">
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
