// Command signing for public brokers: anyone can publish to a public topic, so the ESP32
// only obeys messages signed with the pairing key it shares with the dashboard.
//
// Wire format on trsyp/<id>/cmd:  {"p":"<command JSON incl. ts>","s":"<hex HMAC-SHA256(key, p)>"}
// The key itself never leaves the device. "ts" (ms since epoch, strictly increasing) blocks replays.

const enc = new TextEncoder()
const keyCache = new Map<string, Promise<CryptoKey>>()

function hmacKey(secret: string) {
  let k = keyCache.get(secret)
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    keyCache.set(secret, k)
  }
  return k
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function signCommand(cmd: object, secret: string, ts: number) {
  const p = JSON.stringify({ ...cmd, ts })
  const s = hex(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(p)))
  return JSON.stringify({ p, s })
}

/** Random URL-safe token, e.g. for station IDs and pairing keys. */
export function randomToken(len = 16) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return [...bytes].map((b) => abc[b % abc.length]).join('')
}
