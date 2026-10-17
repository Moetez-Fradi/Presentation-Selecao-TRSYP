import { useState } from 'react'
import { normalizeUrl, presetFor, PRESETS, type Connection } from '../station/connection'
import type { LinkState } from '../station/Station'
import { randomToken } from '../station/sign'
import { X } from './Icons'

interface Props {
  conn: Connection
  link: LinkState
  onSave: (c: Connection) => void
  onClose: () => void
}

const LINK_TEXT: Record<LinkState, string> = {
  disconnected: 'Broker not reachable',
  connecting: 'Connecting to broker…',
  offline: 'Broker connected · ESP32 offline',
  online: 'Broker connected · ESP32 online',
}

export function ConnectionSheet({ conn, link, onSave, onClose }: Props) {
  const [transport, setTransport] = useState(conn.transport)
  const [m, setM] = useState(conn.mqtt)
  const [copied, setCopied] = useState(false)
  const preset = presetFor(m.url)
  const [custom, setCustom] = useState(!preset)
  const url = normalizeUrl(m.url)
  const valid = transport === 'mock' || (!!url && !!m.stationId.trim())
  const device = preset?.device ?? url.replace(/^wss:\/\/([^:/]+).*$/, 'mqtts://$1:8883')

  const secrets = `#define MQTT_URI      "${device}"
#define MQTT_USER     "${preset ? '' : m.username}"
#define MQTT_PASS     "${preset ? '' : 'esp32-password'}"
#define STATION_ID    "${m.stationId}"
#define PAIR_KEY      "${m.pairKey}"`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secrets)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked: the block is selectable */
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet card" role="dialog" aria-label="Connection" onClick={(e) => e.stopPropagation()}>
        <div className="card-h">
          <h2 style={{ color: 'var(--text)', fontSize: 15 }}>Connection</h2>
          <button className="btn btn-ghost icon-btn" aria-label="Close" onClick={onClose}><X width={16} height={16} /></button>
        </div>
        <div className="card-b stack">
          <div className="seg" style={{ width: '100%' }}>
            <button aria-pressed={transport === 'mqtt'} onClick={() => setTransport('mqtt')}>Station (MQTT)</button>
            <button aria-pressed={transport === 'mock'} onClick={() => setTransport('mock')}>Simulator</button>
          </div>

          {transport === 'mqtt' ? (
            <>
              <div className="field">
                <label>Broker</label>
                <div className="seg" style={{ width: '100%' }}>
                  {PRESETS.map((p) => (
                    <button key={p.id} aria-pressed={!custom && preset?.id === p.id}
                      onClick={() => { setCustom(false); setM({ ...m, url: p.ws, username: '', password: '' }) }}>
                      {p.label}
                    </button>
                  ))}
                  <button aria-pressed={custom} onClick={() => setCustom(true)}>Custom</button>
                </div>
                {!custom && <span className="muted" style={{ fontSize: 11 }}>No account or sign-up needed. Open server, so commands are signed with the pairing key below.</span>}
              </div>

              {custom && (
                <>
                  <div className="field">
                    <label htmlFor="c-url">Broker host or URL</label>
                    <input id="c-url" className="input mono" placeholder="wss://host:8884/mqtt" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                      value={m.url} onChange={(e) => setM({ ...m, url: e.target.value })} />
                    {url && url !== m.url.trim() && <span className="muted mono" style={{ fontSize: 11 }}>→ {url}</span>}
                  </div>
                  <div className="row2">
                    <div className="field">
                      <label htmlFor="c-user">Username</label>
                      <input id="c-user" className="input mono" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                        value={m.username} onChange={(e) => setM({ ...m, username: e.target.value })} />
                    </div>
                    <div className="field">
                      <label htmlFor="c-pass">Password</label>
                      <input id="c-pass" className="input mono" type="password" autoComplete="current-password"
                        value={m.password} onChange={(e) => setM({ ...m, password: e.target.value })} />
                    </div>
                  </div>
                </>
              )}

              <div className="row2">
                <div className="field">
                  <label htmlFor="c-id">Station ID</label>
                  <input id="c-id" className="input mono" autoCapitalize="off" value={m.stationId}
                    onChange={(e) => setM({ ...m, stationId: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} />
                </div>
                <div className="field">
                  <label htmlFor="c-key" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    Pairing key
                    <button className="btn btn-ghost" style={{ height: 'auto', padding: 0, fontSize: 12, color: 'var(--text-2)' }}
                      onClick={() => setM({ ...m, pairKey: randomToken(24) })}>generate</button>
                  </label>
                  <input id="c-key" className="input mono" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                    value={m.pairKey} aria-invalid={!custom && !m.pairKey}
                    onChange={(e) => setM({ ...m, pairKey: e.target.value.trim() })} />
                </div>
              </div>

              <div className="field">
                <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>For the ESP32 <span className="mono">secrets.h</span></span>
                  <button className="btn btn-ghost" style={{ height: 'auto', padding: 0, fontSize: 12, color: 'var(--text-2)' }} onClick={copy}>
                    {copied ? 'copied' : 'copy'}
                  </button>
                </label>
                <pre className="mono" style={{ margin: 0, padding: 10, fontSize: 11, lineHeight: 1.6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, overflowX: 'auto', userSelect: 'all' }}>
                  {secrets}
                </pre>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Saved on this device only. Use the same station ID and pairing key on every phone and in the firmware.
              </p>
            </>
          ) : (
            <p className="dim" style={{ margin: 0, fontSize: 13 }}>
              The simulator runs entirely in this browser with the same protocol as the ESP32. Its runs are tagged SIM and kept apart from real ones in the stats.
            </p>
          )}

          {conn.transport === 'mqtt' && (
            <div className="mono dim" style={{ fontSize: 12 }}>Current: {LINK_TEXT[link]}</div>
          )}

          <button className="btn btn-primary btn-lg" disabled={!valid}
            onClick={() => onSave({ transport, mqtt: { ...m, url: transport === 'mqtt' ? url : m.url } })}>
            Save & connect
          </button>
        </div>
      </div>
    </div>
  )
}
