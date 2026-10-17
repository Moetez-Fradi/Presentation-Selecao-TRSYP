// Wire protocol shared by the dashboard and the ESP32 firmware.
// One JSON object per message. Topics: trsyp/<station>/{cmd,evt,status,result,online}

export type Method = 'auto' | 'manual'

export type MachineState =
  | 'IDLE'
  | 'CHECKS'
  | 'DOSING'
  | 'SETTLE'
  | 'VERIFY'
  | 'DONE'
  | 'MANUAL'
  | 'ERROR'

export type Phase = 'FAST' | 'SLOW' | 'FINE' | 'TRIM' | 'SETTLE' | 'MANUAL'

export type RunStatus = 'ACCEPTED' | 'REJECTED' | 'INCOMPLETE'

export type ErrorCode =
  | 'NO_CUP'
  | 'NO_FLOW'
  | 'HOPPER_EMPTY'
  | 'POWER_OFF'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'LINK_LOST'
  | 'SCALE_FAULT'

// ---- PC -> ESP32 -------------------------------------------------------------

export interface StartCmd {
  cmd: 'start'
  recipe_id: string
  material_id: string
  sample_id: string
  target_g: number
  tol_g: number
  method: Method
  /** Learned from history on the PC, so it survives ESP32 resets. */
  overshoot_g: number
}

export type Command =
  | StartCmd
  | { cmd: 'stop' }
  | { cmd: 'tare' }
  | { cmd: 'status' }
  | { cmd: 'ping' }
  /** Manual mode: operator says the dose is finished. */
  | { cmd: 'done' }
  /** Scale calibration: tare empty first, then put a known mass on. */
  | { cmd: 'calibrate'; mass_g: number }
  | { cmd: 'cal_reset' }
  /** Show a message on the station LCD; '|' splits the two rows. */
  | { cmd: 'lcd'; text: string; ms: number }
  /** Vibrator (idle only): ms 0 or absent = until "on": false (firmware caps it at 60 s). */
  | { cmd: 'vib'; on: boolean; ms?: number }
  /** Hopper level: save the current ultrasonic distance as the empty or full point. */
  | { cmd: 'hopper_cal'; point: 'empty' | 'full' }
  /** Auger bench jog (idle only): steps > 0 feed, < 0 reverse. */
  | { cmd: 'jog'; steps: number; sps?: number }

// ---- ESP32 -> PC -------------------------------------------------------------

export interface StatusEvt {
  evt: 'status'
  state: MachineState
  weight_g: number
  cup: boolean
  hopper_ok: boolean
  /** 0..100 from the ultrasonic sensor; optional until the sensor is wired. */
  hopper_pct?: number
  power_ok: boolean
  tare_ok: boolean
  /** firmware diagnostics (optional) */
  stable?: boolean
  scale_fault?: boolean
  raw?: number
  auger?: boolean
  /** raw HX711 units per gram in use, and whether it comes from a saved calibration */
  vib?: boolean
  /** ultrasonic distance (mm) and whether empty/full points are saved */
  hopper_mm?: number
  hopper_cal?: boolean
  cal_factor?: number
  calibrated?: boolean
  calibrating?: boolean
}

export interface DoseEvt {
  evt: 'dose'
  phase: Phase
  weight_g: number
  t_ms: number
  stop_at_g?: number
  vib?: boolean
}

export interface ResultEvt {
  evt: 'result'
  run_id: string
  recipe_id: string
  material_id: string
  sample_id: string
  method: Method
  target_g: number
  tol_g: number
  measured_g: number
  dev_g: number
  status: RunStatus
  overshoot_g: number
  trim_steps: number
  t_start: string
  t_end: string
  duration_ms: number
  error?: ErrorCode
}

export interface ErrorEvt {
  evt: 'error'
  code: ErrorCode
  phase?: Phase
  weight_g?: number
}

export interface AckEvt {
  evt: 'ack'
  cmd: Command['cmd']
  ok: boolean
  msg?: string
}

export interface CalibEvt {
  evt: 'calib'
  ok: boolean
  factor: number
  mass_g: number
  msg: string
}

export type StationEvent = StatusEvt | DoseEvt | ResultEvt | ErrorEvt | AckEvt | CalibEvt

export const ERROR_TEXT: Record<ErrorCode, string> = {
  NO_CUP: 'Cup removed or missing',
  NO_FLOW: 'Auger turning but weight not rising: shake the hopper, then retry',
  HOPPER_EMPTY: 'Hopper level too low',
  POWER_OFF: '12 V supply is off',
  TIMEOUT: 'Dose took too long',
  ABORTED: 'Stopped by operator',
  LINK_LOST: 'Dashboard link lost during dose',
  SCALE_FAULT: 'Load cell not responding or overloaded',
}
