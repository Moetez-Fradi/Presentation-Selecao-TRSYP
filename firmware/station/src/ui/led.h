#pragma once
// Single status LED (HAS_LED). Non-blocking blink patterns; call update() every loop.
#include <stdint.h>

namespace led {

void begin();
void update();
void blink(int count, uint16_t onMs, uint16_t offMs);  // replaces any running pattern

// patterns
inline void boot() { blink(3, 120, 120); }
inline void accepted() { blink(2, 450, 250); }
inline void rejected() { blink(5, 90, 90); }

}  // namespace led
