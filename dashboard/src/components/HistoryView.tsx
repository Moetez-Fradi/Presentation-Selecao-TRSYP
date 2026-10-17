import { useMemo, useState } from 'react'
import type { StationApi } from '../station/useStation'
import { ago, download, g, secs, sg, toCsv } from '../lib/format'
import { Download, Trash } from './Icons'

type Filter = 'all' | 'auto' | 'manual' | 'failed'

export function HistoryView({ api }: { api: StationApi }) {
  const [filter, setFilter] = useState<Filter>('all')
  const rows = useMemo(() => {
    const r = [...api.runs].reverse()
    if (filter === 'failed') return r.filter((x) => x.status !== 'ACCEPTED')
    if (filter === 'all') return r
    return r.filter((x) => x.method === filter)
  }, [api.runs, filter])

  return (
    <div className="page-grid">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>Run history</h1>
        <span className="pill mono">{api.runs.length} runs</span>
        <div style={{ flex: 1 }} />
        <div className="seg">
          {(['all', 'auto', 'manual', 'failed'] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <button className="btn btn-sm" disabled={!api.runs.length}
          onClick={() => download(`dosing-log-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(api.runs))}>
          <Download /> CSV
        </button>
        <button className="btn btn-sm btn-ghost" disabled={!api.runs.length}
          onClick={() => { if (confirm('Clear the local history cache? The station keeps its own log.')) api.clearRuns() }}>
          <Trash /> Clear
        </button>
      </div>

      <div className="card">
        {!rows.length ? (
          <div className="empty">No runs yet. Every dose, including rejected and failed ones, is logged here.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Sample</th>
                  <th>Method</th>
                  <th className="num">Target</th>
                  <th className="num">Measured</th>
                  <th className="num">Deviation</th>
                  <th className="num">Overshoot</th>
                  <th className="num">Trims</th>
                  <th className="num">Time</th>
                  <th>Recipe · material</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tone = r.status === 'ACCEPTED' ? 'ok' : 'bad'
                  return (
                    <tr key={r.run_id}>
                      <td>
                        <span className={`pill tone-${tone}`} style={{ height: 22 }}>
                          <span className="dot" />
                          {r.status === 'INCOMPLETE' ? (r.error ?? 'INCOMPLETE') : r.status}
                        </span>
                      </td>
                      <td className="mono">
                        {r.sample_id}
                        {r.source === 'mock' && <span className="muted" style={{ fontSize: 10, marginLeft: 6 }}>SIM</span>}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <i style={{ width: 8, height: 8, borderRadius: 2, display: 'inline-block', background: `var(--series-${r.method})` }} />
                          {r.method}
                        </span>
                      </td>
                      <td className="num">{g(r.target_g)}</td>
                      <td className="num">{g(r.measured_g)}</td>
                      <td className="num" style={{ color: `var(--${tone}-text)` }}>{sg(r.dev_g)}</td>
                      <td className="num">{r.method === 'auto' ? g(r.overshoot_g) : '—'}</td>
                      <td className="num">{r.method === 'auto' ? r.trim_steps : '—'}</td>
                      <td className="num">{secs(r.duration_ms)}</td>
                      <td className="mono dim">{r.recipe_id} · {r.material_id}</td>
                      <td className="muted" title={r.t_end}>{ago(r.t_end)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
