// Fake ESP32 that speaks the real MQTT protocol, for end-to-end tests without hardware.
// Runs the same physics as the in-browser simulator.
//
//   MQTT_URL=mqtts://xxxx.s1.eu.hivemq.cloud:8883 MQTT_USER=esp32 MQTT_PASS=... node tools/mock-esp32.ts
//
// Optional: STATION_ID (default ds1), SPEED (default 1),
//           PAIR_KEY (verify signed commands, as the firmware does; required on public brokers).
// Type in the terminal while it runs:  c = toggle cup, p = toggle power, b = bridge, e = empty hopper, r = refill

import mqtt from 'mqtt'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { MockStation } from '../src/station/MockStation.ts'
import type { Command } from '../src/station/protocol.ts'

const url = process.env.MQTT_URL ?? 'mqtt://localhost:1883'
const id = process.env.STATION_ID ?? 'ds1'
const t = {
  cmd: `trsyp/${id}/cmd`,
  evt: `trsyp/${id}/evt`,
  status: `trsyp/${id}/status`,
  result: `trsyp/${id}/result`,
  online: `trsyp/${id}/online`,
}

const station = new MockStation()
station.speed = Number(process.env.SPEED ?? 1)

const client = mqtt.connect(url, {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  clientId: `mock-esp32-${id}-${Math.random().toString(16).slice(2, 6)}`,
  keepalive: 15,
  // same last-will the firmware uses: the dashboard sees us go offline
  will: { topic: t.online, payload: Buffer.from('false'), qos: 1, retain: true },
})

let lastPing = Date.now()
const WATCHDOG_MS = 5000

client.on('connect', () => {
  console.log(`[mock-esp32] connected to ${url} as station "${id}"`)
  client.publish(t.online, 'true', { qos: 1, retain: true })
  client.subscribe(t.cmd, { qos: 1 })
  station.connect()
})
client.on('error', (e) => console.error('[mock-esp32]', e.message))
client.on('close', () => console.log('[mock-esp32] disconnected'))

const pairKey = process.env.PAIR_KEY ?? ''
let lastTs = 0
const MAX_SKEW_MS = 30_000

/** Same rules as the firmware: valid HMAC, fresh timestamp, strictly newer than the last one. */
function verify(raw: string): Command | null {
  let msg: { p?: string; s?: string; cmd?: string }
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  if (!pairKey) return msg.p ? JSON.parse(msg.p) : (msg as Command)
  if (typeof msg.p !== 'string' || typeof msg.s !== 'string') return reject('unsigned')
  const want = createHmac('sha256', pairKey).update(msg.p).digest()
  const got = Buffer.from(msg.s, 'hex')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return reject('bad signature')
  const c = JSON.parse(msg.p) as Command & { ts: number }
  if (!(c.ts > lastTs) || Math.abs(c.ts - Date.now()) > MAX_SKEW_MS) return reject('stale/replayed')
  lastTs = c.ts
  return c
}
function reject(why: string) {
  console.warn(`[mock-esp32] rejected command: ${why}`)
  return null
}

client.on('message', (_topic, payload) => {
  const c = verify(payload.toString())
  if (!c) return
  if (c.cmd === 'ping') lastPing = Date.now()
  else console.log('→', payload.toString())
  station.send(c)
})

let busy = false
station.onEvent((e) => {
  const json = JSON.stringify(e)
  if (e.evt === 'status') {
    busy = ['DOSING', 'SETTLE', 'VERIFY', 'MANUAL'].includes(e.state)
    client.publish(t.status, json, { qos: 0, retain: true })
  } else if (e.evt === 'result') {
    console.log('←', json)
    // retained: a dashboard that was away when the dose ended still gets it
    client.publish(t.result, json, { qos: 1, retain: true })
  } else {
    if (e.evt !== 'dose') console.log('←', json)
    client.publish(t.evt, json, { qos: 0 })
  }
})

// safety: the real firmware stops the motor if the dashboard goes silent mid-dose
setInterval(() => {
  if (busy && Date.now() - lastPing > WATCHDOG_MS) {
    console.log('[mock-esp32] no ping for 5 s during a dose → stop')
    station.send({ cmd: 'stop' })
  }
}, 500)

process.stdin.setEncoding('utf8')
process.stdin.on('data', (d: string) => {
  const k = d.trim()
  if (k === 'c') station.cup = !station.cup
  if (k === 'p') station.power = !station.power
  if (k === 'b') station.bridge()
  if (k === 'e') station.hopperG = 3
  if (k === 'r') station.refill()
  console.log(`[sim] cup=${station.cup} power=${station.power} hopper=${station.hopperG.toFixed(0)} g`)
})

const bye = () => {
  client.publish(t.online, 'false', { qos: 1, retain: true }, () => process.exit(0))
}
process.on('SIGINT', bye)
process.on('SIGTERM', bye)
