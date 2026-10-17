# Station firmware (PlatformIO)

```
WIRING.md             pin map + power wiring for every part
include/config.h      which parts are fitted (HAS_*), pins, calibration, dosing tuning
include/secrets.h     Wi-Fi + broker + station ID + pairing key (git-ignored)
src/main.cpp          wires the modules together
src/net/              dashboard link: Wi-Fi, MQTT over TLS, signed commands, USB serial
src/sensors/          scale (HX711 + WeightFilter), cup / hopper / 12 V inputs
src/actuators/        auger stepper, vibrator
src/control/          dosing state machine + protocol
```

## Adding a part
1. Wire it and set its pin in `config.h`.
2. Set its `HAS_*` flag to `1`; the matching module in `sensors/` or `actuators/` already has the code path (fill in the TODOs).
3. Nothing else changes: the controller only talks to module interfaces.

## Now: scale only
- `SCALE_RAW_PER_GRAM` in `config.h` is a **fixed placeholder**. Weights are off by a constant factor until it's calibrated.
- With `HAS_AUGER 0`, **Auto** mode works by hand: pour onto the scale and the phase follows the real weight (FAST → SLOW → FINE → settle → verify). **Manual** mode works as-is.
- The dashboard's Station card shows `raw`, `stable` and the load cell state for debugging.

Calibrating later: tare empty, put a known mass M (g) on, read `raw` on the Station card (or the serial status line), and set `SCALE_RAW_PER_GRAM = (raw_loaded - raw_empty) / M`.

## Build and flash
VS Code PlatformIO: open this folder, then Upload and Monitor. Or from the command line:
```bash
pio run -t upload && pio device monitor
```
