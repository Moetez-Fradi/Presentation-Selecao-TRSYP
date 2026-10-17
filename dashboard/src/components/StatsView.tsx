import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { RunRecord, StationApi } from '../station/useStation'
import { g, secs, sg, stats, type Stats } from '../lib/format'

const WINDOW = 10

export function StatsView({ api }: { api: StationApi }) {
  const [src, setSrc] = useState<'live' | 'mock'>(api.station.kind === 'mock' ? 'mock' : 'live')
  const runs = useMemo(() => api.runs.filter((r) => r.source === src), [api.runs, src])
  const auto = useMemo(() => runs.filter((r) => r.method === 'auto').slice(-WINDOW), [runs])
  const manual = useMemo(() => runs.filter((r) => r.method === 'manual').slice(-WINDOW), [runs])
  const sa = stats(auto)
  const sm = stats(manual)
  const tol = auto.at(-1)?.tol_g ?? manual.at(-1)?.tol_g ?? 0.1

  return (
    <div className="page-grid">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>Repeatability</h1>
        <span className="muted">last {WINDOW} runs per method</span>
        <div style={{ flex: 1 }} />
        <div className="seg">
          <button aria-pressed={src === 'live'} onClick={() => setSrc('live')}>Station</button>
          <button aria-pressed={src === 'mock'} onClick={() => setSrc('mock')}>Simulator</button>
        </div>
      </div>

      <div className="tiles">
        <Tile k="Mean |error| · auto" v={sa ? `${g(sa.meanAbsDev)} g` : '—'} s={sa ? `bias ${sg(sa.meanDev)} g` : 'no runs yet'} />
        <Tile k="Spread (SD) · auto" v={sa ? `${g(sa.sd, 3)} g` : '—'} s={sa ? `range ${sg(sa.min)} … ${sg(sa.max)}` : ''} />
        <Tile k="Accepted · auto" v={sa ? `${Math.round(sa.acceptRate * 100)}%` : '—'} s={sa ? `${sa.rejected} rejected · ${sa.incomplete} failed` : ''} />
        <Tile k="Time per dose · auto" v={sa ? secs(sa.meanTimeMs) : '—'} s={sm ? `manual ${secs(sm.meanTimeMs)}` : 'no manual runs yet'} />
      </div>

      <div className="card">
        <div className="card-h">
          <h2>Automated vs manual (spatula on the same scale)</h2>
        </div>
        <Compare a={sa} m={sm} />
      </div>

      <div className="two">
        <div className="card">
          <div className="card-h">
            <h2>Deviation per run</h2>
            <div className="legend">
              <span><i className="sq" style={{ background: 'var(--series-auto)', borderRadius: '50%' }} />auto</span>
              <span><i className="sq" style={{ background: 'var(--series-manual)', borderRadius: '50%' }} />manual</span>
              <span><i className="sq" style={{ background: 'var(--ok-bg)', boxShadow: 'inset 0 0 0 1px var(--ok)' }} />± tolerance</span>
            </div>
          </div>
          <div className="card-b"><DevChart auto={auto} manual={manual} tol={tol} /></div>
        </div>
        <div className="card">
          <div className="card-h">
            <h2>Overshoot learning (auto)</h2>
            <span className="mono muted" style={{ fontSize: 12 }}>next: {g(api.learnedOvershoot)} g</span>
          </div>
          <div className="card-b"><OvershootChart runs={runs.filter((r) => r.method === 'auto' && r.status !== 'INCOMPLETE')} /></div>
        </div>
      </div>
    </div>
  )
}

function Tile({ k, v, s }: { k: string; v: string; s?: string }) {
  return (
    <div className="tile">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {s && <span className="s">{s}</span>}
    </div>
  )
}

function Compare({ a, m }: { a: Stats | null; m: Stats | null }) {
  const rows: { label: string; get: (s: Stats) => number; fmt: (x: number) => string; lowerBetter: boolean }[] = [
    { label: 'Runs', get: (s) => s.n, fmt: (x) => String(x), lowerBetter: false },
    { label: 'Mean |error|', get: (s) => s.meanAbsDev, fmt: (x) => `${g(x)} g`, lowerBetter: true },
    { label: 'Spread (SD)', get: (s) => s.sd, fmt: (x) => `${g(x, 3)} g`, lowerBetter: true },
    { label: 'Accepted', get: (s) => s.acceptRate * 100, fmt: (x) => `${Math.round(x)}%`, lowerBetter: false },
    { label: 'Time per dose', get: (s) => s.meanTimeMs, fmt: secs, lowerBetter: true },
  ]
  return (
    <div className="compare">
      <div className="h">Metric</div>
      <div className="h num">Auto</div>
      <div className="h num">Manual</div>
      <div className="h num">Gain</div>
      {rows.map((r) => {
        const av = a ? r.get(a) : null
        const mv = m ? r.get(m) : null
        let gain = '—'
        let good = false
        if (av != null && mv != null && r.label !== 'Runs') {
          if (r.label === 'Accepted') {
            const d = av - mv
            gain = `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))} pts`
            good = d >= 0
          } else if (mv > 0) {
            const f = (mv - av) / mv
            gain = `${f >= 0 ? '−' : '+'}${Math.abs(Math.round(f * 100))}%`
            good = r.lowerBetter ? f >= 0 : f <= 0
          }
        }
        return (
          <Fragment key={r.label}>
            <div>{r.label}</div>
            <div className="num">{av != null ? r.fmt(av) : '—'}</div>
            <div className="num">{mv != null ? r.fmt(mv) : '—'}</div>
            <div className={`num ${good ? 'gain' : ''}`} style={!good && gain !== '—' ? { color: 'var(--bad-text)' } : undefined}>{gain}</div>
          </Fragment>
        )
      })}
    </div>
  )
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(480)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const CM = { top: 12, right: 12, bottom: 26, left: 44 }

function DevChart({ auto, manual, tol }: { auto: RunRecord[]; manual: RunRecord[]; tol: number }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<{ r: RunRecord; x: number; y: number } | null>(null)
  const h = 220
  const iw = w - CM.left - CM.right
  const ih = h - CM.top - CM.bottom
  const all = [...auto, ...manual].filter((r) => r.status !== 'INCOMPLETE')
  const ext = Math.max(tol * 2, ...all.map((r) => Math.abs(r.dev_g))) * 1.15
  const n = Math.max(WINDOW, auto.length, manual.length)
  const x = (i: number) => CM.left + ((i + 0.5) / n) * iw
  const y = (d: number) => CM.top + ih / 2 - (d / ext) * (ih / 2)
  const ticks = [-ext, -ext / 2, 0, ext / 2, ext].map((v) => Number(v.toFixed(2)))

  const dots = (rs: RunRecord[], color: string, off: number) =>
    rs.map((r, i) =>
      r.status === 'INCOMPLETE' ? null : (
        <circle key={r.run_id} cx={x(i) + off} cy={y(r.dev_g)} r={5} fill={color} stroke="var(--surface)" strokeWidth="2"
          onPointerEnter={() => setHover({ r, x: x(i) + off, y: y(r.dev_g) })} onPointerLeave={() => setHover(null)} style={{ cursor: 'default' }} />
      ),
    )

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Deviation from target per run">
        <rect x={CM.left} width={iw} y={y(tol)} height={y(-tol) - y(tol)} fill="var(--ok-bg)" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={CM.left} x2={CM.left + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} />
            <text x={CM.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--text-3)" className="mono">
              {t > 0 ? '+' : ''}{t}
            </text>
          </g>
        ))}
        {Array.from({ length: n }, (_, i) => (
          <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize="11" fill="var(--text-3)" className="mono">{i + 1}</text>
        ))}
        {dots(manual, 'var(--series-manual)', 5)}
        {dots(auto, 'var(--series-auto)', -5)}
        {!all.length && (
          <text x={CM.left + iw / 2} y={CM.top + ih / 2 - 10} textAnchor="middle" fontSize="13" fill="var(--text-3)">No completed runs yet</text>
        )}
      </svg>
      {hover && (
        <div className="tip" style={{ left: hover.x, top: hover.y }}>
          <div className="mono" style={{ fontWeight: 500 }}>{sg(hover.r.dev_g)} g</div>
          <div className="muted">{hover.r.sample_id} · {hover.r.method} · {hover.r.status.toLowerCase()}</div>
        </div>
      )}
    </div>
  )
}

function OvershootChart({ runs }: { runs: RunRecord[] }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const rs = runs.slice(-20)
  const h = 220
  const iw = w - CM.left - CM.right
  const ih = h - CM.top - CM.bottom
  const yMax = Math.max(0.1, ...rs.map((r) => r.overshoot_g)) * 1.4
  const n = Math.max(rs.length, 2)
  const x = (i: number) => CM.left + (i / (n - 1)) * iw
  const y = (v: number) => CM.top + ih - (Math.max(0, v) / yMax) * ih
  // moving average used by the controller (window 5)
  const ma = rs.map((_, i) => {
    const win = rs.slice(Math.max(0, i - 4), i + 1)
    return win.reduce((s, r) => s + r.overshoot_g, 0) / win.length
  })
  const ticks = [0, yMax / 2, yMax].map((v) => Number(v.toFixed(2)))
  const hp = hover != null ? rs[hover] : null

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Measured overshoot per run and its moving average">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={CM.left} x2={CM.left + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} />
            <text x={CM.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--text-3)" className="mono">{t}</text>
          </g>
        ))}
        {rs.length > 1 && (
          <path d={ma.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')} fill="none" stroke="var(--series-auto)" strokeWidth="2" />
        )}
        {rs.map((r, i) => (
          <circle key={r.run_id} cx={x(i)} cy={y(r.overshoot_g)} r={hover === i ? 5 : 3.5} fill="var(--surface)" stroke="var(--text-2)" strokeWidth="1.5"
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
        ))}
        {rs.length > 1 && (
          <text x={x(rs.length - 1)} y={y(ma.at(-1)!) - 10} textAnchor="end" fontSize="11" fill="var(--text-2)">moving avg (5)</text>
        )}
        {!rs.length && (
          <text x={CM.left + iw / 2} y={CM.top + ih / 2} textAnchor="middle" fontSize="13" fill="var(--text-3)">Run a few auto doses to see the learning</text>
        )}
      </svg>
      {hp && hover != null && (
        <div className="tip" style={{ left: x(hover), top: y(hp.overshoot_g) }}>
          <div className="mono" style={{ fontWeight: 500 }}>{g(hp.overshoot_g, 3)} g measured</div>
          <div className="muted">{hp.sample_id} · avg {g(ma[hover], 3)} g</div>
        </div>
      )}
    </div>
  )
}
