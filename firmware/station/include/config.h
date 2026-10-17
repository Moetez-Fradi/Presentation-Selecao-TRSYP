#pragma once
// Station configuration: pins, which modules are fitted, calibration, and dosing tuning.
// Set a HAS_* flag to 1 once that part is wired; its module then uses the real hardware.

// ---- modules fitted ---------------------------------------------------------
#define HAS_AUGER        1   // stepper driver (A4988) + NEMA 17 on the auger
#define HAS_VIBRATOR     1   // vibration motor (relay module on G13, see VIBRATOR_ACTIVE_LOW)
#define HAS_CUP_SENSOR   1   // IR presence sensor (FC-51) aimed at the cup, OUT on G34
#define HAS_ULTRASONIC   1   // HC-SR04 on top of the hopper: VCC 5V, ECHO via 1k/2k divider to G4
#define HAS_POWER_SENSE  0   // 12 V sense divider
#define HAS_TARE_BUTTON  1   // push button G16 -> GND (internal pull-up)
#define HAS_LED          1   // single status LED on G18 (220 ohm to GND)
#define HAS_LCD          1   // character LCD on an I2C backpack (PCF8574)

// LCD bench test: play the timed lines in src/ui/song.h once after boot. 0 = off.
#define LCD_SONG_TEST    0

// Bench test: toggle the vibrator pin every N ms (1 s HIGH, 1 s LOW). 0 = off, normal use.
#define VIBRATOR_TEST_MS 0
constexpr uint32_t VIB_MAX_MS = 60000;  // longest manual vibrator run from the dashboard
// 1 = the dosing loop turns the vibrator on by itself when the flow stalls (anti-bridging).
// 0 = only by hand from the dashboard ("Shake hopper"); a stall ends the dose with NO_FLOW.
#define AUTO_VIBRATE 0

// ---- pins -------------------------------------------------------------------
// Full wiring map: WIRING.md. GPIO 34-39 are input-only: never use them for outputs.
// Avoid 0, 2, 5, 12, 15 (boot straps), 6-11 (flash), 1/3 (USB serial).
// HX711: VCC -> 3V3, GND -> GND, DT -> G32, SCK -> G33 (as wired in esp32-hello)
constexpr int PIN_HX711_DT = 32;
constexpr int PIN_HX711_SCK = 33;
constexpr int PIN_STEP = 25, PIN_DIR = 26, PIN_EN = 27;  // stepper driver (EN LOW = on)
constexpr int PIN_VIBRATOR = 13;    // relay IN1 (or NPN/MOSFET), never the motor straight on the pin
// Relay modules switch ON when IN is LOW (teammate's working setup). 0 for a transistor/MOSFET.
#define VIBRATOR_ACTIVE_LOW 1
constexpr int PIN_US_TRIG = 14;     // HC-SR04 TRIG (G14 pulses at boot: harmless here)
constexpr int PIN_US_ECHO = 4;      // HC-SR04 ECHO via 1k/2k divider (sensor on 5 V)
constexpr int HOPPER_MIN_PCT = 5;
// Hopper level mapping (measured on the station): distance from the sensor to the sugar.
// Used unless a valid empty/full pair was saved from the dashboard (Control > Hopper level).
constexpr float HOPPER_EMPTY_MM = 145;  // 0 %
constexpr float HOPPER_FULL_MM = 0;     // 100 %
constexpr float HOPPER_CAL_MAX_SPREAD_MM = 15;  // refuse Set empty/full if readings wander more   // below this the hopper check fails (once empty/full are calibrated)
constexpr int PIN_I2C_SDA = 21, PIN_I2C_SCL = 22;  // LCD 1602/2004 PCF8574 backpack
constexpr int LCD_COLS = 16, LCD_ROWS = 2;          // 20, 4 for a 2004 screen
constexpr int PIN_CUP_IR = 34;      // LOW = cup present
constexpr uint32_t CUP_DEBOUNCE_MS = 250;  // IR level must hold this long to count
constexpr int PIN_POWER_SENSE = 35; // HIGH = 12 V on (10k/3k3 divider from 12 V)
constexpr int PIN_TARE_BTN = 16;    // LOW = pressed, button to GND, internal pull-up
constexpr int PIN_LED = 18;         // status LED: G18 -> 220 ohm -> LED -> GND
// 1 = LED wired straight to G18 with no resistor: the pin is set to its weakest drive
// strength and the LED is PWM-dimmed so neither the LED nor the pin is overdriven.
#define LED_NO_RESISTOR 1

// ---- auger stepper (A4988) --------------------------------------------------
// 400 steps/rev = 200-step motor at 1/2 microstepping (teammate's bench test).
// Rates in steps/s; the bench test ran 500 steps/s reliably. Tune on powder.
constexpr uint32_t AUGER_FAST_SPS = 500;
constexpr uint32_t AUGER_SLOW_SPS = 250;
constexpr uint32_t AUGER_FINE_SPS = 80;
constexpr int AUGER_TRIM_STEPS = 2;        // one trim pulse: 1-3 microsteps, then measure
constexpr int AUGER_REVERSE_STEPS = 8;     // after a stop, to cut the powder column
#define AUGER_FEED_DIR HIGH                // flip to LOW if the auger pushes powder backwards

// ---- scale calibration ------------------------------------------------------
// Default raw HX711 units per gram, used until a calibration is saved in flash
// (dashboard: Station card > Calibrate, or the "calibrate" command).
constexpr float SCALE_RAW_PER_GRAM = 235.9f;   // measured 2026-10-17 with the 46.74 g cup
constexpr int SCALE_CAL_SAMPLES = 20;      // ~2 s average with the known mass on
constexpr int SCALE_TARE_SAMPLES = 10;     // ~1 s at the HX711's 10 samples/s
constexpr float TARE_OK_BAND_G = 0.3f;     // |weight| below this after tare = tared

// ---- dosing (weight-driven, never timed) ------------------------------------
constexpr float FAST_UNTIL = 0.75f;        // of target
constexpr float SLOW_UNTIL = 0.95f;        // of target, then FINE until the stop threshold
constexpr uint32_t SETTLE_MIN_MS = 500;    // wait at least this after stopping...
constexpr uint32_t SETTLE_MAX_MS = 2500;   // ...until the scale is stable, at most this
constexpr int MAX_TRIMS = 6;
constexpr float MAX_OVERSHOOT_G = 1.0f;    // clamp for the learned overshoot sent by the dashboard
constexpr uint32_t NO_FLOW_MS = 4000;      // auger running, weight not rising (only with HAS_AUGER)
constexpr float NO_FLOW_RISE_G = 0.05f;
constexpr uint32_t DOSE_TIMEOUT_MS = 120000;
constexpr uint32_t LINK_TIMEOUT_MS = 5000; // no dashboard ping during a dose -> motor off

// ---- reporting --------------------------------------------------------------
constexpr uint32_t STATUS_PERIOD_MS = 250; // status (retained) incl. live weight
constexpr uint32_t DOSE_PERIOD_MS = 150;   // dose events while dosing
