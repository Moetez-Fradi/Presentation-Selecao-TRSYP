# Dosing Station — Communication + Dashboard Plan

```
ESP32 ──(phone hotspot, mqtts:8883)──► free public MQTT broker (broker.hivemq.com) ◄──(wss:8884)── Dashboard (Vercel, phone browser)
```
Why a broker: a Vercel page is HTTPS and cannot open connections to the ESP32's local IP (mixed content). Both sides meet at a TLS broker instead.

## 1. Broker
- Free public broker, no account: `broker.hivemq.com` (backup `broker.emqx.io`). See MQTT_SETUP.md.
- Random station ID + HMAC-signed commands (pairing key shared by phone and ESP32), so strangers can't drive the motor.

## 2. Topics (`trsyp/ds1/...`)
| Topic | Direction | Content |
|---|---|---|
| `cmd` | PC → ESP32 | `start`, `stop`, `tare`, `status`, `ping`, `manual`, `history` |
| `evt` | ESP32 → PC | `dose` (every 100–200 ms), `error`, `ack` |
| `status` | ESP32 → PC, **retained** | state, weight, cup, hopper, power, tare (2 Hz when idle) |
| `result` | ESP32 → PC, QoS 1 | one verification record per dose |
| `online` | ESP32 LWT, retained | `true` / `false` |

Same JSON as the software brief, plus: `ping` heartbeat, `ack`, `stop_at_g` / `vib` in `dose`, `overshoot_g` / `g_per_step` echoed in `result`, `method: auto|manual`.

## 3. Firmware networking (ESP32)
1. Wi-Fi to the hotspot, auto-reconnect; LCD shows Wi-Fi + broker state.
2. MQTT over TLS (`PubSubClient` + `WiFiClientSecure`), LWT on `online`.
3. Safety: no `ping` for 5 s during a dose → motor off, `ABORTED`. The ESP32 never depends on the network to stay safe.
4. Log of record: every result appended to LittleFS (`/log.jsonl`) **before** publishing; `history` command replays it.
5. Learned overshoot stored in NVS (survives resets).

## 4. Dashboard (Vite + React + TS, deployed on Vercel)
1. Geist-style UI, mobile-first (phone is the main controller), readable on a projector.
2. Views: **Run** (recipe, sample ID, checklist, START/STOP, live weight + phase chart, result card), **History** (all runs, CSV export), **Stats** (10-run repeatability, auto vs manual), **Log** (raw event stream).
3. Transport layer behind one interface: `MockStation` (in-browser simulator) and `MqttStation` (mqtt.js over wss). UI is built and tested against the mock first.
4. Runs cached in IndexedDB; ESP32 LittleFS remains the source of truth.
5. Reserved slot for the 3D twin (`StationTwin` component), filled later from the CAD files.

## 5. Order of work
1. UI + mock station ← **now**
2. Broker setup + `MqttStation` + a Node mock ESP32 publishing to the broker (end-to-end test without hardware)
3. Firmware MQTT layer on the real ESP32
4. Log 10 auto + 10 manual runs for the stats before the pitch
5. Deploy on Vercel, add to the phone home screen
