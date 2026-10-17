#pragma once
// HC-SR04 / HC-SR04P distance sensor on top of the hopper (HAS_ULTRASONIC).
// Non-blocking: update() fires a trigger every 100 ms and the echo pulse is timed by an
// interrupt, so nothing ever waits (no pulseIn) and the stepper keeps stepping.
#include <stdint.h>

namespace ultrasonic {

void begin();
void update();     // call every loop

bool valid();      // a recent echo was received
float mm();        // median of the last readings, -1 if none
bool fault();      // no echo for more than a second (wiring, or nothing in range)

float spread();    // max - min of the readings in the window (mm): steadiness

// diagnostics
uint32_t edges();     // signal changes seen on ECHO since boot (0 = sensor never answered)
uint32_t lastWidthUs(); // last echo pulse width, valid or not

}  // namespace ultrasonic
