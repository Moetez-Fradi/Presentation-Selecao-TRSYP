import type { MqttConfig } from './MqttStation'
import { randomToken } from './sign'

export interface Connection {
  transport: 'mock' | 'mqtt'
  mqtt: MqttConfig
}

export interface BrokerPreset {
  id: string
  label: string
  /** what the browser uses */
  ws: string
  /** what goes into the ESP32 secrets.h */
  device: string
}

/** Free, no-account public brokers. Both verified with the firmware's root CA bundle. */
export const PRESETS: BrokerPreset[] = [
  { id: 'hivemq', label: 'Free broker 1', ws: 'wss://broker.hivemq.com:8884/mqtt', device: 'mqtts://broker.hivemq.com:8883' },
  { id: 'emqx', label: 'Free broker 2', ws: 'wss://broker.emqx.io:8084/mqtt', device: 'mqtts://broker.emqx.io:8883' },
]

export const presetFor = (url: string) => PRESETS.find((p) => p.ws === url)

const KEY = 'ds.conn.v2'

// Broker and station ID may come from the Vercel env (not secret); the pairing key never does.
const defaults = (): Connection => ({
  transport: 'mock',
  mqtt: {
    url: import.meta.env.VITE_MQTT_URL ?? PRESETS[0].ws,
    username: import.meta.env.VITE_MQTT_USER ?? '',
    password: '',
    stationId: import.meta.env.VITE_STATION_ID ?? `ds-${randomToken(10)}`,
    pairKey: '',
  },
})

export function loadConnection(): Connection {
  const d = defaults()
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Connection | null
    if (saved) return { ...d, ...saved, mqtt: { ...d.mqtt, ...saved.mqtt } }
  } catch {
    /* fall through */
  }
  return d
}

export function saveConnection(c: Connection) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

/** Accepts "host", "host:port" or a full URL and returns a wss:// URL for browsers. */
export function normalizeUrl(input: string) {
  const s = input.trim()
  if (!s) return ''
  if (/^wss?:\/\//.test(s)) return s
  const host = s.replace(/^(mqtts?|https?):\/\//, '').replace(/\/.*$/, '')
  return `wss://${host.includes(':') ? host : `${host}:8884`}/mqtt`
}
