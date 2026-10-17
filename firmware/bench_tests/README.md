# Bench tests

Small standalone sketches that prove one part works on its own. Flash one, check the part, then go back to `../station`.

| Folder | Part | Wiring |
|---|---|---|
| `vibrator_relay/` | vibration motor via relay module (IN1 on G13, **active LOW**) | in the sketch header |
| `stepper_a4988/` | NEMA 17 + A4988 (STEP G25, DIR G26, EN G27), 1 rev each way | see `../station/WIRING.md` §2 |
| `../stepper_test/` | stepper with current-limit setup notes | its README |

The station firmware (`../station`) uses the same pins and polarities. See `HAS_*` and pins in `../station/include/config.h`.
