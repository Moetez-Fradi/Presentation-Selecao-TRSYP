import { useEffect, useState, type ReactNode } from 'react'
import type { StationApi } from '../station/useStation'
import { g } from '../lib/format'
import { Check, Scale, X } from './Icons'

/** Load cell state + guided calibration (tare empty, known mass, save on the ESP32). */
export function ScaleCard({ api }: { api: StationApi }) {
  const s = api.status
  const [open, setOpen] = useState(false)
  if (s?.cal_factor === undefined) return null  // station firmware without calibration support

  return (
    <div className="card">
      <div className="card-h">
        <h2>Scale</h2>
        <span className={`pill ${s.calibrated ? 'tone-ok' : 'tone-dosing'}`} style={{ height: 20, fontSize: 11 }}>
          <span className="dot" />
          {s.calibrated ? 'calibrated' : 'not calibrated'}
        </span>
      </div>
      <div className="card-b stack" style={{ gap: 12 }}>
        <div className="result-meta mono">
          <div><span className="muted">factor</span>{g(s.cal_factor, 2)} raw/g</div>
          <div><span className="muted">raw</span>{s.raw ?? '—'}</div>
          <div><span className="muted">stable</span>{s.stable ? 'yes' : 'no'}</div>
          <div><span className="muted">load cell</span><span style={{ color: s.scale_fault ? 'var(--bad-text)' : undefined }}>{s.scale_fault ? 'fault' : 'ok'}</span></div>
        </div>
        <button className="btn" onClick={() => setOpen(true)} disabled={api.link !== 'online'}>
          <Scale /> Calibrate…
        </button>
      </div>
      {open && <CalibrationSheet api={api} onClose={() => setOpen(false)} />}
    </div>
  )
}

const BUSY = new Set(['DOSING', 'SETTLE', 'VERIFY', 'MANUAL', 'CHECKS'])

function Step({ n, step, title, children }: { n: number; step: number; title: string; children: ReactNode }) {
  return (
    <div className="stack" style={{ gap: 8, opacity: step < n ? 0.45 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 500 }}>
        <span className="mono" style={{
          width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12,
          background: step > n ? 'var(--ok-bg)' : 'var(--surface-2)', color: step > n ? 'var(--ok-text)' : 'var(--text-2)',
          boxShadow: 'inset 0 0 0 1px var(--border)',
        }}>{step > n ? <Check /> : n}</span>
        {title}
      </div>
      <div style={{ paddingLeft: 32 }} className="stack">{children}</div>
    </div>
  )
}

function CalibrationSheet({ api, onClose }: { api: StationApi; onClose: () => void }) {
  const s = api.status
  const [mass, setMass] = useState('100')
  const [sent, setSent] = useState(false)
  const m = Number(mass)
  const busy = !!s && BUSY.has(s.state)
  const res = sent ? api.calib : null
  // step 2 stays open once the empty scale was tared: putting the mass on clears tare_ok
  const [wasTared, setWasTared] = useState(false)
  useEffect(() => {
    if (s?.tare_ok) setWasTared(true)
  }, [s?.tare_ok])
  const loaded = Math.abs(s?.weight_g ?? 0) > 0.5
  const step = res?.ok ? 3 : wasTared || loaded ? 2 : 1

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet card" role="dialog" aria-label="Calibrate scale" onClick={(e) => e.stopPropagation()}>
        <div className="card-h">
          <h2 style={{ color: 'var(--text)', fontSize: 15 }}>Calibrate scale</h2>
          <button className="btn btn-ghost icon-btn" aria-label="Close" onClick={onClose}><X width={16} height={16} /></button>
        </div>
        <div className="card-b stack" style={{ gap: 18 }}>
          <div className="readout" style={{ justifyContent: 'center' }}>
            <span className="val" style={{ fontSize: 56 }}>{g(s?.weight_g)}</span>
            <span className="unit">g</span>
          </div>
          <div className="mono muted" style={{ textAlign: 'center', fontSize: 12, marginTop: -10 }}>
            raw {s?.raw ?? '—'} · {s?.stable ? 'stable' : 'settling…'} · {g(s?.cal_factor, 2)} raw/g
          </div>

          <Step n={1} step={step} title="Empty the platform, then tare">
            <span className="dim" style={{ fontSize: 13 }}>
              Leave the cup on if you will always weigh in it. Don't touch the scale or the table.
            </span>
            <button className="btn" style={{ justifySelf: 'start' }} disabled={busy || !!s?.calibrating} onClick={api.tare}>
              <Scale /> Tare
            </button>
          </Step>

          <Step n={2} step={step} title="Put a known mass on and calibrate">
            <span className="dim" style={{ fontSize: 13 }}>
              Use something whose mass you know precisely: a calibration weight, or an object weighed on a lab balance.
              Pick a mass close to what you'll dose (10–200 g). Wait for "stable".
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="input-wrap" style={{ width: 140 }}>
                <input className="input mono" inputMode="decimal" value={mass} aria-invalid={!(m > 0)}
                  onChange={(e) => setMass(e.target.value)} />
                <span className="unit">g</span>
              </div>
              <button className="btn btn-primary" disabled={step < 2 || !(m > 0) || busy || !!s?.calibrating || !s?.stable}
                onClick={() => { setSent(true); api.calibrate(m) }}>
                {s?.calibrating ? 'Measuring…' : 'Calibrate'}
              </button>
            </div>
            {res && !res.ok && (
              <div className="banner tone-bad" style={{ padding: '8px 12px', fontSize: 13 }}>{res.msg}</div>
            )}
          </Step>

          <Step n={3} step={step} title="Check it">
            {res?.ok ? (
              <span className="dim" style={{ fontSize: 13 }}>
                Saved on the ESP32: <span className="mono">{g(res.factor, 2)} raw/g</span>. The display should now read
                about <span className="mono">{g(res.mass_g, 1)} g</span>. Take the mass off: it should return to 0.
              </span>
            ) : (
              <span className="dim" style={{ fontSize: 13 }}>The live reading should match the known mass.</span>
            )}
          </Step>

          <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'start', color: 'var(--text-3)' }}
            disabled={busy || !s?.calibrated}
            onClick={() => { if (confirm('Forget the saved calibration and go back to the default factor?')) api.calReset() }}>
            Reset to default factor
          </button>
        </div>
      </div>
    </div>
  )
}
