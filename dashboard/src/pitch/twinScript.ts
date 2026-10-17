import { useEffect, useState } from 'react'
import type { TwinState } from '../twin/TwinScene'
import type { Phase } from '../station/protocol'

/** Scripted machine states that drive the twin on each slide (no station needed). */
export type TwinMode = 'idle' | 'dosing' | 'nocup' | 'vib' | 'done'

const BASE: TwinState = {
  online: true, state: 'IDLE', vib: false, cup: true, hopperOk: true, hopperPct: 70,
  powerOk: true, tareOk: true, scaleFault: false, augerFitted: true, weight: 0, target: 10,
}

// one dose, seconds: FAST to 7.5 g, SLOW to 9.5 g, FINE to the stop point, settle, trim, result
const CYCLE = 15
function dosing(t: number): TwinState {
  const c = t % CYCLE
  const seg = (a: number, b: number, w0: number, w1: number) => w0 + ((c - a) / (b - a)) * (w1 - w0)
  let phase: Phase | undefined
  let w = 0
  let state: TwinState['state'] = 'DOSING'
  if (c < 4.5) { phase = 'FAST'; w = seg(0, 4.5, 0, 7.5) }
  else if (c < 7.5) { phase = 'SLOW'; w = seg(4.5, 7.5, 7.5, 9.5) }
  else if (c < 9.5) { phase = 'FINE'; w = seg(7.5, 9.5, 9.5, 9.8) }
  else if (c < 10.4) { phase = 'SETTLE'; state = 'SETTLE'; w = seg(9.5, 10.4, 9.8, 9.91) }
  else if (c < 11.4) { phase = 'TRIM'; w = seg(10.4, 11.4, 9.91, 9.97) }
  else { state = 'DONE'; w = 9.97 }
  // short vibration bursts while the coarse phases run (anti-bridging)
  const vib = (phase === 'FAST' || phase === 'SLOW') && c % 1.6 < 0.35
  return { ...BASE, state, phase, vib, weight: w, result: state === 'DONE' ? 'ACCEPTED' : undefined }
}

export function twinAt(mode: TwinMode, t: number): TwinState {
  switch (mode) {
    case 'dosing': return dosing(t)
    case 'nocup': return { ...BASE, cup: false, error: 'NO_CUP' }
    case 'vib': return { ...BASE, state: 'DOSING', phase: 'SLOW', vib: true, weight: 6.8 }
    case 'done': return { ...BASE, state: 'DONE', weight: 9.97, result: 'ACCEPTED' }
    default: return BASE
  }
}

/** Re-evaluates the script ~15 times a second; restarts the clock when the mode changes. */
export function useTwinScript(mode: TwinMode) {
  const [s, setS] = useState(() => twinAt(mode, 0))
  useEffect(() => {
    const t0 = performance.now()
    setS(twinAt(mode, 0))
    if (mode !== 'dosing') return
    const id = setInterval(() => setS(twinAt(mode, (performance.now() - t0) / 1000)), 66)
    return () => clearInterval(id)
  }, [mode])
  return s
}
