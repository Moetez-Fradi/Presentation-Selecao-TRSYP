import { useEffect, useState, type ReactNode } from 'react'
import { nextSampleId, useStation } from './station/useStation'
import { loadConnection, saveConnection, type Connection } from './station/connection'
import { ConnectionSheet } from './components/ConnectionSheet'
import { RunView, type Recipe } from './components/RunView'
import { HistoryView } from './components/HistoryView'
import { StatsView } from './components/StatsView'
import { EventLog } from './components/EventLog'
import { Activity, Chart, List, Mark, Moon, Sliders, Sun, Terminal } from './components/Icons'
import { ControlView } from './components/ControlView'

type Tab = 'run' | 'control' | 'history' | 'stats' | 'log'
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'run', label: 'Run', icon: <Activity /> },
  { id: 'control', label: 'Control', icon: <Sliders /> },
  { id: 'history', label: 'History', icon: <List /> },
  { id: 'stats', label: 'Stats', icon: <Chart /> },
  { id: 'log', label: 'Log', icon: <Terminal /> },
]

const LINK_LABEL = { disconnected: 'Broker down', connecting: 'Connecting', offline: 'ESP32 offline', online: 'Station online' } as const

const readTheme = (): 'dark' | 'light' => {
  try {
    return localStorage.getItem('ds.theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export default function App() {
  const [conn, setConn] = useState<Connection>(loadConnection)
  const [connOpen, setConnOpen] = useState(false)
  const api = useStation(conn)
  const [tab, setTab] = useState<Tab>('run')
  const [theme, setTheme] = useState(readTheme)
  const [recipe, setRecipe] = useState<Recipe>({
    recipe_id: 'R-001',
    lines: [{ material_id: 'MAT-A', target_g: '10.0', tol_g: '0.1' }],
    active: 0,
  })
  const [sampleId, setSampleId] = useState(() => {
    const last = api.runs.filter((r) => r.source === (conn.transport === 'mock' ? 'mock' : 'live')).at(-1)
    return last ? nextSampleId(last.sample_id) : 'B01-S01'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('ds.theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const linkTone = api.link === 'online' ? 'ok' : api.link === 'connecting' ? 'dosing' : 'bad'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Mark className="brand-mark" />
          <span>Dosing Station</span>
          <span className="slash">/</span>
          <span className="sub">DS-1</span>
        </div>
        <nav className="tabs top" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <button className="link-status" data-tone={linkTone} title="Connection settings" onClick={() => setConnOpen(true)}>
          <span className={`link-dot ${api.link === 'connecting' ? 'pulse' : ''}`} />
          {api.station.kind === 'mock' ? 'Simulator' : LINK_LABEL[api.link]}
        </button>
        <button className="btn btn-ghost icon-btn" aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </button>
      </header>

      <main>
        {tab === 'run' && <RunView api={api} recipe={recipe} setRecipe={setRecipe} sampleId={sampleId} setSampleId={setSampleId} />}
        {tab === 'history' && <HistoryView api={api} />}
        {tab === 'stats' && <StatsView api={api} />}
        {tab === 'control' && <ControlView api={api} />}
        {tab === 'log' && (
          <div className="page-grid">
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, letterSpacing: '-.02em' }}>Event log</h1>
            <div className="card"><EventLog log={api.log} /></div>
          </div>
        )}
      </main>

      {connOpen && (
        <ConnectionSheet
          conn={conn}
          link={api.link}
          onClose={() => setConnOpen(false)}
          onSave={(c) => {
            saveConnection(c)
            setConn(c)
            setConnOpen(false)
          }}
        />
      )}

      <nav className="bottombar" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
