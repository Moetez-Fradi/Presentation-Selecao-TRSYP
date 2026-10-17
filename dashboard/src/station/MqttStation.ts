import mqtt, { type MqttClient } from 'mqtt'
import { Emitter, type LinkState, type Station } from './Station.ts'
import type { Command, StationEvent } from './protocol.ts'
import { signCommand } from './sign.ts'

export interface MqttConfig {
  /** e.g. wss://xxxx.s1.eu.hivemq.cloud:8884/mqtt */
  url: string
  username: string
  password: string
  /** topic namespace: trsyp/<stationId>/... */
  stationId: string
  /** Shared with the ESP32 (secrets.h PAIR_KEY). Empty = send unsigned commands. */
  pairKey: string
}

export const topics = (id: string) => ({
  cmd: `trsyp/${id}/cmd`,
  evt: `trsyp/${id}/evt`,
  status: `trsyp/${id}/status`,
  result: `trsyp/${id}/result`,
  online: `trsyp/${id}/online`,
})

/**
 * Talks to the real ESP32 through an MQTT broker over secure WebSockets.
 * Link is "online" only when the broker is reachable AND the ESP32 reports itself
 * online (its retained LWT topic), so the checklist reflects the machine, not the cloud.
 */
export class MqttStation implements Station {
  readonly kind = 'mqtt' as const
  private events = new Emitter<StationEvent>()
  private links = new Emitter<LinkState>()
  private client: MqttClient | null = null
  private t: ReturnType<typeof topics>
  private brokerUp = false
  private espOnline = false
  private seenResults = new Set<string>()
  private cfg: MqttConfig
  private lastTs = 0
  private outbox: Promise<void> = Promise.resolve()

  constructor(cfg: MqttConfig) {
    this.cfg = cfg
    this.t = topics(cfg.stationId)
  }

  connect() {
    this.links.emit('connecting')
    const c = mqtt.connect(this.cfg.url, {
      username: this.cfg.username || undefined,
      password: this.cfg.password || undefined,
      clientId: `dash-${Math.random().toString(16).slice(2, 10)}`,
      keepalive: 15,
      reconnectPeriod: 2000,
      connectTimeout: 8000,
      clean: true,
    })
    this.client = c

    c.on('connect', () => {
      this.brokerUp = true
      c.subscribe([this.t.evt, this.t.status, this.t.result, this.t.online], { qos: 1 })
      this.emitLink()
      this.send({ cmd: 'status' })
    })
    c.on('reconnect', () => this.links.emit('connecting'))
    c.on('close', () => {
      this.brokerUp = false
      this.emitLink()
    })
    c.on('error', (err) => console.warn('[mqtt]', err.message))
    c.on('message', (topic, payload) => {
      const text = payload.toString()
      if (topic === this.t.online) {
        this.espOnline = text === 'true' || text === '1'
        return this.emitLink()
      }
      let msg: StationEvent
      try {
        msg = JSON.parse(text)
      } catch {
        return console.warn('[mqtt] bad JSON on', topic, text)
      }
      // QoS 1 is at-least-once: drop duplicate results
      if (msg.evt === 'result') {
        if (this.seenResults.has(msg.run_id)) return
        this.seenResults.add(msg.run_id)
      }
      // any traffic from the ESP32 proves it is alive, even if the retained flag is stale
      if (!this.espOnline) {
        this.espOnline = true
        this.emitLink()
      }
      this.events.emit(msg)
    })
  }

  disconnect() {
    this.client?.end(true)
    this.client = null
    this.brokerUp = false
    this.links.emit('disconnected')
  }

  send(cmd: Command) {
    if (!this.client?.connected) return
    // strictly increasing timestamps: the ESP32 rejects anything not newer than the last one
    const ts = Math.max(Date.now(), this.lastTs + 1)
    this.lastTs = ts
    const key = this.cfg.pairKey
    // chained so signed messages leave in the order they were sent
    this.outbox = this.outbox
      .then(async () => {
        const payload = key ? await signCommand(cmd, key, ts) : JSON.stringify(cmd)
        // pings are fire-and-forget; real commands must arrive
        this.client?.publish(this.t.cmd, payload, { qos: cmd.cmd === 'ping' ? 0 : 1 })
      })
      .catch((e) => console.warn('[mqtt] send failed', e))
  }

  onEvent(fn: (e: StationEvent) => void) {
    return this.events.on(fn)
  }
  onLink(fn: (s: LinkState) => void) {
    return this.links.on(fn)
  }

  private emitLink() {
    this.links.emit(!this.brokerUp ? 'disconnected' : this.espOnline ? 'online' : 'offline')
  }
}
