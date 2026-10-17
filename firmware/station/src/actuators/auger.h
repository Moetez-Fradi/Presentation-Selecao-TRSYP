#pragma once
#include <stdint.h>
// Auger (stepper) and anti-bridging vibrator. With HAS_AUGER / HAS_VIBRATOR = 0 these
// do nothing, and a dose can be driven by pouring by hand onto the scale.
namespace auger {

enum class Speed { Off, Fast, Slow, Fine };

void begin();
void update();                 // call every loop (generates steps)
void run(Speed s);
void stop();                   // stop + a few reverse steps to cut the flow
void trimPulse(int microsteps);
// Bench test: blocking, idle only. steps > 0 = feed direction, < 0 = reverse.
void jog(int steps, uint32_t stepsPerSecond);
bool fitted();
const char *name(Speed s);

}  // namespace auger

namespace vibrator {
void begin();
void set(bool on);
bool on();
void update();  // call every loop (only does something in VIBRATOR_TEST_MS mode)
}  // namespace vibrator
