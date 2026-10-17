import { useEffect, useRef } from 'react'
import type { LogEntry } from '../station/useStation'
import { clock } from '../lib/format'

/** Build-log style stream of every message exchanged with the station. */
export function EventLog({ log, compact }: { log: LogEntry[]; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [log])

  const rows = compact ? log.slice(-80) : log
  return (
    <div
      ref={ref}
      className={`log ${compact ? '' : 'tall'}`}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
    >
      {!rows.length && <div className="empty">No messages yet</div>}
      {rows.map((e) => (
        <div key={e.id} className={`log-row t-${e.tone}`}>
          <span className="ts">{clock(e.ts)}</span>
          <span className="dir">{e.dir === 'out' ? '→' : '←'}</span>
          <span className="kind">{e.kind}</span>
          <span className="msg">{e.text}</span>
        </div>
      ))}
    </div>
  )
}
