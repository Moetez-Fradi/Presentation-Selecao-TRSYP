import { Emitter, type LinkState, type Station } from './Station.ts'
import type {
  Command,
  ErrorCode,
  MachineState,
  Phase,
  ResultEvt,
  StartCmd,
  StationEvent,
} from './protocol.ts'

const TICK_MS = 50
const DOSE_EVERY_MS = 150
const STATUS_EVERY_MS = 500
const HOPPER_CAPACITY_G = 300

/** Motor feed rate per phase, g/s of powder leaving the auger. */
const RATE: Partial<Record<Phase, number>> = { FAST: 1.6, SLOW: 0.5, FINE: 0.12 }
/** Time constant of powder still falling after it leaves the auger (overshoot source). */
const FALL_TAU_S = 0.35
const MAX_TRIMS = 6

const gauss = () => {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d

/**
 * In-browser simulation of the dosing station, speaking the real protocol.
 * Models auger feed, powder in flight (overshoot), bridging + vibration, and a
 * noisy load cell, so the UI behaves as it will with the real machine.
 */
export class MockStation implements Station {
  readonly kind = 'mock' as const
  private events = new Emitter<StationEvent>()
  private links = new Emitter<LinkState>()
  private timer: ReturnType<typeof setInterval> | undefined
  private boot: ReturnType<typeof setTimeout> | undefined

  // fault injection, driven from the sim panel
  cup = true
  power = true
  hopperG = 260
  speed = 1

  private state: MachineState = 'IDLE'
  private landed = 0 // mass on the scale, relative to tare
  private inFlight = 0
  private job: StartCmd | null = null
  private phase: Phase = 'FAST'
  private tMs = 0
  private startedAt = 0
  private lastDoseEmit = 0
  private lastStatusEmit = 0
  private phaseUntil = 0
  private stopAt = 0
  private weightAtStop = 0
  private measuredOvershoot = 0
  private trims = 0
  private bridged = false
  private vib = false
  private lastRiseT = 0
  private lastRiseW = 0
  private manualNextAt = 0
  private calibrating = false
  private calFactor = 420
  private vibTimer: ReturnType<typeof setTimeout> | undefined

  connect() {
    this.disconnect()
    this.links.emit('connecting')
    this.boot = globalThis.setTimeout(() => {
      this.links.emit('online')
      this.timer = globalThis.setInterval(() => this.tick(), TICK_MS)
      this.emitStatus()
    }, 400)
  }

  disconnect() {
    globalThis.clearTimeout(this.boot)
    globalThis.clearInterval(this.timer)
    this.links.emit('disconnected')
  }

  onEvent(fn: (e: StationEvent) => void) {
    return this.events.on(fn)
  }
  onLink(fn: (s: LinkState) => void) {
    return this.links.on(fn)
  }

  /** Simulates a sudden bridge in the hopper (flow stops until vibration clears it). */
  bridge() {
    this.bridged = true
  }

  refill() {
    this.hopperG = HOPPER_CAPACITY_G
  }

  send(c: Command) {
    switch (c.cmd) {
      case 'ping':
      case 'status':
        if (c.cmd === 'status') this.emitStatus()
        return
      case 'tare':
        if (this.busy()) return this.ack(c.cmd, false, 'busy')
        this.landed = 0
        this.inFlight = 0
        if (this.state === 'DONE' || this.state === 'ERROR') this.state = 'IDLE'
        this.ack(c.cmd, true)
        return this.emitStatus()
      case 'stop':
        if (!this.busy()) return this.ack(c.cmd, true)
        this.ack(c.cmd, true)
        return this.fail('ABORTED')
      case 'done':
        if (this.state !== 'MANUAL') return this.ack(c.cmd, false, 'not in manual')
        this.ack(c.cmd, true)
        return this.finish()
      case 'calibrate':
        if (this.busy()) return this.ack(c.cmd, false, 'busy')
        if (!(c.mass_g > 0)) return this.ack(c.cmd, false, 'give the known mass in grams')
        this.ack(c.cmd, true)
        this.calibrating = true
        this.emitStatus()
        globalThis.setTimeout(() => {
          this.calibrating = false
          this.calFactor = 2104.5 + 3 * gauss()
          this.events.emit({ evt: 'calib', ok: true, factor: round(this.calFactor, 3), mass_g: c.mass_g, msg: 'saved' })
          this.emitStatus()
        }, 2000)
        return
      case 'lcd':
        return this.ack(c.cmd, true)
      case 'hopper_cal':
        return this.ack(c.cmd, true, `${c.point} saved`)
      case 'jog':
        if (this.busy()) return this.ack(c.cmd, false, 'busy')
        if (c.steps > 0) this.feed(Math.min(this.hopperG, c.steps * 0.004))  // ~0.004 g/step
        return this.ack(c.cmd, true)
      case 'vib':
        if (this.busy()) return this.ack(c.cmd, false, 'busy')
        globalThis.clearTimeout(this.vibTimer)
        this.vib = c.on
        if (c.on) this.vibTimer = globalThis.setTimeout(() => { this.vib = false; this.emitStatus() }, Math.min(c.ms || 60000, 60000))
        this.ack(c.cmd, true)
        return this.emitStatus()
      case 'cal_reset':
        this.calFactor = 420
        this.ack(c.cmd, true)
        return this.emitStatus()
      case 'start':
        return this.start(c)
    }
  }

  // ---------------------------------------------------------------------------

  private busy() {
    return this.state === 'DOSING' || this.state === 'SETTLE' || this.state === 'VERIFY' || this.state === 'MANUAL'
  }

  private start(c: StartCmd) {
    if (this.busy()) return this.ack('start', false, 'busy')
    const blocker: ErrorCode | null = !this.power
      ? 'POWER_OFF'
      : !this.cup
        ? 'NO_CUP'
        : this.hopperPct() < 5
          ? 'HOPPER_EMPTY'
          : null
    if (blocker) {
      this.ack('start', false, blocker)
      this.events.emit({ evt: 'error', code: blocker })
      return
    }
    this.ack('start', true)
    this.job = c
    // auto-tare before every dose
    this.landed = 0
    this.inFlight = 0
    this.tMs = 0
    this.trims = 0
    this.measuredOvershoot = 0
    this.lastDoseEmit = -Infinity
    this.startedAt = Date.now()
    this.lastRiseT = 0
    this.lastRiseW = 0
    this.vib = false
    this.bridged = false
    if (c.method === 'manual') {
      this.state = 'MANUAL'
      this.phase = 'MANUAL'
      this.manualNextAt = 1500
    } else {
      this.state = 'DOSING'
      this.phase = 'FAST'
      this.stopAt = c.target_g - c.overshoot_g
    }
    this.emitStatus()
  }

  private tick() {
    // fixed 50 ms physics steps; "speed" runs several per real tick
    for (let i = 0; i < this.speed; i++) this.step()
    if (performance.now() - this.lastStatusEmit >= STATUS_EVERY_MS) this.emitStatus()
  }

  private step() {
    const dt = TICK_MS / 1000
    const dtMs = TICK_MS

    // powder in flight keeps landing whatever the state
    const landing = this.inFlight * Math.min(1, dt / FALL_TAU_S)
    this.inFlight -= landing
    this.landed += landing

    if (this.busy()) {
      this.tMs += dtMs
      if (!this.cup) return this.fail('NO_CUP')
      if (!this.power) return this.fail('POWER_OFF')
      if (this.tMs > 120_000) return this.fail('TIMEOUT')
      if (this.state === 'MANUAL') this.tickManual()
      else this.tickAuto(dt)
      if (this.tMs - this.lastDoseEmit >= DOSE_EVERY_MS * this.speed) {
        this.lastDoseEmit = this.tMs
        this.events.emit({
          evt: 'dose',
          phase: this.phase,
          weight_g: round(this.reading()),
          t_ms: Math.round(this.tMs),
          stop_at_g: this.job?.method === 'auto' ? round(this.stopAt) : undefined,
          vib: this.vib,
        })
      }
    }
  }

  private tickAuto(dt: number) {
    const job = this.job!
    const w = this.landed

    if (this.state === 'DOSING') {
      // phase from remaining mass, never from time
      if (this.phase !== 'TRIM') {
        this.phase = w < 0.75 * job.target_g ? 'FAST' : w < 0.95 * job.target_g ? 'SLOW' : 'FINE'
        if (w >= this.stopAt) {
          this.weightAtStop = w
          return this.toSettle(700)
        }
      }
      if (this.phase === 'TRIM') {
        // one trim pulse of a few microsteps, then settle again
        this.feed(0.02 + Math.random() * 0.04)
        this.trims++
        return this.toSettle(450)
      }

      if (this.hopperPct() < 2) this.bridged = true
      // bridging: occasional, more likely when the hopper runs low
      if (!this.bridged && this.phase === 'FAST' && Math.random() < 0.002) this.bridged = true

      const fine = this.phase === 'FINE'
      const pulse = fine ? (Math.floor(this.tMs / 200) % 2 === 0 ? 2 : 0) : 1
      const rate = (RATE[this.phase] ?? 0) * pulse * (1 + 0.15 * gauss())
      if (!this.bridged) this.feed(Math.max(0, rate) * dt)

      // no-flow detection: weight must rise while the auger turns
      if (w > this.lastRiseW + 0.05) {
        this.lastRiseW = w
        this.lastRiseT = this.tMs
      }
      const stalled = this.tMs - this.lastRiseT
      // vibration only against bridging, always off in the fine phase
      this.vib = !fine && stalled > 600
      if (this.vib && this.bridged && this.hopperPct() >= 2 && Math.random() < 0.06) this.bridged = false
      if (stalled > 4000) return this.fail(this.hopperPct() < 5 ? 'HOPPER_EMPTY' : 'NO_FLOW')
      return
    }

    if (this.state === 'SETTLE' && this.tMs >= this.phaseUntil) {
      this.state = 'VERIFY'
      const m = this.landed
      if (this.trims === 0) this.measuredOvershoot = m - this.weightAtStop
      if (m < job.target_g - job.tol_g && this.trims < MAX_TRIMS) {
        this.state = 'DOSING'
        this.phase = 'TRIM'
        return
      }
      return this.finish()
    }
  }

  /** A believable human with a spatula: big scoops, then taps, sometimes over. */
  private tickManual() {
    const job = this.job!
    if (this.tMs < this.manualNextAt) return
    const remaining = job.target_g - this.landed
    let add: number
    let pause: number
    if (remaining > 2) {
      add = Math.min(remaining * (0.5 + Math.random() * 0.4), 3)
      pause = 1800 + Math.random() * 1500
    } else if (remaining > 0.25) {
      add = remaining * (0.4 + Math.random() * 0.9)
      pause = 2200 + Math.random() * 1800
    } else if (remaining > -job.tol_g) {
      // close enough: the operator stops (sometimes one tap too many)
      if (Math.random() < 0.3) {
        add = 0.05 + Math.random() * 0.25
        pause = 2500
      } else {
        return this.finish()
      }
    } else {
      // over target: operator scoops a bit back out
      add = remaining * (0.6 + Math.random() * 0.6)
      pause = 3000 + Math.random() * 1500
    }
    this.landed += add
    this.hopperG = Math.max(0, this.hopperG - Math.max(0, add))
    this.manualNextAt = this.tMs + pause
  }

  private feed(g: number) {
    const take = Math.min(g, this.hopperG)
    this.hopperG -= take
    this.inFlight += take
  }

  private toSettle(ms: number) {
    this.state = 'SETTLE'
    this.phase = 'SETTLE'
    this.vib = false
    this.phaseUntil = this.tMs + ms
  }

  private finish(error?: ErrorCode) {
    const job = this.job!
    const measured = round(this.landed + 0.01 * gauss(), 2)
    const dev = round(measured - job.target_g, 2)
    const ok = Math.abs(dev) <= job.tol_g + 1e-9
    const result: ResultEvt = {
      evt: 'result',
      run_id: `${job.sample_id}-${Date.now().toString(36).slice(-4).toUpperCase()}`,
      recipe_id: job.recipe_id,
      material_id: job.material_id,
      sample_id: job.sample_id,
      method: job.method,
      target_g: job.target_g,
      tol_g: job.tol_g,
      measured_g: measured,
      dev_g: dev,
      status: error ? 'INCOMPLETE' : ok ? 'ACCEPTED' : 'REJECTED',
      overshoot_g: round(this.measuredOvershoot, 3),
      trim_steps: this.trims,
      t_start: new Date(this.startedAt).toISOString(),
      t_end: new Date().toISOString(),
      duration_ms: Math.round(this.tMs),
      error,
    }
    this.state = error ? 'ERROR' : 'DONE'
    this.vib = false
    this.job = null
    this.events.emit(result)
    this.emitStatus()
  }

  private fail(code: ErrorCode) {
    this.events.emit({ evt: 'error', code, phase: this.phase, weight_g: round(this.reading()) })
    this.finish(code)
  }

  private hopperPct() {
    return (this.hopperG / HOPPER_CAPACITY_G) * 100
  }

  private reading() {
    if (!this.cup) return round(-12.4 + 0.02 * gauss()) // cup mass removed from a tared scale
    const motorNoise = this.state === 'DOSING' ? 0.03 : 0.008
    return this.landed + motorNoise * gauss()
  }

  private ack(cmd: Command['cmd'], ok: boolean, msg?: string) {
    this.events.emit({ evt: 'ack', cmd, ok, msg })
  }

  private emitStatus() {
    this.lastStatusEmit = performance.now()
    this.events.emit({
      evt: 'status',
      state: this.state,
      weight_g: round(this.reading()),
      cup: this.cup,
      hopper_ok: this.hopperPct() >= 5,
      hopper_pct: Math.round(this.hopperPct()),
      power_ok: this.power,
      tare_ok: this.cup && Math.abs(this.reading()) < 0.05 && !this.busy() ? true : this.busy(),
      stable: true,
      vib: this.vib,
      raw: Math.round(this.reading() * this.calFactor),
      cal_factor: round(this.calFactor, 3),
      calibrated: this.calFactor !== 420,
      calibrating: this.calibrating,
    })
  }
}
