import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MockStation } from './MockStation'
import { MqttStation } from './MqttStation'
import type { Connection } from './connection'
import type { LinkState, Station } from './Station'
import type {
  AckEvt,
  CalibEvt,
  Command,
  DoseEvt,
  ErrorEvt,
  Method,
  ResultEvt,
  StartCmd,
  StationEvent,
  StatusEvt,
} from './protocol'

export interface RunRecord extends ResultEvt {
  source: 'mock' | 'live'
}

export interface TracePoint {
  t: number
  w: number
  phase: DoseEvt['phase']
  vib: boolean
}

export interface LogEntry {
  id: number
  ts: number
  dir: 'in' | 'out'
  kind: string
  text: string
  tone: 'neutral' | 'good' | 'bad' | 'warn' | 'info'
}

export interface Job {
  recipe_id: string
  material_id: string
  sample_id: string
  target_g: number
  tol_g: number
  method: Method
}

const RUNS_KEY = 'ds.runs.v1'
const DEFAULT_OVERSHOOT = 0.2
const LEARN_WINDOW = 5
/** Powder still falling after the stop: physically small and never negative. */
const MAX_OVERSHOOT = 1.0
const plausibleOvershoot = (r: { overshoot_g: number; target_g: number }) =>
  r.overshoot_g >= 0 && r.overshoot_g <= Math.min(MAX_OVERSHOOT, 0.2 * r.target_g)
const MAX_LOG = 400

const loadRuns = (): RunRecord[] => {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) ?? '[]')
  } catch {
    return []
  }
}
const saveRuns = (runs: RunRecord[]) => {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs))
  } catch {
    /* storage unavailable: runs stay in memory */
  }
}

/** Next sample ID after "B01-S03" is "B01-S04". */
export const nextSampleId = (id: string) =>
  id.replace(/(\d+)(?!.*\d)/, (d) => String(Number(d) + 1).padStart(d.length, '0'))

const describe = (e: StationEvent): Pick<LogEntry, 'kind' | 'text' | 'tone'> => {
  switch (e.evt) {
    case 'status':
      return { kind: 'status', text: `${e.state} · ${e.weight_g.toFixed(2)} g`, tone: 'neutral' }
    case 'dose':
      return {
        kind: 'dose',
        text: `${e.phase} · ${e.weight_g.toFixed(2)} g · t=${(e.t_ms / 1000).toFixed(1)} s${e.vib ? ' · vib' : ''}`,
        tone: 'info',
      }
    case 'result':
      return {
        kind: 'result',
        text: `${e.sample_id} · ${e.measured_g.toFixed(2)} / ${e.target_g.toFixed(2)} g · ${e.dev_g >= 0 ? '+' : ''}${e.dev_g.toFixed(2)} g · ${e.status}`,
        tone: e.status === 'ACCEPTED' ? 'good' : 'bad',
      }
    case 'error':
      return { kind: 'error', text: e.code + (e.phase ? ` during ${e.phase}` : ''), tone: 'bad' }
    case 'ack':
      return { kind: 'ack', text: `${e.cmd} ${e.ok ? 'ok' : 'refused'}${e.msg ? ` (${e.msg})` : ''}`, tone: e.ok ? 'neutral' : 'warn' }
    case 'calib':
      return {
        kind: 'calib',
        text: e.ok ? `${e.mass_g} g → ${e.factor.toFixed(2)} raw/g, saved` : `failed: ${e.msg}`,
        tone: e.ok ? 'good' : 'bad',
      }
  }
}

export function useStation(conn: Connection) {
  const station = useMemo<Station>(
    () => (conn.transport === 'mqtt' && conn.mqtt.url ? new MqttStation(conn.mqtt) : new MockStation()),
    [conn],
  )
  const [link, setLink] = useState<LinkState>('disconnected')
  const [status, setStatus] = useState<StatusEvt | null>(null)
  const [trace, setTrace] = useState<TracePoint[]>([])
  const [stopAt, setStopAt] = useState<number | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [result, setResult] = useState<RunRecord | null>(null)
  const [error, setError] = useState<ErrorEvt | null>(null)
  const [runs, setRuns] = useState<RunRecord[]>(loadRuns)
  const [log, setLog] = useState<LogEntry[]>([])
  const [seriesLeft, setSeriesLeft] = useState(0)
  const [calib, setCalib] = useState<CalibEvt | null>(null)
  const [lastAck, setLastAck] = useState<AckEvt | null>(null)
  const logId = useRef(0)
  const seriesRef = useRef({ left: 0, job: null as Job | null })

  const push = useCallback((entry: Omit<LogEntry, 'id' | 'ts'>) => {
    setLog((l) => {
      const next = [...l, { ...entry, id: ++logId.current, ts: Date.now() }]
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next
    })
  }, [])

  const learnedOvershoot = useMemo(() => {
    const src = station.kind === 'mock' ? 'mock' : 'live'
    const recent = runs
      // a run whose "overshoot" is negative or huge was disturbed (hand on the scale,
      // bumped table): learning from it would push the stop threshold past the target
      .filter((r) => r.source === src && r.method === 'auto' && r.status !== 'INCOMPLETE' && plausibleOvershoot(r))
      .slice(-LEARN_WINDOW)
    if (!recent.length) return DEFAULT_OVERSHOOT
    const avg = recent.reduce((s, r) => s + r.overshoot_g, 0) / recent.length
    return Math.min(MAX_OVERSHOOT, Math.max(0, avg))
  }, [runs, station.kind])

  const send = useCallback(
    (c: Command) => {
      station.send(c)
      if (c.cmd !== 'ping' && c.cmd !== 'status') {
        const { cmd, ...rest } = c
        push({ dir: 'out', kind: cmd, text: Object.keys(rest).length ? JSON.stringify(rest) : cmd, tone: 'neutral' })
      }
    },
    [station, push],
  )

  const begin = useCallback(
    (j: Job) => {
      const cmd: StartCmd = { cmd: 'start', ...j, overshoot_g: Number(learnedOvershoot.toFixed(3)) }
      setTrace([])
      setStopAt(null)
      setResult(null)
      setError(null)
      setJob(j)
      send(cmd)
    },
    [send, learnedOvershoot],
  )

  // the next run of a series must see the overshoot learned from the previous one
  const beginRef = useRef(begin)
  useEffect(() => {
    beginRef.current = begin
  }, [begin])

  useEffect(() => {
    setStatus(null)
    setTrace([])
    setJob(null)
    setResult(null)
    setError(null)
    const offLink = station.onLink(setLink)
    const offEvt = station.onEvent((e) => {
      if (e.evt !== 'status' && e.evt !== 'dose') push({ dir: 'in', ...describe(e) })
      switch (e.evt) {
        case 'status':
          setStatus(e)
          // a dose is starting (from this or another device): clear the previous run's view
          if (e.state === 'CHECKS') {
            setTrace([])
            setStopAt(null)
            setResult(null)
            setError(null)
          }
          break
        case 'dose':
          // time going backwards = a new dose, possibly started from another device
          setTrace((t) => {
            const p = { t: e.t_ms, w: e.weight_g, phase: e.phase, vib: !!e.vib }
            return t.length && e.t_ms < t[t.length - 1].t ? [p] : [...t, p]
          })
          if (e.stop_at_g !== undefined) setStopAt(e.stop_at_g)
          break
        case 'error':
          setError(e)
          seriesRef.current.left = 0
          setSeriesLeft(0)
          break
        case 'ack':
          setLastAck(e)
          if (e.cmd === 'start' && !e.ok) setJob(null)
          if (e.cmd === 'calibrate' && !e.ok) setCalib({ evt: 'calib', ok: false, factor: 0, mass_g: 0, msg: e.msg ?? 'refused' })
          break
        case 'calib':
          setCalib(e)
          break
        case 'result': {
          const rec: RunRecord = { ...e, source: station.kind === 'mock' ? 'mock' : 'live' }
          setResult(rec)
          setRuns((rs) => {
            // retained result replayed on reconnect: already logged
            if (rs.some((r) => r.run_id === rec.run_id)) return rs
            const next = [...rs, rec]
            saveRuns(next)
            return next
          })
          const s = seriesRef.current
          if (s.left > 0 && s.job && e.status !== 'INCOMPLETE') {
            s.left--
            setSeriesLeft(s.left)
            if (s.left > 0) {
              const nj = { ...s.job, sample_id: nextSampleId(s.job.sample_id) }
              s.job = nj
              // next cup: the real operator swaps it; the sim just tares
              window.setTimeout(() => {
                station.send({ cmd: 'tare' })
                window.setTimeout(() => beginRef.current(nj), 600)
              }, 1200)
            }
          }
          break
        }
      }
    })
    station.connect()
    const ping = window.setInterval(() => station.send({ cmd: 'ping' }), 1000)
    return () => {
      window.clearInterval(ping)
      offLink()
      offEvt()
      station.disconnect()
    }
  }, [station, push])

  const start = useCallback(
    (j: Job, series = 1) => {
      seriesRef.current = { left: series > 1 ? series : 0, job: j }
      setSeriesLeft(series > 1 ? series : 0)
      begin(j)
    },
    [begin],
  )

  const stop = useCallback(() => {
    seriesRef.current.left = 0
    setSeriesLeft(0)
    send({ cmd: 'stop' })
  }, [send])

  const clearRuns = useCallback(() => {
    setRuns([])
    saveRuns([])
  }, [])

  return {
    station,
    link,
    status,
    trace,
    stopAt,
    job,
    result,
    error,
    runs,
    log,
    seriesLeft,
    learnedOvershoot,
    start,
    stop,
    tare: () => send({ cmd: 'tare' }),
    done: () => send({ cmd: 'done' }),
    calib,
    lastAck,
    calibrate: (mass_g: number) => {
      setCalib(null)
      send({ cmd: 'calibrate', mass_g })
    },
    calReset: () => send({ cmd: 'cal_reset' }),
    lcdMessage: (text: string, ms = 5000) => send({ cmd: 'lcd', text, ms }),
    hopperCal: (point: 'empty' | 'full') => send({ cmd: 'hopper_cal', point }),
    vibrate: (on: boolean, ms?: number) => send(ms ? { cmd: 'vib', on, ms } : { cmd: 'vib', on }),
    jog: (steps: number, sps?: number) => send(sps ? { cmd: 'jog', steps, sps } : { cmd: 'jog', steps }),
    clearRuns,
  }
}

export type StationApi = ReturnType<typeof useStation>
