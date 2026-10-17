#include "sensors/ultrasonic.h"

#include <Arduino.h>
#include "config.h"

namespace ultrasonic {

#if HAS_ULTRASONIC
static const uint32_t PERIOD_MS = 100;       // one ping every 100 ms (sensor needs >= 60 ms)
static const uint32_t ECHO_TIMEOUT_US = 30000;  // ~5 m: no echo after this = missed ping
static const uint32_t FAULT_MS = 1000;
static const int N = 9;                      // median window (~1 s): ignores wild pings

static volatile uint32_t riseUs = 0, widthUs = 0;
static volatile bool gotEcho = false;
static volatile uint32_t edgeCount = 0;
static uint32_t lastPingMs = 0, lastEchoMs = 0;
static float hist[N];
static int count = 0, idx = 0;
static float median = -1;

static void IRAM_ATTR onEcho() {
  uint32_t t = micros();
  edgeCount++;
  if (digitalRead(PIN_US_ECHO)) {
    riseUs = t;
  } else if (riseUs) {
    widthUs = t - riseUs;
    riseUs = 0;
    gotEcho = true;
  }
}

static float computeMedian() {
  float s[N];
  for (int i = 0; i < count; i++) s[i] = hist[i];
  for (int i = 1; i < count; i++) {
    float v = s[i];
    int j = i - 1;
    while (j >= 0 && s[j] > v) s[j + 1] = s[j], j--;
    s[j + 1] = v;
  }
  return s[count / 2];
}
#endif

void begin() {
#if HAS_ULTRASONIC
  pinMode(PIN_US_TRIG, OUTPUT);
  digitalWrite(PIN_US_TRIG, LOW);
  pinMode(PIN_US_ECHO, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_US_ECHO), onEcho, CHANGE);
  lastEchoMs = millis();
#endif
}

void update() {
#if HAS_ULTRASONIC
  uint32_t now = millis();
  if (gotEcho) {
    gotEcho = false;
    uint32_t w = widthUs;
    if (w > 100 && w < ECHO_TIMEOUT_US) {
      hist[idx] = w * 0.1715f;  // speed of sound 343 m/s, there and back: mm = us * 0.343 / 2
      idx = (idx + 1) % N;
      if (count < N) count++;
      median = computeMedian();
      lastEchoMs = now;
    }
  }
  if (now - lastPingMs >= PERIOD_MS) {
    lastPingMs = now;
    riseUs = 0;
    digitalWrite(PIN_US_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_US_TRIG, LOW);
  }
#endif
}

float spread() {
#if HAS_ULTRASONIC
  if (count < N) return 1e9;  // not enough readings yet: treat as unsteady
  float lo = hist[0], hi = hist[0];
  for (int i = 1; i < count; i++) lo = min(lo, hist[i]), hi = max(hi, hist[i]);
  return hi - lo;
#else
  return 1e9;
#endif
}

bool valid() {
#if HAS_ULTRASONIC
  return count > 0 && !fault();
#else
  return false;
#endif
}

float mm() {
#if HAS_ULTRASONIC
  return count ? median : -1;
#else
  return -1;
#endif
}

bool fault() {
#if HAS_ULTRASONIC
  return millis() - lastEchoMs > FAULT_MS;
#else
  return false;
#endif
}

uint32_t edges() {
#if HAS_ULTRASONIC
  return edgeCount;
#else
  return 0;
#endif
}

uint32_t lastWidthUs() {
#if HAS_ULTRASONIC
  return widthUs;
#else
  return 0;
#endif
}

}  // namespace ultrasonic
