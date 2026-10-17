# MQTT setup (free, no account, ≈10 min)

We use a **free public broker** (no sign-up, no card): `broker.hivemq.com`, with `broker.emqx.io` as backup.
Public means anyone can publish to any topic, so:
- the **station ID** is random (hard to guess), and
- every command is **signed** with a **pairing key** shared by the phone and the ESP32. The key never travels over the network; the ESP32 ignores unsigned, forged or replayed commands (tested).

Status and results are readable by anyone who finds the topic. That's fine: it's powder weights.

## 1. Dashboard (on each phone/laptop)
1. Tap the connection pill (top right) → **Station (MQTT)** → **Free broker 1**.
2. Keep the generated **station ID**, tap **generate** for a pairing key.
3. Tap **copy** on the `secrets.h` block (send it to whoever flashes the ESP32), then **Save & connect**.
4. On the other phones: same broker, **same station ID and pairing key** (type them in).

## 2. ESP32
1. Arduino IDE → Boards Manager: **esp32 by Espressif 3.x**. Library Manager: **ArduinoJson 7**.
2. In `firmware/mqtt_link_test/`, create `secrets.h` from `secrets.h.example`: paste the block copied from the dashboard and add the hotspot SSID and password.
3. Phone hotspot on **2.4 GHz** (ESP32 has no 5 GHz). On iPhone, enable *Maximize Compatibility*.
4. Flash `mqtt_link_test.ino`, then Serial Monitor at 115200. Expect `wifi connected` → `mqtt connected`.
5. The dashboard pill turns green, "Station online". Start a dose. Press BOOT to fake a cup removal.

## 3. Test without hardware (laptop as a fake ESP32)
```bash
cd dashboard
MQTT_URL=mqtts://broker.hivemq.com:8883 STATION_ID=<id> PAIR_KEY=<key> npm run mock-esp32
```
While it runs, type `c` + Enter to lift the cup, `b` for bridging, `e` for empty hopper, `r` to refill. (Use Git Bash; in PowerShell set the variables with `$env:NAME="..."` first.)

## 4. Integrating into the real firmware
Copy `ds_net.h`, `ds_net.cpp`, `root_cas.h` and `secrets.h` next to the real sketch, then:
- `setup()`: `dsnet::begin()`
- `loop()`: `if (dsnet::nextCommand(cmd)) handle(cmd);` (MQTT and USB serial both arrive here)
- publish with `dsnet::publishStatus` / `publishEvent` / `publishResult`, exactly like `mqtt_link_test.ino`
- during a dose: `if (dsnet::msSincePing() > 5000) fail("LINK_LOST")` (motor off)
- write each result to LittleFS **before** `publishResult`
- implement `method:"manual"`: stream the weight, keep the motor locked, finish on `{"cmd":"done"}`

## Switching broker
If Free broker 1 is down, pick **Free broker 2** on every phone and set `MQTT_URI "mqtts://broker.emqx.io:8883"` in `secrets.h`. The firmware already trusts both (`root_cas.h`).

## Troubleshooting
| Symptom | Cause |
|---|---|
| Pill shows "Broker down" | no internet on the phone, or the broker is down (switch broker) |
| Pill shows "ESP32 offline" | ESP32 not on the hotspot, or a different station ID / broker |
| ESP32 serial shows `rejected: bad signature` | pairing key differs between the phone and `secrets.h` |
| ESP32 serial shows `rejected: stale or replayed` | phone clock is off by more than 30 s, or the ESP32 had no NTP yet |
| ESP32 serial shows `tls_error` | wrong port (must be 8883) |
| ESP32 never joins Wi-Fi | hotspot on 5 GHz, or an SSID/password typo |
