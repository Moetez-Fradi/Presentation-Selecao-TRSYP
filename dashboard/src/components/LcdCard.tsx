import { useState } from 'react'
import type { StationApi } from '../station/useStation'

const COLS = 16
const PRESETS = ['Welcome, judges!|TRSYP 3.0', 'Laboratory 4.0|Weigh Dose Verify', 'Recipe R-001|Starting soon...']
const DURATIONS = [5, 15, 60]

/** Send a message to the station's 16x2 LCD ('|' splits the rows), with a live preview. */
export function LcdCard({ api }: { api: StationApi }) {
  const [text, setText] = useState(PRESETS[0])
  const [secs, setSecs] = useState(5)
  const [sent, setSent] = useState(false)
  const [a, b = ''] = text.split('|')
  const centered = !text.includes('|') && a.length <= COLS
  const row = (s: string, center = false) => {
    const t = s.slice(0, COLS)
    const pad = center ? Math.floor((COLS - t.length) / 2) : 0
    return (' '.repeat(pad) + t).padEnd(COLS, ' ')
  }
  const scrolls = a.length > COLS || b.length > COLS
  const online = api.link === 'online'

  return (
    <div className="card">
      <div className="card-h">
        <h2>Station display</h2>
        <span className="muted mono" style={{ fontSize: 11 }}>16×2 LCD</span>
      </div>
      <div className="card-b stack" style={{ gap: 10 }}>
        <div className="lcd-preview mono" aria-label="LCD preview">
          <div>{row(a, centered)}</div>
          <div>{row(centered ? '' : b)}</div>
        </div>
        <input className="input mono" value={text} maxLength={90} onChange={(e) => setText(e.target.value)}
          placeholder="Line 1|Line 2" aria-label="LCD message" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESETS.map((p) => (
            <button key={p} className="btn btn-sm" onClick={() => setText(p)}>{p.split('|')[0]}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <div className="seg" role="group" aria-label="Duration">
            {DURATIONS.map((d) => (
              <button key={d} aria-pressed={secs === d} onClick={() => setSecs(d)}>{d} s</button>
            ))}
          </div>
          <button className="btn btn-primary" disabled={!online || !text.trim()}
            onClick={() => { api.lcdMessage(text.trim(), secs * 1000); setSent(true); setTimeout(() => setSent(false), 1500) }}>
            {sent ? 'Sent' : 'Show on LCD'}
          </button>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          Use | to split the two rows.{scrolls ? ' Longer lines scroll on the screen.' : ''}
        </span>
      </div>
    </div>
  )
}
