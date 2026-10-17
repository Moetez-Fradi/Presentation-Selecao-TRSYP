import { useEffect, useState } from 'react'
import type { StationApi } from '../station/useStation'
import { ScaleCard } from './ScaleCard'
import { LcdCard } from './LcdCard'

const BUSY = new Set(['DOSING', 'SETTLE', 'VERIFY', 'MANUAL', 'CHECKS'])

/** Hardware widgets: one card per part of the station. New parts get a card here. */
export function ControlView({ api }: { api: StationApi }) {
  return (
    <div className="page-grid">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>Control</h1>
        <span className="muted">Drive each part of the station by hand. Disabled while a dose is running.</span>
      </div>
      <div className="control-grid">
        <VibratorCard api={api} />
        <AugerCard api={api} />
        <HopperCard api={api} />
        <ScaleCard api={api} />
        <LcdCard api={api} />
      </div>
    </div>
  )
}

function useIdle(api: StationApi) {
  const s = api.status
  return api.link === 'online' && !!s && !BUSY.has(s.state)
}

function VibratorCard({ api }: { api: StationApi }) {
  const on = !!api.status?.vib
  const idle = useIdle(api)
  const [secs, setSecs] = useState('5')
  const n = Number(secs)
  // countdown for timed runs (the station stops by itself; this is only display)
  const [until, setUntil] = useState<number | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!until) return
    const t = setInterval(() => tick((x) => x + 1), 200)
    return () => clearInterval(t)
  }, [until])
  useEffect(() => {
    if (!on) setUntil(null)
  }, [on])
  const left = until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : null

  return (
    <div className="card">
      <div className="card-h">
        <h2>Vibrator</h2>
        <span className={`pill ${on ? 'tone-dosing' : ''}`} style={{ height: 20, fontSize: 11 }}>
          <span className={`dot ${on ? 'pulse' : ''}`} />
          {on ? (left != null ? `running · ${left}s` : 'running') : 'off'}
        </span>
      </div>
      <div className="card-b stack" style={{ gap: 12 }}>
        <span className="dim" style={{ fontSize: 13 }}>
          Anti-bridging: shakes sugar loose when it jams in the hopper or auger. Manual only: it never runs during a dose. If a dose stops with NO_FLOW, shake, then retry.
        </span>
        <div className="row2">
          <button className="btn" disabled={!idle || on} onClick={() => { setUntil(null); api.vibrate(true) }}>Run</button>
          <button className="btn btn-danger" disabled={!idle || !on} onClick={() => api.vibrate(false)}>Stop</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="input-wrap" style={{ width: 110 }}>
            <input className="input mono" inputMode="decimal" value={secs} aria-invalid={!(n > 0 && n <= 60)}
              onChange={(e) => setSecs(e.target.value)} aria-label="Seconds" />
            <span className="unit">s</span>
          </div>
          <button className="btn" style={{ flex: 1 }} disabled={!idle || !(n > 0 && n <= 60)}
            onClick={() => { setUntil(Date.now() + n * 1000); api.vibrate(true, Math.round(n * 1000)) }}>
            Run for {n > 0 ? n : '…'} s
          </button>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Safety: the station stops it after 60 s at most.</span>
      </div>
    </div>
  )
}

const JOGS = [
  { label: '¼ turn', steps: 100 },
  { label: '1 turn', steps: 400 },
  { label: '5 turns', steps: 2000 },
]

function AugerCard({ api }: { api: StationApi }) {
  const idle = useIdle(api)
  const fitted = api.status?.auger !== false
  const [lastJog, setLastJog] = useState<string | null>(null)
  const jog = (steps: number) => {
    api.jog(steps)
    setLastJog(`${steps > 0 ? 'fed' : 'reversed'} ${Math.abs(steps)} steps`)
  }
  return (
    <div className="card">
      <div className="card-h">
        <h2>Auger</h2>
        <span className="pill" style={{ height: 20, fontSize: 11 }}>{fitted ? '400 steps / turn' : 'not fitted'}</span>
      </div>
      <div className="card-b stack" style={{ gap: 12 }}>
        <span className="dim" style={{ fontSize: 13 }}>
          Jog the screw by hand: prime it with sugar before the first dose, or back it off to clear a jam.
        </span>
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>Feed</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {JOGS.map((j) => (
              <button key={j.steps} className="btn btn-sm" disabled={!idle || !fitted} onClick={() => jog(j.steps)}>{j.label}</button>
            ))}
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>Reverse</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {JOGS.slice(0, 2).map((j) => (
              <button key={j.steps} className="btn btn-sm" disabled={!idle || !fitted} onClick={() => jog(-j.steps)}>{j.label}</button>
            ))}
          </div>
        </div>
        <span className="muted mono" style={{ fontSize: 12 }}>{lastJog ?? 'Weight change shows on the Run page and the LCD.'}</span>
      </div>
    </div>
  )
}

function HopperCard({ api }: { api: StationApi }) {
  const s = api.status
  const online = api.link === 'online'
  const mm = s?.hopper_mm
  const pct = s?.hopper_pct
  const cal = !!s?.hopper_cal
  return (
    <div className="card">
      <div className="card-h">
        <h2>Hopper level</h2>
        <span className={`pill ${cal ? 'tone-ok' : 'tone-dosing'}`} style={{ height: 20, fontSize: 11 }}>
          <span className="dot" />
          {cal ? 'calibrated' : 'not calibrated'}
        </span>
      </div>
      <div className="card-b stack" style={{ gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <span className="mono" style={{ fontSize: 34, fontWeight: 500, letterSpacing: '-.03em' }}>
            {pct != null ? `${pct}%` : '—'}
          </span>
          <span className="mono muted">{mm != null ? `${mm} mm to the sugar` : 'no echo'}</span>
        </div>
        <div className="progress"><div className="fill" style={{ width: `${pct ?? 0}%` }} /></div>
        <span className="dim" style={{ fontSize: 13 }}>
          Ultrasonic sensor on top of the hopper. Empty the hopper and press <b>Set empty</b>, then fill it and press{' '}
          <b>Set full</b>. Until both are set, the level never blocks a dose.
        </span>
        {api.lastAck?.cmd === 'hopper_cal' && (
          <div className={`banner ${api.lastAck.ok ? 'tone-ok' : 'tone-bad'}`} style={{ padding: '8px 12px', fontSize: 13 }}>
            {api.lastAck.ok ? `Saved: ${api.lastAck.msg ?? ''}` : api.lastAck.msg}
          </div>
        )}
        <div className="row2">
          <button className="btn" disabled={!online || mm == null} onClick={() => api.hopperCal('empty')}>Set empty</button>
          <button className="btn" disabled={!online || mm == null} onClick={() => api.hopperCal('full')}>Set full</button>
        </div>
      </div>
    </div>
  )
}
