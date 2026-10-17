import { useEffect, useMemo, useRef, useState } from 'react'
import type { TracePoint } from '../station/useStation'
import type { Phase } from '../station/protocol'
import { g } from '../lib/format'

export const PHASE_COLOR: Record<Phase, string> = {
  FAST: 'var(--ph-fast)',
  SLOW: 'var(--ph-slow)',
  FINE: 'var(--ph-fine)',
  TRIM: 'var(--ph-trim)',
  SETTLE: 'var(--text-3)',
  MANUAL: 'var(--ph-manual)',
}

interface Props {
  trace: TracePoint[]
  target: number
  tol: number
  stopAt: number | null
  manual: boolean
}

const M = { top: 14, right: 52, bottom: 28, left: 40 }

function niceStep(range: number, ticks: number) {
  const raw = range / ticks
  const p = 10 ** Math.floor(Math.log10(raw))
  const n = raw / p
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p
}

/** Weight vs time with the closed-loop thresholds drawn in: the core "proof" chart. */
export function DoseChart({ trace, target, tol, stopAt, manual }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const h = w < 500 ? 220 : 280
  const iw = w - M.left - M.right
  const ih = h - M.top - M.bottom
  const tMax = Math.max(manual ? 30_000 : 10_000, (trace.at(-1)?.t ?? 0) * 1.08)
  const yMax = Math.max(target * 1.12, ...trace.map((p) => p.w * 1.05), 1)
  const x = (t: number) => M.left + (t / tMax) * iw
  const y = (v: number) => M.top + ih - (Math.max(0, v) / yMax) * ih

  const segments = useMemo(() => {
    const segs: { phase: Phase; pts: TracePoint[] }[] = []
    for (const p of trace) {
      const last = segs.at(-1)
      if (last && last.phase === p.phase) last.pts.push(p)
      else {
        // repeat the previous point so segments join without a gap
        const prev = last?.pts.at(-1)
        segs.push({ phase: p.phase, pts: prev ? [prev, p] : [p] })
      }
    }
    return segs
  }, [trace])

  const yStep = niceStep(yMax, 4)
  const yTicks = Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep)
  const tStep = niceStep(tMax / 1000, w < 500 ? 4 : 6)
  const tTicks = Array.from({ length: Math.floor(tMax / 1000 / tStep) + 1 }, (_, i) => i * tStep)

  const path = (pts: TracePoint[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.w).toFixed(1)}`).join('')

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!trace.length) return
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect()
    const t = ((e.clientX - r.left) / r.width) * tMax
    let best = 0
    for (let i = 1; i < trace.length; i++) if (Math.abs(trace[i].t - t) < Math.abs(trace[best].t - t)) best = i
    setHover(best)
  }

  const hp = hover != null ? trace[hover] : null
  const refLines = manual
    ? []
    : [
        { v: target * 0.75, label: 'slow 75%' },
        { v: target * 0.95, label: 'fine 95%' },
      ]
  const vibSpans = trace.filter((p) => p.vib)

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Weight versus time during the dose">
        {/* grid */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={M.left + iw} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text x={M.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--text-3)" className="mono">
              {v}
            </text>
          </g>
        ))}
        {tTicks.map((s) => (
          <text key={s} x={x(s * 1000)} y={h - 8} textAnchor="middle" fontSize="11" fill="var(--text-3)" className="mono">
            {s}s
          </text>
        ))}
        <line x1={M.left} x2={M.left + iw} y1={y(0)} y2={y(0)} stroke="var(--axis)" />

        {/* tolerance band + target */}
        <rect x={M.left} width={iw} y={y(target + tol)} height={Math.max(1, y(target - tol) - y(target + tol))} fill="var(--ok-bg)" />
        <line x1={M.left} x2={M.left + iw} y1={y(target)} y2={y(target)} stroke="var(--ok)" strokeWidth="1.5" strokeDasharray="6 4" />
        <text x={M.left + iw + 8} y={y(target)} dy="0.32em" fontSize="11" fill="var(--ok-text)" className="mono">
          {g(target, 1)} g
        </text>

        {/* control thresholds */}
        {refLines.map((r) => (
          <g key={r.label}>
            <line x1={M.left} x2={M.left + iw} y1={y(r.v)} y2={y(r.v)} stroke="var(--border-strong)" strokeDasharray="2 4" />
            <text x={M.left + 6} y={y(r.v) + 13} fontSize="10" fill="var(--text-3)">
              {r.label}
            </text>
          </g>
        ))}
        {stopAt != null && !manual && (
          <g>
            <line x1={M.left} x2={M.left + iw} y1={y(stopAt)} y2={y(stopAt)} stroke="var(--dosing)" strokeDasharray="2 3" />
            <text x={M.left + 6} y={y(stopAt) - 5} fontSize="10" fill="var(--warn-text)">
              stop {g(stopAt)}
            </text>
          </g>
        )}

        {/* vibration markers on the time axis */}
        {vibSpans.map((p) => (
          <rect key={p.t} x={x(p.t) - 1.5} y={y(0) - 5} width="3" height="5" rx="1" fill="var(--dosing)" />
        ))}

        {/* the trace, coloured by phase */}
        {segments.map((s, i) => (
          <path key={i} d={path(s.pts)} fill="none" stroke={PHASE_COLOR[s.phase]} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {trace.length > 0 && (
          <circle cx={x(trace.at(-1)!.t)} cy={y(trace.at(-1)!.w)} r="4.5" fill={PHASE_COLOR[trace.at(-1)!.phase]} stroke="var(--surface)" strokeWidth="2" />
        )}

        {!trace.length && (
          <text x={M.left + iw / 2} y={M.top + ih / 2} textAnchor="middle" fontSize="13" fill="var(--text-3)">
            Waiting for a dose to start
          </text>
        )}

        {/* hover */}
        {hp && (
          <g pointerEvents="none">
            <line x1={x(hp.t)} x2={x(hp.t)} y1={M.top} y2={M.top + ih} stroke="var(--text-3)" />
            <circle cx={x(hp.t)} cy={y(hp.w)} r="5" fill={PHASE_COLOR[hp.phase]} stroke="var(--surface)" strokeWidth="2" />
          </g>
        )}
        <rect
          x={M.left}
          y={M.top}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onPointerDown={onMove}
        />
      </svg>
      {hp && (
        <div className="tip" style={{ left: x(hp.t), top: y(hp.w) }}>
          <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>{g(hp.w)} g</div>
          <div className="muted">
            {hp.phase} · {(hp.t / 1000).toFixed(1)} s{hp.vib ? ' · vibration' : ''}
          </div>
        </div>
      )}
    </div>
  )
}
