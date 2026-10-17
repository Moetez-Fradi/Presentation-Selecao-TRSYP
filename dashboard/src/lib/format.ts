import type { RunRecord } from '../station/useStation'
import type { MachineState } from '../station/protocol'

export const g = (x: number | undefined | null, d = 2) => (x == null || Number.isNaN(x) ? '—' : x.toFixed(d))
export const sg = (x: number, d = 2) => (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(d)
export const secs = (ms: number) => (ms / 1000).toFixed(1) + ' s'

export const clock = (ts: number | string) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export type Tone = 'idle' | 'dosing' | 'ok' | 'bad'

/** Same mapping as the RGB LED on the station. */
export const stateTone = (s: MachineState | undefined, lastOk?: boolean): Tone => {
  switch (s) {
    case 'DOSING':
    case 'SETTLE':
    case 'VERIFY':
    case 'CHECKS':
    case 'MANUAL':
      return 'dosing'
    case 'DONE':
      return lastOk === false ? 'bad' : 'ok'
    case 'ERROR':
      return 'bad'
    default:
      return 'idle'
  }
}

export interface Stats {
  n: number
  meanDev: number
  meanAbsDev: number
  sd: number
  min: number
  max: number
  rejected: number
  incomplete: number
  meanTimeMs: number
  acceptRate: number
}

export function stats(runs: RunRecord[]): Stats | null {
  const done = runs.filter((r) => r.status !== 'INCOMPLETE')
  if (!done.length) return null
  const n = done.length
  const devs = done.map((r) => r.dev_g)
  const meanDev = devs.reduce((a, b) => a + b, 0) / n
  const meanAbsDev = devs.reduce((a, b) => a + Math.abs(b), 0) / n
  const sd = n > 1 ? Math.sqrt(devs.reduce((a, b) => a + (b - meanDev) ** 2, 0) / (n - 1)) : 0
  const rejected = done.filter((r) => r.status === 'REJECTED').length
  return {
    n,
    meanDev,
    meanAbsDev,
    sd,
    min: Math.min(...devs),
    max: Math.max(...devs),
    rejected,
    incomplete: runs.length - n,
    meanTimeMs: done.reduce((a, r) => a + r.duration_ms, 0) / n,
    acceptRate: (n - rejected) / n,
  }
}

const CSV_COLS = [
  't_start', 't_end', 'run_id', 'recipe_id', 'material_id', 'sample_id', 'method', 'target_g', 'measured_g',
  'dev_g', 'tol_g', 'status', 'overshoot_g', 'trim_steps', 'duration_ms', 'error', 'source',
] as const

export function toCsv(runs: RunRecord[]) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [CSV_COLS.join(','), ...runs.map((r) => CSV_COLS.map((c) => esc(r[c])).join(','))].join('\n')
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
