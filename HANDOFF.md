# Handoff prompt (paste into a new conversation)

We're a finalist team at the TRSYP 3.0 "Laboratory 4.0" makeathon (Axis 2: Automated Weighing & Dosing Station), building today (16 Oct 2026), pitching tomorrow morning. The project is in `C:\Users\Moetez\Desktop\TRSYP`. Read `PLAN.md`, `MQTT_SETUP.md` and `firmware/station/README.md` first. The spec book, concept dossier and software brief PDFs are in the root.

## What matters for scoring (final 70%)
Working demo running a real recipe 30% · measured gain vs manual 15% · technical depth (sensing, closed loop, verification, logging) 15% · CAD/detailing 15% · reuse in a real lab 10% · pitch 15%. The panel wants the full loop: recipe in → physical action → monitoring → verification → digital record.

## Architecture (built and working on real hardware)
```
ESP32 ──phone hotspot, mqtts:8883──► free public broker broker.hivemq.com ◄──wss:8884── dashboard (browser/phone)
```
- No account or card is needed (the user has no card). Backup broker: broker.emqx.io (built in).
- Public broker, so: random station ID, and every command is **HMAC-SHA256 signed** with a pairing key shared by the dashboard and `secrets.h`. The ESP32 rejects unsigned, forged and replayed commands (tested).
- Topics `trsyp/<STATION_ID>/{cmd,evt,status,result,online}`. JSON protocol in `dashboard/src/station/protocol.ts`.

## Dashboard (`dashboard/`, Vite + React + TS, Vercel/Geist-style dark UI, mobile-first)
- Run with `npm run dev` (port 5173; launch config in `.claude/launch.json`).
- Views: Run (recipe, checklist, live weight, phase chart, verification record), History (CSV export), Stats (auto vs manual comparison, overshoot learning), Log.
- Transports: in-browser simulator (`MockStation.ts`) and `MqttStation.ts`. Connection settings come from the top-right pill. `tools/mock-esp32.ts` is a Node fake ESP32 over MQTT.
- A 3D twin of the station from the CAD files was added in a forked session (PC only; `public/models`).
- Recently fixed: overshoot learning ignores impossible values (negative or > min(1 g, 20% of target)), and the chart resets when a dose starts from another device.
- Not deployed to Vercel yet.

## Firmware (`firmware/station/`, PlatformIO, Arduino core 2.0.17)
- Modular: `src/net/` (Wi-Fi + esp-mqtt over TLS + signed commands + USB serial; QoS 0 goes through a publisher task), `src/sensors/` (`scale` = HX711 + WeightFilter; `inputs` = cup/hopper/12 V stubs), `src/actuators/` (`auger` stepper + `vibrator`), `src/control/doser` (weight-driven state machine: CHECKS/auto-tare → FAST/SLOW/FINE → SETTLE → TRIM → verify → result).
- `include/config.h`: `HAS_*` flags, pins, calibration, tuning. `include/secrets.h`: Wi-Fi, broker, station ID, pairing key (git-ignored, already filled; never print it).
- Build: `~/.platformio/penv/Scripts/pio.exe run -e esp32dev` (pio is not on PATH). The board is on **COM8** and has **no working auto-reset**. To flash, start esptool waiting (`--before no_reset --connect-attempts 0`, see the binaries in `.pio/build/esp32dev`) and ask the user to hold BOOT, tap EN, release BOOT. Serial at 115200 (use pyserial from the pio python with dtr/rts False).
- Scale calibration is a fixed placeholder: `SCALE_RAW_PER_GRAM = 420`. A "calibrate with known mass" dashboard flow was proposed but not built.
- The overshoot clamp (`MAX_OVERSHOOT_G`) is in the source. Check it's in the flashed build.

## Pins in use / reserved (keep every module on its own pins)
| Pin | Use |
|---|---|
Full map with power wiring: `firmware/station/WIRING.md`.

| Pin | Use |
|---|---|
| 32 / 33 | HX711 DT / SCK (wired) |
| 13 | vibrator via NPN/MOSFET (moved from 14) |
| 25 / 26 / 27 | stepper STEP/DIR/EN |
| 14 / 4 | ultrasonic HC-SR04 TRIG / ECHO (ECHO through a 1k/2k divider) |
| 34 / 35 | cup IR / 12 V sense (input-only) |
| 21 / 22 | I2C for the LCD (the VL53L0X was replaced by the ultrasonic) |
| 18 / 19 / 23, 39 | RGB LED, TARE button (optional) |

Avoid 0, 2, 5, 12, 15 (strapping), 6–11 (flash), 1/3 (USB serial).

## Current state / open issues
- A forked session added a bench test: `VIBRATOR_TEST_MS 1000` in `config.h` toggles the vibrator pin (now G13) every second from `vibrator::update()` (compile-time, not on command). It reported that **the HX711 was reading `raw: 0`**. That means only zeros from the HX711: likely a loose DT wire (G32) or lost VCC. Check the wiring before trusting weights.
- Earlier, "noisy" weights turned out to be the scale being handled. Finger tests in Auto fail by design (±0.1 g tolerance, nothing is ever removed). Use Manual mode for human dosing.

## Next objectives
1. **Vibrator on command**: replace the compile-time `VIBRATOR_TEST_MS` with a signed dashboard command (e.g. `{"cmd":"vib","mode":"pulse","on_ms":1000,"off_ms":1000}` / `"off"`). Add a control in the dashboard. Keep the MQTT link and the weight sensor code intact. Report vibrator state in `status`, and make it stop automatically on link loss.
2. **Ultrasonic sensor (later)**: a new `src/sensors/ultrasonic` module behind `HAS_ULTRASONIC`, on its own pins (13/36 suggested), non-blocking (no `pulseIn` stalls in the main loop), with its reading in `status`.
3. Afterwards: real scale calibration flow, LittleFS run log, deploy the dashboard to Vercel.
