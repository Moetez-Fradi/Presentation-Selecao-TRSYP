// Stepper bench test: ESP32 + STEP/DIR driver (A4988, DRV8825, TMC2208, TB6600...) + NEMA 17.
// No Wi-Fi, no scale: just proves the motor, the driver and the wiring.
// Same pins as the station firmware (include/config.h there), so nothing is rewired later.
//
// Serial Monitor at 115200, type a command + Enter:
//   e        enable / disable the driver (motor holds / goes limp)
//   f / b    one full turn forward / backward      f400 = 400 steps forward
//   v<sps>   speed in steps per second, e.g. v800
//   r / x    run continuously / stop
//   t        self-test: slow turn each way, then a speed ramp
//   ?        help

#include <Arduino.h>

// ---- wiring (must match the station's config.h) ----------------------------
const int PIN_STEP = 25;
const int PIN_DIR = 26;
const int PIN_EN = 27;          // LOW = driver enabled (A4988/DRV8825/TMC2208)
const bool EN_ACTIVE_LOW = true; // TB6600 wired with ENA- to the pin: also active LOW

// ---- motor ----------------------------------------------------------------
const int FULL_STEPS_PER_REV = 200;  // NEMA 17 = 1.8 deg per step
const int MICROSTEPS = 16;           // must match the MS1/MS2/MS3 jumpers (or TB6600 DIP switches)
const int STEPS_PER_REV = FULL_STEPS_PER_REV * MICROSTEPS;

const float START_SPS = 200;         // speed a motor can start at without a ramp
const float ACCEL_SPS2 = 4000;       // ramp: steps per second, per second

float targetSps = 800;               // default cruise speed
bool enabled = false;

// motion state
long stepsLeft = 0;                  // >0 = finite move, -1 = run forever
bool forward = true;
float currentSps = 0;
uint32_t lastStepUs = 0;
uint32_t lastRampUs = 0;
long totalSteps = 0;

void setEnabled(bool on) {
  enabled = on;
  digitalWrite(PIN_EN, (on == EN_ACTIVE_LOW) ? LOW : HIGH);
  Serial.printf("driver %s\n", on ? "ENABLED (motor holds its position)" : "disabled (motor is limp)");
}

void startMove(long steps, bool fwd) {
  if (!enabled) setEnabled(true);
  forward = fwd;
  digitalWrite(PIN_DIR, fwd ? HIGH : LOW);
  delayMicroseconds(5);  // DIR setup time before the first STEP
  stepsLeft = steps;
  currentSps = START_SPS;
  lastStepUs = micros();
  lastRampUs = lastStepUs;
}

void stopMove() {
  stepsLeft = 0;
  currentSps = 0;
}

void stepOnce() {
  digitalWrite(PIN_STEP, HIGH);
  delayMicroseconds(3);  // >= 2 us for A4988/DRV8825, TB6600 needs >= 2.5 us
  digitalWrite(PIN_STEP, LOW);
  totalSteps += forward ? 1 : -1;
}

// Non-blocking: call as often as possible.
void updateMotion() {
  if (stepsLeft == 0) return;
  uint32_t now = micros();

  // linear ramp up to targetSps, and down near the end of a finite move
  float dt = (now - lastRampUs) / 1e6f;
  lastRampUs = now;
  float brakeSps = stepsLeft > 0 ? sqrtf(2 * ACCEL_SPS2 * stepsLeft) + START_SPS : 1e9f;
  float want = min(targetSps, brakeSps);
  if (currentSps < want) currentSps = min(want, currentSps + ACCEL_SPS2 * dt);
  else currentSps = max(want, currentSps - ACCEL_SPS2 * dt);
  if (currentSps < START_SPS) currentSps = START_SPS;

  if (now - lastStepUs >= (uint32_t)(1e6f / currentSps)) {
    lastStepUs = now;
    stepOnce();
    if (stepsLeft > 0 && --stepsLeft == 0) {
      currentSps = 0;
      Serial.printf("move done, position %ld steps (%.2f turns)\n", totalSteps, (float)totalSteps / STEPS_PER_REV);
    }
  }
}

void waitMove() {
  while (stepsLeft != 0) updateMotion();
}

void selfTest() {
  Serial.println("self-test 1/3: one slow turn forward (watch the shaft: smooth, no buzzing)");
  float saved = targetSps;
  targetSps = 400;
  startMove(STEPS_PER_REV, true);
  waitMove();
  delay(500);
  Serial.println("self-test 2/3: one slow turn backward (should end where it started)");
  startMove(STEPS_PER_REV, false);
  waitMove();
  delay(500);
  Serial.println("self-test 3/3: speed ramp, half a turn per speed. Note where it starts skipping or stalls.");
  const float speeds[] = {400, 800, 1600, 3200, 4800, 6400};
  for (float s : speeds) {
    targetSps = s;
    Serial.printf("  %5.0f steps/s = %4.0f rpm\n", s, s * 60 / STEPS_PER_REV);
    startMove(STEPS_PER_REV / 2, true);
    waitMove();
    delay(300);
  }
  targetSps = saved;
  Serial.println("self-test done. The highest speed that ran smoothly is your FAST speed limit.");
}

void help() {
  Serial.println();
  Serial.printf("Stepper test: STEP=%d DIR=%d EN=%d, %d microsteps -> %d steps per turn\n", PIN_STEP, PIN_DIR, PIN_EN,
                MICROSTEPS, STEPS_PER_REV);
  Serial.println("  e      enable/disable driver");
  Serial.println("  f / b  one turn forward/backward  (f400 = 400 steps)");
  Serial.println("  v800   set speed (steps/s)");
  Serial.println("  r / x  run continuously / stop");
  Serial.println("  t      self-test");
  Serial.println();
}

void handle(String cmd) {
  cmd.trim();
  if (!cmd.length()) return;
  char c = tolower(cmd[0]);
  long n = cmd.length() > 1 ? cmd.substring(1).toInt() : 0;
  switch (c) {
    case 'e': setEnabled(!enabled); break;
    case 'f': startMove(n > 0 ? n : STEPS_PER_REV, true); break;
    case 'b': startMove(n > 0 ? n : STEPS_PER_REV, false); break;
    case 'v':
      if (n > 0) targetSps = n;
      Serial.printf("speed %.0f steps/s = %.0f rpm\n", targetSps, targetSps * 60 / STEPS_PER_REV);
      break;
    case 'r': startMove(-1, true); Serial.println("running, x to stop"); break;
    case 'x': stopMove(); Serial.println("stopped"); break;
    case 't': selfTest(); break;
    default: help();
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_STEP, OUTPUT);
  pinMode(PIN_DIR, OUTPUT);
  pinMode(PIN_EN, OUTPUT);
  digitalWrite(PIN_STEP, LOW);
  setEnabled(false);  // limp until asked: safe while wiring
  delay(300);
  help();
}

void loop() {
  if (Serial.available()) handle(Serial.readStringUntil('\n'));
  updateMotion();
}
