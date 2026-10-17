# Stepper setup and test

A standalone sketch to prove motor + driver + wiring **before** the station firmware uses them.
It doesn't touch `firmware/station`. Flashing it temporarily replaces the station firmware on the
ESP32; flash the station back afterwards (last section).

## 0. Three rules that save your driver
1. **Never plug or unplug the motor while the driver is powered.** It kills the driver instantly.
2. **The motor never runs from the ESP32.** It needs its own 12 V supply into the driver's motor input.
3. **Common ground:** the ESP32 GND and the driver's logic GND must be connected.

## 1. Which driver do you have?
| Looks like | Model | Wiring section |
|---|---|---|
| Small board (~15×20 mm), 2 rows of 8 pins, tiny screw potentiometer, often a heatsink | A4988 (green/red), DRV8825 (purple), TMC2208 | **2A** |
| Metal box with a heatsink, screw terminals, 6 DIP switches, labels PUL / DIR / ENA | TB6600 (or DM542) | **2B** |

## 2A. Small driver (A4988 / DRV8825 / TMC2208)
```
 Driver pin    ->  goes to
 ----------        ---------------------------------------------
 VMOT          ->  +12 V supply   (+ 100 µF capacitor VMOT-GND, close to the driver)
 GND (motor)   ->  12 V supply GND
 2B 2A 1A 1B   ->  motor coils (pair A on 1A/1B, pair B on 2A/2B, see step 3)
 VDD           ->  ESP32 3V3
 GND (logic)   ->  ESP32 GND   (and to the 12 V GND: common ground)
 STEP          ->  ESP32 GPIO 25
 DIR           ->  ESP32 GPIO 26
 EN            ->  ESP32 GPIO 27   (LOW = enabled)
 RST + SLP     ->  bridge them together (A4988/DRV8825), or both to 3V3
 MS1 MS2 MS3   ->  microstepping (table below)
```
Microstepping (then set `MICROSTEPS` in `src/main.cpp` to match):
| Driver | 16 microsteps |
|---|---|
| A4988 | MS1, MS2, MS3 all to 3V3 |
| DRV8825 | M0 = GND, M1 = GND, M2 = 3V3 |
| TMC2208 | MS1 = 3V3, MS2 = 3V3 |

## 2B. TB6600 box
```
 PUL+ DIR+ ENA+  ->  ESP32 3V3        (3.3 V is usually enough; if the motor ignores pulses, use 5 V)
 PUL-            ->  ESP32 GPIO 25 (STEP)
 DIR-            ->  ESP32 GPIO 26 (DIR)
 ENA-            ->  ESP32 GPIO 27 (EN, LOW = enabled)
 A+ A- B+ B-     ->  motor coil pairs (step 3)
 VCC / GND       ->  12 V supply
```
DIP switches: set **current** to about 1.0–1.5 A and **microsteps** to 16 (the table is printed on the box). Leave `MICROSTEPS = 16` in the code. If the motor won't enable, the TB6600 wiring is inverted: set `EN_ACTIVE_LOW = false`.

## 3. Find the coil pairs (no datasheet needed)
A NEMA 17 has 4 wires = 2 coils. With a multimeter on resistance: the two wires that show a few ohms (~1–4 Ω) are one coil. Or, with the motor unplugged, short two wires together and turn the shaft: if it gets **stiff**, those two are a pair.
Put one pair on 1A/1B (or A+/A−), the other on 2A/2B (or B+/B−). Swapping two pairs only reverses the direction; that's harmless.

## 4. Set the current limit (small drivers only)
With 12 V on and the motor connected but idle, measure the voltage between the **potentiometer's metal top** and **GND**. Turn it with a ceramic or plastic screwdriver.
| Driver | Vref for ~1.0 A (safe start for a NEMA 17) |
|---|---|
| A4988 (red/green clones, e.g. HW-134A): read the 2 tiny resistors next to the chip. R100 → **0.80 V**, R050 → **0.40 V**, R200 → **1.60 V** | see left |
| DRV8825 | **0.50 V** |
| TMC2208 | **1.40 V** |

If the motor is weak or skips under load, go up 10% at a time. If the driver gets too hot to touch, go down or add the heatsink.

## 5. Flash and test
1. Open `firmware/stepper_test` in VS Code PlatformIO (or ask Claude to flash it).
2. Your board needs manual download mode: **hold BOOT, tap EN, release BOOT**, then upload with the `esp32dev_manual` env. Press **EN** once afterwards.
3. Serial Monitor at **115200**. The help text appears. Then:
   - `e`: the motor should **lock** (hard to turn by hand). Nothing locks? The driver isn't enabled or has no 12 V.
   - `f`: one smooth turn. `b`: back.
   - `t`: self-test, ending in a speed ramp. **Write down the highest speed that stays smooth**; that's your FAST limit.

| Symptom | Fix |
|---|---|
| Buzzes or vibrates but doesn't turn | coil pairs mixed up (step 3), or speed too high (`v400`) |
| Turns, but skips/stalls at speed | raise the current a little, lower the speed, check 12 V |
| Nothing at all | 12 V missing, EN level (`e`), common GND, RST/SLP bridge |
| Turns the wrong way | fine: swap one coil pair, or flip DIR in the station firmware later |

## 6. Back to the station firmware
Once the stepper works, the station firmware takes over:
1. In `firmware/station/include/config.h`: `#define HAS_AUGER 1`.
2. In `firmware/station/src/actuators/auger.cpp`, set the step rates (`Fast` / `Slow` / `Fine`) from what the self-test showed was smooth.
3. Flash `firmware/station` again (same BOOT/EN steps). The dashboard and scale keep working exactly as before.
