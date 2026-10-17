#pragma once
#include <ArduinoJson.h>

// Dosing state machine and the dashboard protocol (commands in, status/dose/result out).
// Weight-driven, never timed: the phase comes from the measured mass vs the target.
namespace doser {

void begin();
void handle(JsonDocument &cmd);  // one command from dsnet::nextCommand()
void update();                   // call every loop

// What the station is doing, for the LCD. Plain chars only: copied across cores.
struct View {
  char state[8];        // IDLE CHECKS DOSING SETTLE MANUAL DONE ERROR
  char phase[8];        // FAST SLOW FINE TRIM SETTLE MANUAL ("" when idle)
  char sample[24];
  float weight;
  bool stable;
  float target;
  float tol;
  int trims;
  // last finished run
  char lastStatus[12];  // ACCEPTED REJECTED INCOMPLETE ("" if none yet)
  char lastSample[24];
  char lastError[16];
  float lastMeasured;
  float lastDev;
  bool calibrating;
};
void view(View &out);  // thread-safe copy, callable from the display task

}  // namespace doser
