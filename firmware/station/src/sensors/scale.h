#pragma once
#include <Arduino.h>

// Load cell (HX711) with the WeightFilter signal chain from esp32-hello.
// Non-blocking: call update() every loop; tare and calibration run over the next samples.
namespace scale {

void begin();
void update();

float grams();         // filtered, tared, unrounded
bool stable();         // std dev of the last second below threshold
bool taring();
bool tared();          // not taring, stable and near zero
bool fault();          // HX711 not responding
bool overload();       // ADC at its limits
long raw();            // last raw reading (debug)

void tare();           // starts an asynchronous tare (scale should be still)

// ---- calibration: tare empty, put a known mass on, calibrate(mass) -----------
float factor();        // raw units per gram in use
bool calibrated();     // true if the factor comes from a saved calibration (not the default)
bool calibrating();
// Starts averaging the raw reading with the known mass on. Returns false (and why)
// if it can't start, e.g. while taring.
bool calibrate(float massG, const char **why);
void resetCalibration();  // back to the default factor in config.h

struct CalResult {
  bool ok;
  float factor;
  float massG;
  const char *msg;
};
// One-shot: true once when a calibration has finished (ok or not).
bool takeCalResult(CalResult &out);

}  // namespace scale
