#include "actuators/auger.h"

#include <Arduino.h>
#include "config.h"

namespace auger {

static Speed current = Speed::Off;

#if HAS_AUGER
// Steps per second per speed. Tune on the real auger.
static uint32_t stepRate(Speed s) {
  switch (s) {
    case Speed::Fast: return AUGER_FAST_SPS;
    case Speed::Slow: return AUGER_SLOW_SPS;
    case Speed::Fine: return AUGER_FINE_SPS;
    default: return 0;
  }
}
static uint32_t lastStepUs = 0;
#endif

void begin() {
#if HAS_AUGER
  pinMode(PIN_STEP, OUTPUT);
  pinMode(PIN_DIR, OUTPUT);
  pinMode(PIN_EN, OUTPUT);
  digitalWrite(PIN_EN, HIGH);  // driver disabled until needed (active LOW)
#endif
}

void update() {
#if HAS_AUGER
  uint32_t rate = stepRate(current);
  if (!rate) return;
  uint32_t now = micros();
  if (now - lastStepUs >= 1000000UL / rate) {
    lastStepUs = now;
    digitalWrite(PIN_STEP, HIGH);
    delayMicroseconds(3);
    digitalWrite(PIN_STEP, LOW);
  }
#endif
}

void run(Speed s) {
#if HAS_AUGER
  if (s != Speed::Off && current == Speed::Off) {
    digitalWrite(PIN_DIR, AUGER_FEED_DIR);
    digitalWrite(PIN_EN, LOW);
  }
#endif
  current = s;
}

void stop() {
  current = Speed::Off;
#if HAS_AUGER
  digitalWrite(PIN_DIR, !AUGER_FEED_DIR);  // a few reverse steps cut the powder column
  for (int i = 0; i < AUGER_REVERSE_STEPS; i++) {
    digitalWrite(PIN_STEP, HIGH);
    delayMicroseconds(3);
    digitalWrite(PIN_STEP, LOW);
    delayMicroseconds(800);
  }
  digitalWrite(PIN_EN, HIGH);
#endif
}

void trimPulse(int microsteps) {
#if HAS_AUGER
  digitalWrite(PIN_DIR, AUGER_FEED_DIR);
  digitalWrite(PIN_EN, LOW);
  for (int i = 0; i < microsteps; i++) {
    digitalWrite(PIN_STEP, HIGH);
    delayMicroseconds(3);
    digitalWrite(PIN_STEP, LOW);
    delayMicroseconds(2000);
  }
  digitalWrite(PIN_EN, HIGH);
#else
  (void)microsteps;
#endif
}

void jog(int steps, uint32_t stepsPerSecond) {
#if HAS_AUGER
  if (!steps || !stepsPerSecond) return;
  uint32_t halfPeriodUs = 500000UL / stepsPerSecond;
  digitalWrite(PIN_DIR, steps > 0 ? AUGER_FEED_DIR : !AUGER_FEED_DIR);
  digitalWrite(PIN_EN, LOW);
  for (int i = 0, n = abs(steps); i < n; i++) {
    digitalWrite(PIN_STEP, HIGH);
    delayMicroseconds(halfPeriodUs);
    digitalWrite(PIN_STEP, LOW);
    delayMicroseconds(halfPeriodUs);
  }
  digitalWrite(PIN_EN, HIGH);
#else
  (void)steps;
  (void)stepsPerSecond;
#endif
}

bool fitted() { return HAS_AUGER; }

const char *name(Speed s) {
  switch (s) {
    case Speed::Fast: return "FAST";
    case Speed::Slow: return "SLOW";
    case Speed::Fine: return "FINE";
    default: return "OFF";
  }
}

}  // namespace auger

namespace vibrator {

static bool state = false;

#if VIBRATOR_ACTIVE_LOW
static const int VIB_ON = LOW, VIB_OFF = HIGH;
#else
static const int VIB_ON = HIGH, VIB_OFF = LOW;
#endif

void begin() {
#if HAS_VIBRATOR
  digitalWrite(PIN_VIBRATOR, VIB_OFF);  // set the level before enabling the output: no blip at boot
  pinMode(PIN_VIBRATOR, OUTPUT);
  digitalWrite(PIN_VIBRATOR, VIB_OFF);
#endif
}

void set(bool on) {
  state = on;
#if HAS_VIBRATOR
  digitalWrite(PIN_VIBRATOR, on ? VIB_ON : VIB_OFF);
#endif
}

bool on() { return state; }

void update() {
#if HAS_VIBRATOR && VIBRATOR_TEST_MS > 0
  // bench test: alternate HIGH / LOW every VIBRATOR_TEST_MS
  static uint32_t last = 0;
  uint32_t now = millis();
  if (now - last >= VIBRATOR_TEST_MS) {
    last = now;
    set(!state);
  }
#endif
}

}  // namespace vibrator
