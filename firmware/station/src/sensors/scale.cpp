#include "sensors/scale.h"

#include <HX711.h>
#include <Preferences.h>
#include "config.h"
#include "sensors/weight_filter.h"

namespace scale {

static const unsigned long SENSOR_TIMEOUT_MS = 1000;  // HX711 gives ~10 samples/s
static const long HX711_MAX = 8388607;
static const long HX711_MIN = -8388608;
static const long CAL_MIN_DELTA = 1000;  // less raw change than this = the mass isn't on

static HX711 hx;
static Preferences prefs;  // calibration survives reboots and reflashing
static WeightFilter filter;
static long offset = 0;
static long lastRaw = 0;
static unsigned long lastSampleMs = 0;
static bool faultFlag = false;
static bool overloadFlag = false;

static float rawPerGram = SCALE_RAW_PER_GRAM;
static bool savedCal = false;

static int tareLeft = 0;  // samples still to collect for the tare
static long long tareSum = 0;

static int calLeft = 0;  // samples still to collect for the calibration
static long long calSum = 0;
static float calMass = 0;
static bool calReady = false;
static CalResult calResult;

void begin() {
  prefs.begin("scale", false);
  if (prefs.isKey("factor")) {
    float f = prefs.getFloat("factor", 0);
    if (f != 0 && isfinite(f)) {
      rawPerGram = f;
      savedCal = true;
    }
  }

  hx.begin(PIN_HX711_DT, PIN_HX711_SCK);
  if (!hx.wait_ready_timeout(2000)) {
    faultFlag = true;
    Serial.println("{\"evt\":\"log\",\"msg\":\"HX711 not found: DT->G32, SCK->G33, VCC->3V3\"}");
  }
  Serial.printf("{\"evt\":\"log\",\"msg\":\"scale factor %.3f raw/g (%s)\"}\n", rawPerGram,
                savedCal ? "saved calibration" : "default, not calibrated");
  lastSampleMs = millis();
  tare();
}

static void finishCalibration() {
  long loaded = (long)(calSum / SCALE_CAL_SAMPLES) - offset;
  calReady = true;
  calResult.massG = calMass;
  if (labs(loaded) < CAL_MIN_DELTA) {
    calResult = {false, rawPerGram, calMass, "almost no change from zero: is the mass on? did you tare empty first?"};
    return;
  }
  rawPerGram = (float)loaded / calMass;
  prefs.putFloat("factor", rawPerGram);
  savedCal = true;
  filter.reset();
  calResult = {true, rawPerGram, calMass, "saved"};
}

void update() {
  if (!hx.is_ready()) {
    if (!faultFlag && millis() - lastSampleMs > SENSOR_TIMEOUT_MS) faultFlag = true;
    return;
  }
  long r = hx.read();
  lastSampleMs = millis();
  faultFlag = false;
  lastRaw = r;

  overloadFlag = r >= HX711_MAX || r <= HX711_MIN;
  if (overloadFlag) return;  // a clipped reading says nothing about the weight

  if (tareLeft > 0) {
    tareSum += r;
    if (--tareLeft == 0) {
      offset = (long)(tareSum / SCALE_TARE_SAMPLES);
      filter.reset();
    }
    return;
  }
  if (calLeft > 0) {
    calSum += r;
    if (--calLeft == 0) finishCalibration();
  }
  filter.add((r - offset) / rawPerGram);
}

void tare() {
  tareSum = 0;
  tareLeft = SCALE_TARE_SAMPLES;
}

bool calibrate(float massG, const char **why) {
  if (massG <= 0 || !isfinite(massG)) return *why = "give the known mass in grams", false;
  if (taring()) return *why = "still taring, try again in a second", false;
  if (calLeft > 0) return *why = "already calibrating", false;
  if (faultFlag || overloadFlag) return *why = "load cell fault or overload", false;
  calMass = massG;
  calSum = 0;
  calLeft = SCALE_CAL_SAMPLES;
  return true;
}

void resetCalibration() {
  prefs.remove("factor");
  rawPerGram = SCALE_RAW_PER_GRAM;
  savedCal = false;
  filter.reset();
}

bool takeCalResult(CalResult &out) {
  if (!calReady) return false;
  calReady = false;
  out = calResult;
  return true;
}

float grams() { return filter.filtered(); }
bool stable() { return filter.stable(); }
bool taring() { return tareLeft > 0; }
bool tared() { return !taring() && !faultFlag && stable() && fabsf(grams()) < TARE_OK_BAND_G; }
bool fault() { return faultFlag; }
bool overload() { return overloadFlag; }
long raw() { return lastRaw; }
float factor() { return rawPerGram; }
bool calibrated() { return savedCal; }
bool calibrating() { return calLeft > 0; }

}  // namespace scale
