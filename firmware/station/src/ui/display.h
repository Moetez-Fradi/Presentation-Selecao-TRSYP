#pragma once
// LCD user interface: one screen per machine state, animated, drawn by its own task on
// core 0 so slow I2C writes never stall the stepper or the dosing loop.
#include <stdint.h>

namespace display {

void begin();  // after lcd::begin(); starts the display task (no-op without an LCD)

// Show a message for `ms` (from the dashboard: {"cmd":"lcd","text":"Hello|judges","ms":5000}).
// '|' splits the two rows; a row longer than the screen scrolls. Thread-safe.
void message(const char *text, uint32_t ms);

}  // namespace display
