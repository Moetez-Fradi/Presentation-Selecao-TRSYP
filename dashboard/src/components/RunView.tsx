import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { TwinState } from '../twin/TwinScene'
import type { StationApi } from '../station/useStation'
import { nextSampleId } from '../station/useStation'
import type { Method, Phase } from '../station/protocol'
import { ERROR_TEXT } from '../station/protocol'
import { MockStation } from '../station/MockStation'
import { DoseChart, PHASE_COLOR } from './DoseChart'
import { EventLog } from './EventLog'
import { Check, Play, Plus, Scale, Square, Trash, X } from './Icons'
import { g, secs, sg, stateTone } from '../lib/format'

export interface RecipeLine {
  material_id: string
  target_g: string
  tol_g: string
}
export interface Recipe {
  recipe_id: string
  lines: RecipeLine[]
  active: number
}

interface Props {
  api: StationApi
  recipe: Recipe
  setRecipe: (r: Recipe) => void
  sampleId: string
  setSampleId: (s: string) => void
}

// three.js only loads on desktop
const Station3D = lazy(() => import('../twin/Station3D'))

function useDesktop() {
  const q = '(min-width: 821px) and (pointer: fine)'
  const [on, setOn] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const fn = () => setOn(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [])
  return on
}

const BUSY = new Set(['DOSING', 'SETTLE', 'VERIFY', 'MANUAL', 'CHECKS'])

export function RunView({ api, recipe, setRecipe, sampleId, setSampleId }: Props) {
  const [method, setMethod] = useState<Method>('auto')
  const [series, setSeries] = useState(1)

  // every logged run advances the form to the next free sample ID
  const lastSample = api.result?.sample_id
  useEffect(() => {
    if (lastSample) setSampleId(nextSampleId(lastSample))
  }, [lastSample, setSampleId])
  const s = api.status
  const busy = !!s && BUSY.has(s.state)
  const line = recipe.lines[recipe.active]
  const target = Number(line?.target_g)
  const tol = Number(line?.tol_g)
  const recipeOk =
    !!recipe.recipe_id.trim() && !!line?.material_id.trim() && target > 0 && target <= 200 && tol > 0 && tol < target
  const src = api.station.kind === 'mock' ? 'mock' : 'live'
  const sampleUsed = api.runs.some((r) => r.source === src && r.sample_id === sampleId.trim())
  const sampleOk = !!sampleId.trim() && !sampleUsed

  const checks = [
    { label: 'Station online', ok: api.link === 'online', hint: api.link },
    { label: '12 V power', ok: !!s?.power_ok, hint: s?.power_ok ? 'on' : 'switch on' },
    { label: 'Cup on platform', ok: !!s?.cup, hint: s?.cup ? 'IR + weight' : 'place cup' },
    {
      label: 'Scale tared & stable',
      ok: !!s?.tare_ok,
      hint: s?.tare_ok ? `${g(s?.weight_g)} g` : 'press Tare',
      action: !s?.tare_ok && !busy ? api.tare : undefined,
    },
    { label: 'Hopper level', ok: !!s?.hopper_ok, hint: s?.hopper_pct != null ? `${s.hopper_pct}%` : '' },
    { label: 'Recipe valid', ok: recipeOk, hint: recipeOk ? `${g(target, 1)} ± ${g(tol)} g` : 'check fields' },
    { label: 'Sample ID unique', ok: sampleOk, hint: sampleUsed ? 'already logged' : sampleId },
  ]
  const ready = checks.every((c) => c.ok) && !busy

  const job = {
    recipe_id: recipe.recipe_id.trim(),
    material_id: line?.material_id.trim() ?? '',
    sample_id: sampleId.trim(),
    target_g: target,
    tol_g: tol,
    method,
  }

  const updateLine = (i: number, patch: Partial<RecipeLine>) =>
    setRecipe({ ...recipe, lines: recipe.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) })

  // the live view follows the running job, else the form
  const view = api.job ?? job
  const lastOk = api.result ? api.result.status === 'ACCEPTED' : undefined

  return (
    <div className="grid-run">
      {/* ------------------------------------------------ setup */}
      <section className="area-setup">
        <div className="card">
          <div className="card-h">
            <h2>Recipe</h2>
            <div className="seg" role="group" aria-label="Method">
              <button aria-pressed={method === 'auto'} onClick={() => setMethod('auto')} disabled={busy}>
                Auto
              </button>
              <button aria-pressed={method === 'manual'} onClick={() => setMethod('manual')} disabled={busy}>
                Manual
              </button>
            </div>
          </div>
          <div className="card-b stack">
            <div className="field">
              <label htmlFor="rid">Recipe ID</label>
              <input id="rid" className="input mono" value={recipe.recipe_id} disabled={busy}
                onChange={(e) => setRecipe({ ...recipe, recipe_id: e.target.value })} />
            </div>

            {recipe.lines.map((l, i) => (
              <div key={i} className="stack" style={{
                gap: 10, padding: recipe.lines.length > 1 ? 12 : 0, borderRadius: 8,
                border: recipe.lines.length > 1 ? `1px solid ${i === recipe.active ? 'var(--border-strong)' : 'var(--border)'}` : 0,
                background: recipe.lines.length > 1 && i === recipe.active ? 'var(--surface-2)' : undefined,
              }}>
                {recipe.lines.length > 1 && (
                  <div className="row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>
                      <input type="radio" name="line" checked={i === recipe.active} disabled={busy}
                        onChange={() => setRecipe({ ...recipe, active: i })} />
                      Line {i + 1}{i === recipe.active ? ' · dosing this line' : ''}
                    </label>
                    <button className="btn btn-ghost btn-sm icon-btn" aria-label="Remove line" disabled={busy}
                      onClick={() => setRecipe({ ...recipe, active: 0, lines: recipe.lines.filter((_, j) => j !== i) })}>
                      <Trash />
                    </button>
                  </div>
                )}
                <div className="field">
                  <label>Material ID</label>
                  <input className="input mono" value={l.material_id} disabled={busy}
                    onChange={(e) => updateLine(i, { material_id: e.target.value })} />
                </div>
                <div className="row2">
                  <div className="field">
                    <label>Target</label>
                    <div className="input-wrap">
                      <input className="input mono" inputMode="decimal" value={l.target_g} disabled={busy}
                        aria-invalid={!(Number(l.target_g) > 0)} onChange={(e) => updateLine(i, { target_g: e.target.value })} />
                      <span className="unit">g</span>
                    </div>
                  </div>
                  <div className="field">
                    <label>Tolerance ±</label>
                    <div className="input-wrap">
                      <input className="input mono" inputMode="decimal" value={l.tol_g} disabled={busy}
                        aria-invalid={!(Number(l.tol_g) > 0)} onChange={(e) => updateLine(i, { tol_g: e.target.value })} />
                      <span className="unit">g</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <button className="btn btn-sm" style={{ justifySelf: 'start' }} disabled={busy}
              onClick={() => setRecipe({ ...recipe, lines: [...recipe.lines, { material_id: `MAT-${String.fromCharCode(65 + recipe.lines.length)}`, target_g: '5.0', tol_g: '0.1' }] })}>
              <Plus /> Add material line
            </button>

            <div className="field">
              <label htmlFor="sid">Batch / sample ID</label>
              <input id="sid" className="input mono" value={sampleId} disabled={busy}
                aria-invalid={!sampleOk} onChange={(e) => setSampleId(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <h2>Pre-start checks</h2>
            <span className="mono muted" style={{ fontSize: 12 }}>
              {checks.filter((c) => c.ok).length}/{checks.length}
            </span>
          </div>
          <div className="card-b stack">
            <ul className="checks">
              {checks.map((c) => (
                <li key={c.label} className={`check ${c.ok ? 'ok' : 'no'}`}>
                  <span className="ico">{c.ok ? <Check /> : <X />}</span>
                  {c.label}
                  {c.action ? (
                    <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={c.action}>
                      <Scale /> Tare
                    </button>
                  ) : (
                    <span className="hint mono">{c.hint}</span>
                  )}
                </li>
              ))}
            </ul>

            {!busy ? (
              <div className="stack" style={{ gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span className="dim" style={{ fontSize: 13 }}>Runs in series</span>
                  <div className="seg" role="group" aria-label="Series length">
                    {[1, 5, 10].map((n) => (
                      <button key={n} aria-pressed={series === n} onClick={() => setSeries(n)}>
                        {n === 1 ? 'Single' : `×${n}`}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="btn btn-primary btn-lg" disabled={!ready} onClick={() => api.start(job, series)}>
                  <Play /> Start {method === 'manual' ? 'manual dose' : 'dose'}
                </button>
                <button className="btn" disabled={api.link !== 'online' || !!s?.vib}
                  title="Run the vibrator for 3 s to loosen sugar stuck in the hopper or auger"
                  onClick={() => api.vibrate(true, 3000)}>
                  {s?.vib ? 'Shaking…' : 'Shake hopper · 3 s'}
                </button>
              </div>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {s?.state === 'MANUAL' && (
                  <button className="btn btn-primary btn-lg" onClick={api.done}>
                    <Check width={16} height={16} /> Done, verify
                  </button>
                )}
                <button className="btn btn-danger btn-lg" onClick={api.stop}>
                  <Square /> Stop
                </button>
              </div>
            )}
            {api.seriesLeft > 0 && (
              <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
                Series running · {api.seriesLeft} run{api.seriesLeft > 1 ? 's' : ''} left
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ live */}
      <section className="area-live">
        {api.error && (
          <div className="banner tone-bad" role="alert">
            <span className="dot" />
            <div>
              <div className="t">{api.error.code}</div>
              <div style={{ fontSize: 13 }}>
                {ERROR_TEXT[api.error.code]}. Motor stopped
                {api.error.weight_g != null ? ` at ${g(api.error.weight_g)} g` : ''}.
              </div>
            </div>
          </div>
        )}
        <LiveCard api={api} target={view.target_g} tol={view.tol_g} manual={view.method === 'manual'} lastOk={lastOk} />
        <div className="card">
          <div className="card-h">
            <h2>Weight vs time</h2>
            <div className="legend">
              {(view.method === 'manual' ? (['MANUAL'] as Phase[]) : (['FAST', 'SLOW', 'FINE', 'TRIM'] as Phase[])).map((p) => (
                <span key={p}><i style={{ background: PHASE_COLOR[p] }} />{p.toLowerCase()}</span>
              ))}
              <span><i className="dash" style={{ borderColor: 'var(--ok)' }} />target</span>
            </div>
          </div>
          <div className="card-b" style={{ paddingTop: 12 }}>
            <DoseChart trace={api.trace} target={view.target_g || 10} tol={view.tol_g || 0.1} stopAt={api.stopAt} manual={view.method === 'manual'} />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ phone action bar */}
      <div className="action-bar">
        <span className="mono dim" style={{ fontSize: 12 }}>
          {busy ? (s?.state === 'MANUAL' ? 'Manual dose' : `Dosing · ${api.trace.at(-1)?.phase ?? ''}`) : `${checks.filter((c) => c.ok).length}/${checks.length} checks`}
        </span>
        {!busy ? (
          <button className="btn btn-primary" disabled={!ready} onClick={() => api.start(job, series)}>
            <Play /> Start
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            {s?.state === 'MANUAL' && <button className="btn btn-primary" onClick={api.done}>Done</button>}
            <button className="btn btn-danger" onClick={api.stop}><Square /> Stop</button>
          </div>
        )}
      </div>

      {/* ------------------------------------------------ side */}
      <section className="area-side">
        <ResultCard api={api} onNext={api.tare} />
        <TwinSlot api={api} />
        {api.station instanceof MockStation && <SimPanel sim={api.station} />}
        <div className="card">
          <div className="card-h"><h2>Events</h2></div>
          <EventLog log={api.log} compact />
        </div>
      </section>
    </div>
  )
}

// -----------------------------------------------------------------------------

function LiveCard({ api, target, tol, manual, lastOk }: { api: StationApi; target: number; tol: number; manual: boolean; lastOk?: boolean }) {
  const s = api.status
  const busy = !!s && BUSY.has(s.state)
  const last = api.trace.at(-1)
  const weight = busy && last ? last.w : (s?.weight_g ?? 0)
  const tone = stateTone(s?.state, lastOk)
  const scaleMax = (target || 10) * 1.15
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scaleMax) * 100))}%`
  const phase = last?.phase
  const order: Phase[] = manual ? ['MANUAL'] : ['FAST', 'SLOW', 'FINE', 'TRIM', 'SETTLE']
  const activeIdx = busy && phase ? order.indexOf(phase) : s?.state === 'DONE' ? order.length : -1
  const remaining = target - weight

  return (
    <div className="card">
      <div className="hero">
        <div className="hero-top">
          <span className={`pill tone-${tone}`}>
            <span className={`dot ${busy ? 'pulse' : ''}`} />
            {s?.state ?? 'NO DATA'}
            {busy && phase && phase !== 'MANUAL' ? ` · ${phase}` : ''}
          </span>
          {busy ? (
            <span className="mono muted" style={{ fontSize: 12 }}>
              {last ? `t = ${secs(last.t)}` : api.job?.sample_id}
            </span>
          ) : (
            <div className="sensors" aria-label="Station sensors">
              <Sensor ok={!!s?.cup} label="Cup" />
              <Sensor ok={!!s?.tare_ok} label="Tare" />
              <Sensor ok={!!s?.power_ok} label="12 V" />
              <Sensor ok={!!s?.hopper_ok} label={s?.hopper_pct != null ? `Hopper ${s.hopper_pct}%` : 'Hopper'} />
              {s?.vib && <span className="s-ok">Shaking…</span>}
            </div>
          )}
        </div>
        <div className="readout" aria-live="polite">
          <span className="val">{g(weight)}</span>
          <span className="unit">g</span>
        </div>
        <div className="readout-meta">
          <div className="kv"><span className="k">Target</span><span className="v">{g(target, 2)} g</span></div>
          <div className="kv"><span className="k">Tolerance</span><span className="v">± {g(tol)} g</span></div>
          <div className="kv"><span className="k">Remaining</span><span className="v">{busy ? `${g(Math.max(0, remaining))} g` : '—'}</span></div>
          {!manual && (
            <div className="kv"><span className="k">Learned overshoot</span><span className="v">{g(api.learnedOvershoot, 2)} g</span></div>
          )}
          <HopperLevel api={api} />
        </div>
        <div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={weight}>
            <div className="band" style={{ left: pct(target - tol), width: `calc(${pct(target + tol)} - ${pct(target - tol)})` }} />
            <div className="fill" style={{ width: pct(weight), background: busy ? 'var(--dosing)' : 'var(--text)' }} />
            <div className="tick" style={{ left: pct(target) }} />
          </div>
          <div className="progress-labels mono"><span>0 g</span><span>{g(target, 1)} g</span></div>
        </div>
        <div className="phase-track" style={{ gridTemplateColumns: `repeat(${order.length}, 1fr)` }}>
          {order.map((p, i) => (
            <div key={p} className={`phase-step ${i < activeIdx ? 'done' : ''} ${i === activeIdx ? 'active' : ''}`}
              style={{ ['--c' as string]: PHASE_COLOR[p] }}>
              <div className="bar" />
              {p}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ResultCard({ api, onNext }: { api: StationApi; onNext: () => void }) {
  const r = api.result
  const busy = !!api.status && BUSY.has(api.status.state)
  if (!r)
    return (
      <div className="card">
        <div className="card-h"><h2>Verification record</h2></div>
        <div className="empty">
          <Scale width={22} height={22} />
          The result of the next dose appears here
        </div>
      </div>
    )
  const tone = r.status === 'ACCEPTED' ? 'ok' : 'bad'
  return (
    <div className="card">
      <div className="card-h">
        <h2>Verification record</h2>
        <span className="mono muted" style={{ fontSize: 12 }}>{r.run_id}</span>
      </div>
      <div className="card-b result">
        <div className={`result-status tone-${tone}`}>
          {r.status === 'ACCEPTED' ? <Check width={20} height={20} /> : <X width={20} height={20} />}
          <div>
            <div className="big">{r.status === 'ACCEPTED' ? 'Accepted' : r.status === 'REJECTED' ? 'Rejected' : 'Incomplete'}</div>
            <div style={{ fontSize: 12, opacity: .85 }}>
              {r.error ? ERROR_TEXT[r.error] : `|deviation| ${Math.abs(r.dev_g) <= r.tol_g ? '≤' : '>'} tolerance ${g(r.tol_g)} g`}
            </div>
          </div>
        </div>
        <div className="result-grid">
          <div className="kv"><span className="k">Target</span><span className="v">{g(r.target_g)}</span></div>
          <div className="kv"><span className="k">Measured</span><span className="v">{g(r.measured_g)}</span></div>
          <div className="kv"><span className="k">Deviation</span><span className="v" style={{ color: `var(--${tone}-text)` }}>{sg(r.dev_g)}</span></div>
        </div>
        <div className="result-meta mono">
          <div><span className="muted">sample</span>{r.sample_id}</div>
          <div><span className="muted">method</span>{r.method}</div>
          <div><span className="muted">time</span>{secs(r.duration_ms)}</div>
          <div><span className="muted">trims</span>{r.trim_steps}</div>
          <div><span className="muted">overshoot</span>{g(r.overshoot_g)} g</div>
          <div><span className="muted">material</span>{r.material_id}</div>
        </div>
        {!busy && api.seriesLeft === 0 && (
          <button className="btn" onClick={onNext}>Swap cup & tare</button>
        )}
      </div>
    </div>
  )
}

/** Station view: live 3D twin from the CAD parts on desktop, light SVG schematic on phones. */
function TwinSlot({ api }: { api: StationApi }) {
  const s = api.status
  const hop = (s?.hopper_pct ?? 0) / 100
  const busy = !!s && BUSY.has(s.state)
  const cupFill = Math.min(1, Math.max(0, (api.trace.at(-1)?.w ?? s?.weight_g ?? 0) / ((api.job?.target_g ?? 10) * 1.2)))
  const desktop = useDesktop()
  const [big, setBig] = useState(false)
  const last = api.trace.at(-1)
  const twin = useMemo<TwinState>(() => ({
    online: api.link === 'online',
    state: s?.state,
    phase: busy ? last?.phase : undefined,
    vib: busy && !!last?.vib,
    cup: !!s?.cup,
    hopperOk: !!s?.hopper_ok,
    hopperPct: s?.hopper_pct,
    powerOk: !!s?.power_ok,
    tareOk: !!s?.tare_ok,
    scaleFault: !!s?.scale_fault,
    augerFitted: s?.auger !== false,
    weight: busy && last ? last.w : (s?.weight_g ?? 0),
    target: api.job?.target_g ?? api.result?.target_g ?? 10,
    result: api.result?.status,
    error: api.error?.code,
  }), [api.link, s, busy, last, api.job, api.result, api.error])

  useEffect(() => {
    if (!big) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setBig(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [big])

  return (
    <div className={`card ${big ? 'twin-expanded' : ''}`}>
      <div className="card-h">
        <h2>Station</h2>
        {desktop ? (
          <button className="btn btn-sm btn-ghost" onClick={() => setBig(!big)}>{big ? 'Close' : 'Expand'}</button>
        ) : (
          <span className="pill" style={{ height: 20, fontSize: 11 }}>3D on desktop</span>
        )}
      </div>
      <div className="card-b">
        {desktop ? (
          <Suspense fallback={<div className="twin3d"><div className="twin3d-msg">Loading 3D…</div></div>}>
            <Station3D state={twin} />
          </Suspense>
        ) : (
        <div className="twin">
          <svg viewBox="0 0 200 150" aria-label="Station schematic">
            {/* hopper */}
            <defs>
              <clipPath id="hopperClip"><path d="M50 10h100l-35 45h-30z" /></clipPath>
              <clipPath id="cupClip"><path d="M112 102h36l-4 34h-28z" /></clipPath>
            </defs>
            <rect x="40" y={10 + 45 * (1 - hop)} width="120" height="45" fill="var(--text-3)" opacity=".5" clipPath="url(#hopperClip)" />
            <path d="M50 10h100l-35 45h-30z" fill="none" stroke="var(--text-2)" strokeWidth="1.5" />
            {/* auger tube */}
            <rect x="70" y="55" width="90" height="14" rx="3" fill="none" stroke="var(--text-2)" strokeWidth="1.5" />
            <path d="M75 62 q5 -6 10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0" fill="none"
              stroke={busy ? 'var(--dosing)' : 'var(--text-3)'} strokeWidth="1.5">
              {busy && <animateTransform attributeName="transform" type="translate" from="0 0" to="-20 0" dur="0.5s" repeatCount="indefinite" />}
            </path>
            <rect x="40" y="57" width="30" height="10" rx="2" fill="var(--surface-2)" stroke="var(--text-3)" />
            {/* cup + scale */}
            <rect x="112" y={102 + 34 * (1 - cupFill)} width="40" height="34" fill="var(--ph-slow)" opacity=".7" clipPath="url(#cupClip)" />
            <path d="M112 102h36l-4 34h-28z" fill="none" stroke={s?.cup ? 'var(--text-2)' : 'var(--bad)'} strokeWidth="1.5" strokeDasharray={s?.cup ? undefined : '3 3'} />
            <rect x="104" y="138" width="52" height="5" rx="2" fill="var(--text-3)" />
            <text x="40" y="88" fontSize="9" fill="var(--text-3)">hopper {s?.hopper_pct ?? '—'}%</text>
            <text x="40" y="100" fontSize="9" fill="var(--text-3)">auger {s?.auger === false ? 'not fitted' : busy ? 'running' : 'idle'}</text>
          </svg>
        </div>
        )}
        {s?.raw !== undefined && (
          <div className="result-meta mono" style={{ marginTop: 12 }}>
            <div><span className="muted">raw</span>{s.raw}</div>
            <div><span className="muted">stable</span>{s.stable ? 'yes' : 'no'}</div>
            <div><span className="muted">load cell</span><span style={{ color: s.scale_fault ? 'var(--bad-text)' : undefined }}>{s.scale_fault ? 'fault' : 'ok'}</span></div>
            <div><span className="muted">auger</span>{s.auger ? 'fitted' : 'hand-pour'}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function SimPanel({ sim }: { sim: MockStation }) {
  const [, force] = useState(0)
  const toggle = (k: 'cup' | 'power') => {
    sim[k] = !sim[k]
    force((n) => n + 1)
  }
  return (
    <div className="card">
      <div className="card-h">
        <h2>Simulator</h2>
        <span className="pill tone-dosing" style={{ height: 20, fontSize: 11 }}>mock station</span>
      </div>
      <div className="card-b sim">
        <div className="row">Cup on platform<button className="switch" role="switch" aria-checked={sim.cup} onClick={() => toggle('cup')} /></div>
        <div className="row">12 V power<button className="switch" role="switch" aria-checked={sim.power} onClick={() => toggle('power')} /></div>
        <div className="row">
          Speed
          <div className="seg">
            {[1, 4, 10].map((n) => (
              <button key={n} aria-pressed={sim.speed === n} onClick={() => { sim.speed = n; force((x) => x + 1) }}>×{n}</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <button className="btn btn-sm" onClick={() => sim.bridge()}>Cause bridging</button>
          <button className="btn btn-sm" onClick={() => { sim.hopperG = 3 }}>Empty hopper</button>
          <button className="btn btn-sm" onClick={() => sim.refill()}>Refill</button>
        </div>
      </div>
    </div>
  )
}

function Sensor({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? 's-ok' : 's-bad'}>
      {ok ? <Check /> : <X />}
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
    </span>
  )
}

/** Sugar left in the hopper, from the ultrasonic sensor (calibrated on the Control page). */
function HopperLevel({ api }: { api: StationApi }) {
  const s = api.status
  const pct = s?.hopper_pct
  if (s?.hopper_mm === undefined && pct === undefined) return null  // no level sensor
  const low = pct != null && pct < 15
  return (
    <div className="kv" title={s?.hopper_mm != null ? `${s.hopper_mm} mm from the sensor to the sugar` : 'no echo'}>
      <span className="k">Hopper</span>
      {pct != null ? (
        <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 8, color: low ? 'var(--bad-text)' : undefined }}>
          {pct}%
          <span className="hopper-gauge"><i style={{ width: `${pct}%`, background: low ? 'var(--bad)' : undefined }} /></span>
        </span>
      ) : (
        <span className="v muted" style={{ fontSize: 13 }}>{s?.hopper_cal ? 'no echo' : 'not calibrated'}</span>
      )}
    </div>
  )
}
