# Station wiring: pin to pin

Matches `include/config.h`. "GND" always means the **one common ground**: the ESP32 GND, the 12 V supply's −, the buck converter's −, and every module's GND all tied together.

## 0. Power (wire this first, with nothing else connected)

| From | To |
|---|---|
| 12 V supply + | buck converter IN+ |
| 12 V supply − | buck converter IN− (= GND) |
| buck converter OUT+ (**set it to 5.0 V with a multimeter before connecting anything**) | ESP32 **VIN** (labelled 5V or VIN) |
| buck converter OUT− | ESP32 **GND** |

When debugging, the USB cable can stay plugged in at the same time.

## 1. HX711 + load cell (already wired)

| HX711 pin | ESP32 pin |
|---|---|
| VCC | 3V3 |
| GND | GND |
| DT (DOUT) | **G32** |
| SCK (PD_SCK) | **G33** |

| Load cell wire (usual colours) | HX711 pin |
|---|---|
| Red | E+ |
| Black | E− |
| White | A− |
| Green | A+ |

If the weight goes negative when you press the cell, swap White and Green. If `raw` reads 0, check DT on G32 and VCC first.

## 2. Stepper driver (A4988) + NEMA 17, as wired by the team

Matches the working bench test `firmware/bench_tests/stepper_a4988` and `AUGER_*` in `config.h`.

| A4988 pin | Goes to |
|---|---|
| STEP | **G25** |
| DIR | **G26** (HIGH = feed direction, `AUGER_FEED_DIR`; flip in `config.h` if the auger pushes backwards) |
| EN | **G27**: **LOW = driver on**, HIGH = off (motor free, no holding current) |
| VDD | ESP32 3V3 |
| GND (logic) | ESP32 GND |
| VMOT | motor supply + (12 V) |
| GND (next to VMOT) | motor supply − = common GND |
| 100 µF capacitor | across VMOT and GND, right at the driver (long leg / + on VMOT) |
| RST | bridged to SLP |
| 1A / 1B | motor coil A (the 2 wires with a few ohms between them) |
| 2A / 2B | motor coil B |

**Microstepping:** the working test turns one revolution in **400 steps**. On a standard 1.8° NEMA 17 that is **half step**: MS1 → 3V3, MS2 and MS3 left unconnected (they have internal pull-downs). If yours are wired differently, the revolution count changes and the `AUGER_*_SPS` speeds in `config.h` must be rescaled. *To confirm on the board.*

Recommended, not in the bench build: a 10 kΩ pull-up from G27 to 3V3, so the driver stays off while the ESP32 boots. Set the current limit before connecting the motor (see `firmware/stepper_test/README.md`). Never unplug the motor while its supply is on.

## 3. Vibrator through a relay module, as wired by the team

Matches the working bench test `firmware/bench_tests/vibrator_relay`. The relay is **active LOW** (`VIBRATOR_ACTIVE_LOW 1` in `config.h`): G13 LOW = motor ON, HIGH = OFF.

| From | To |
|---|---|
| ESP32 **G13** | relay module **IN1** |
| ESP32 **5V / VIN** | relay module **VCC** (5 V coil: on 3.3 V the LED lights but the relay doesn't click) |
| ESP32 GND | relay module **GND** |
| motor supply + (ESP32 5V / VIN) | relay **COM** |
| relay **NO** (normally open) | vibrator motor **+** |
| vibrator motor **−** | motor supply − (= ESP32 GND, common ground) |

Using NO means the motor is off whenever the relay is unpowered or the ESP32 is resetting.

*Alternative without a relay (transistor, active HIGH: set `VIBRATOR_ACTIVE_LOW 0`):* G13 → 1 kΩ → NPN base (2N2222 / BC547), emitter → GND, collector → motor −, motor + → 5 V, flyback diode across the motor (stripe on motor +).

## 4. Ultrasonic HC-SR04 (on top of the hopper, pointing down at the sugar)

**As built:** sensor on **5 V** (a plain HC-SR04 fires but never hears its echo on 3.3 V), ECHO brought down to ~3.3 V by a voltage divider.

| Sensor pin | Goes to |
|---|---|
| VCC | **5V / VIN** |
| GND | GND |
| TRIG | **G14** (direct: 3.3 V triggers it) |
| ECHO | **1 kΩ → G4**, and **2 kΩ from G4 to GND** (G4 sits between the two resistors) |

Any R1 (ECHO side) / R2 (GND side) pair with R2 ≈ 2 × R1 works (e.g. 2.2k/4.7k, 4.7k/10k): G4 = 5 V × R2 / (R1 + R2) must stay between ~2.6 and 3.5 V. **Never ECHO from a 5 V sensor straight into G4.** (An HC-SR04P / RCWL-1601 runs on 3V3 with ECHO direct.)

Verified: 146 mm, steady, facing a book. Calibrate the level on the dashboard: Control > Hopper level > *Set empty* / *Set full*.

## 5. Cup presence IR sensor (FC-51 style, 3 pins)

| IR module pin | ESP32 pin |
|---|---|
| VCC | 3V3 |
| GND | GND |
| OUT | **G34** (LOW = cup present) |

## 6. LCD 16x2 / 20x4 with I2C backpack (PCF8574)

| Backpack pin | Goes to |
|---|---|
| VCC | 5 V (buck OUT+) |
| GND | GND |
| SDA | **G21** |
| SCL | **G22** |

Address is 0x27 or 0x3F. If the screen is lit but blank, turn the contrast potentiometer on the backpack.

## 7. 12 V present sense (2 resistors)

| From | To |
|---|---|
| 12 V supply + | 10 kΩ resistor → **G35** |
| G35 | 3.3 kΩ resistor → GND |

That gives about 3.0 V on G35 when 12 V is on.

## 8. TARE push button + status LED

| From | To |
|---|---|
| button leg 1 | **G16** |
| button leg 2 | GND (no resistor: the internal pull-up is used) |
| **G18** | 220 Ω resistor → LED **long leg** (anode) |
| LED **short leg** (cathode) | GND |

**No resistor?** Wire G18 straight to the LED long leg (short leg → GND) and keep `LED_NO_RESISTOR 1` in `config.h`: the pin runs at its weakest drive strength and the LED is PWM-dimmed. Set it to 0 once a 150 Ω – 1 kΩ resistor is in.

The button tares the scale (ignored during a dose). The LED blinks 3× at boot, 2 slow blinks when a dose is Accepted, 5 fast blinks when it is Rejected or failed.

## ESP32 pin summary

| ESP32 pin | Connected to |
|---|---|
| VIN | buck OUT+ (5 V) |
| GND | common ground |
| 3V3 | HX711 VCC, IR VCC, A4988 VDD, EN pull-up |
| 5V / VIN | relay module VCC (5 V coil), relay COM (vibrator supply), ultrasonic VCC |
| G4 | ultrasonic ECHO (via the 1k/2k divider) |
| G13 | vibrator relay IN1 (active LOW) |
| G14 | HC-SR04 TRIG |
| G16 | TARE push button (to GND) |
| G18 | status LED (via 220 Ω) |
| G21 / G22 | LCD SDA / SCL |
| G25 / G26 / G27 | stepper STEP / DIR / EN |
| G32 / G33 | HX711 DT / SCK |
| G34 | cup IR OUT |
| G35 | 12 V sense divider |
| free | G17, G19, G23, G39 |

Never use: G0, G2, G5, G12, G15 (boot pins), G6–G11 (flash), G1/G3 (USB serial). G34, G35, G36 and G39 are inputs only.
Keep the load-cell and HX711 wires short and away from the stepper wires.
