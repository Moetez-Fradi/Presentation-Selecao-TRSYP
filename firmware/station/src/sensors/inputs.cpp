#include "sensors/inputs.h"

#include <Arduino.h>
#include "config.h"
#include <Preferences.h>
#include "sensors/ultrasonic.h"

namespace inputs {

static void loadHopperCal();  // defined with the hopper code below

// IR cup sensor: the raw pin must hold a new level for CUP_DEBOUNCE_MS before the
// debounced state follows, so a flicker at the edge of the sensor's range can't abort a dose.
static bool cupStable = true;
static bool cupLast = true;
static uint32_t cupChangedMs = 0;
static uint32_t flips = 0;

// TARE button: pressed = LOW. A press counts once the pin has been LOW for BTN_DEBOUNCE_MS.
static const uint32_t BTN_DEBOUNCE_MS = 30;
static bool btnDown = false, btnRaw = false, btnEvent = false;
static uint32_t btnChangedMs = 0;


void begin() {
#if HAS_CUP_SENSOR
  pinMode(PIN_CUP_IR, INPUT);  // GPIO 34-39 have no internal pull-ups (the FC-51 board has one)
  cupStable = cupLast = digitalRead(PIN_CUP_IR) == LOW;
  cupChangedMs = millis();
#endif
#if HAS_POWER_SENSE
  pinMode(PIN_POWER_SENSE, INPUT);
#endif
#if HAS_TARE_BUTTON
  pinMode(PIN_TARE_BTN, INPUT_PULLUP);  // button to GND, no resistor needed
#endif
#if HAS_ULTRASONIC
  ultrasonic::begin();
  loadHopperCal();
#endif
}

void update() {
  ultrasonic::update();
#if HAS_TARE_BUTTON
  {
    bool raw = digitalRead(PIN_TARE_BTN) == LOW;
    uint32_t t = millis();
    if (raw != btnRaw) {
      btnRaw = raw;
      btnChangedMs = t;
    } else if (raw != btnDown && t - btnChangedMs >= BTN_DEBOUNCE_MS) {
      btnDown = raw;
      if (raw) btnEvent = true;  // on press, not release
    }
  }
#endif
#if HAS_CUP_SENSOR
  bool raw = digitalRead(PIN_CUP_IR) == LOW;
  uint32_t now = millis();
  if (raw != cupLast) {
    cupLast = raw;
    cupChangedMs = now;
    flips++;
  } else if (raw != cupStable && now - cupChangedMs >= CUP_DEBOUNCE_MS) {
    cupStable = raw;
  }
#endif
}

bool tarePressed() {
  bool e = btnEvent;
  btnEvent = false;
  return e;
}

bool cupRaw() { return cupLast; }
uint32_t cupFlips() { return flips; }

bool cupPresent() {
#if HAS_CUP_SENSOR
  return cupStable;
#else
  return true;
#endif
}

// Hopper level from the ultrasonic distance: two points measured on the real hopper
// ("empty" = far, "full" = near), saved in flash from the dashboard.
static Preferences hopperPrefs;
static float emptyMm = -1, fullMm = -1;

static bool savedPairValid() { return emptyMm > 0 && fullMm >= 0 && emptyMm - fullMm > 10; }

static void loadHopperCal() {
  hopperPrefs.begin("hopper", false);
  emptyMm = hopperPrefs.getFloat("empty", -1);
  fullMm = hopperPrefs.getFloat("full", -1);
  if (!savedPairValid()) {  // half a calibration (or a bad one) is ignored: use the fixed mapping
    hopperPrefs.clear();
    emptyMm = fullMm = -1;
  }
}

// a saved pair from the dashboard wins; otherwise the fixed mapping from config.h
static float emptyPoint() { return savedPairValid() ? emptyMm : HOPPER_EMPTY_MM; }
static float fullPoint() { return savedPairValid() ? fullMm : HOPPER_FULL_MM; }
bool hopperCalibrated() { return true; }
float hopperMm() { return ultrasonic::mm(); }

bool hopperSetPoint(bool empty, const char **why) {
  if (!ultrasonic::valid()) return *why = "no echo from the ultrasonic sensor", false;
  if (ultrasonic::spread() > HOPPER_CAL_MAX_SPREAD_MM)
    return *why = "reading not steady: aim straight down, away from the walls, keep >5 cm above the sugar", false;
  float d = ultrasonic::mm();
  if (!empty && emptyMm > 0 && d >= emptyMm - 10)
    return *why = "full must read closer than empty: set empty with the hopper empty first", false;
  if (empty && fullMm > 0 && d <= fullMm + 10) {  // a new empty point invalidates an old full
    fullMm = -1;
    hopperPrefs.remove("full");
  }
  if (empty) emptyMm = d;
  else fullMm = d;
  hopperPrefs.putFloat(empty ? "empty" : "full", d);
  return true;
}

int hopperPct() {
#if HAS_ULTRASONIC
  if (!ultrasonic::valid()) return -1;
  float pct = (emptyPoint() - ultrasonic::mm()) / (emptyPoint() - fullPoint()) * 100.0f;
  return (int)constrain(pct, 0.0f, 100.0f);
#else
  return -1;
#endif
}

bool hopperOk() {
  int p = hopperPct();  // -1 (no sensor, not calibrated, no echo) never blocks a dose
  return p < 0 || p >= HOPPER_MIN_PCT;
}

bool powerOk() {
#if HAS_POWER_SENSE
  return digitalRead(PIN_POWER_SENSE) == HIGH;
#else
  return true;
#endif
}

}  // namespace inputs
