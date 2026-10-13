import { useEffect, useRef, useState } from 'react'
import { fmtVolume, type VolumePoint } from '../domain/history'

function niceMax(v: number): number {
  if (v <= 0) return 1000
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p
  return 10 * p
}

/** Single-series line chart: area fill, recessive grid, deload weeks shaded, tap for values. */
export default function LineChart({ points, height = 168 }: { points: VolumePoint[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(320)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => setActive(null), [points])

  const pad = { l: 36, r: 14, t: 14, b: 22 }
  const iw = Math.max(10, w - pad.l - pad.r)
  const ih = height - pad.t - pad.b
  const max = niceMax(Math.max(...points.map((p) => p.value)) * 1.05)
  const n = points.length
  const x = (i: number) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw)
  const y = (v: number) => pad.t + ih - (v / max) * ih
  const step = n > 1 ? iw / (n - 1) : iw
  const ticks = [0, max / 2, max]
  const pt = (i: number) => `${x(i).toFixed(1)},${y(points[i].value).toFixed(1)}`
  const line = points.map((_, i) => `${i ? 'L' : 'M'}${pt(i)}`).join('')
  // The unfinished current period gets a dashed last segment.
  const partial = n > 1 && points[n - 1].partial
  const solid = partial ? points.slice(0, -1).map((_, i) => `${i ? 'L' : 'M'}${pt(i)}`).join('') : line
  const area = `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
  // Label every k-th period so x labels never collide.
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 44))))
  const shown = active ?? n - 1
  const tip = points[shown]

  const pick = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    const i = Math.round((clientX - r.left - pad.l) / (n > 1 ? step : 1))
    setActive(Math.min(n - 1, Math.max(0, i)))
  }

  return (
    <div ref={ref} className="relative w-full select-none">
      <div className="num mb-1 flex h-5 items-baseline gap-2 text-sm">
        <span className="font-semibold">{fmtVolume(tip.value)}</span>
        <span className="truncate text-muted">
          {tip.title}
          {tip.partial ? ' · so far' : ''}
        </span>
      </div>
      <svg
        width={w}
        height={height}
        className="block touch-pan-y"
        onPointerDown={(e) => pick(e.clientX)}
        onPointerMove={(e) => (e.buttons || e.pointerType === 'mouse') && pick(e.clientX)}
        role="img"
        aria-label="Training volume over time"
      >
        {points.map((p, i) =>
          p.deload ? (
            <rect key={`d${p.key}`} x={x(i) - step / 2} y={pad.t} width={step} height={ih} fill="var(--color-deload)" opacity={0.12} />
          ) : null,
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted)" className="num">
              {t === 0 ? '0' : t >= 1000 ? `${+(t / 1000).toFixed(1)}t` : Math.round(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={`x${p.key}`} x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={i === shown ? 'var(--color-chalk)' : 'var(--color-muted)'}>
              {p.label}
            </text>
          ) : null,
        )}
        {n > 1 && <path d={area} fill="var(--color-plate)" opacity={0.12} />}
        {n > 1 && <path d={solid} fill="none" stroke="var(--color-plate)" strokeWidth={2} strokeLinejoin="round" />}
        {partial && <path d={`M${pt(n - 2)}L${pt(n - 1)}`} fill="none" stroke="var(--color-plate)" strokeWidth={2} strokeDasharray="4 4" />}
        <line x1={x(shown)} x2={x(shown)} y1={pad.t} y2={pad.t + ih} stroke="var(--color-muted)" strokeWidth={1} strokeDasharray="2 3" />
        {points.map((p, i) => (
          <circle
            key={p.key}
            cx={x(i)}
            cy={y(p.value)}
            r={i === shown ? 5 : 3}
            fill={i === shown ? 'var(--color-plate)' : 'var(--color-panel)'}
            stroke="var(--color-plate)"
            strokeWidth={2}
          />
        ))}
      </svg>
    </div>
  )
}
