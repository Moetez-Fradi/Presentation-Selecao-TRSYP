#pragma once
// Discrete station inputs. Each one reports "OK" while its HAS_* flag in config.h is 0,
// so the checks pass until the real sensor is fitted.
#include <stdint.h>

namespace inputs {

void begin();
void update();      // call every loop (debouncing)
bool cupPresent();  // debounced
bool cupRaw();      // undebounced pin state (diagnostics)
uint32_t cupFlips(); // raw pin changes since boot (diagnostics: flicker counter)
bool hopperOk();
int hopperPct();   // -1 = no level sensor, not calibrated, or no echo
float hopperMm();  // raw ultrasonic distance, -1 if none
bool hopperCalibrated();
// Save the current distance as the "empty" (true) or "full" (false) hopper level.
bool hopperSetPoint(bool empty, const char **why);
bool powerOk();
bool tarePressed();  // one-shot: true once per (debounced) press of the TARE button

}  // namespace inputs
