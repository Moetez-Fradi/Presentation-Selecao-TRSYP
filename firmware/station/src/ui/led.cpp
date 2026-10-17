#include "ui/led.h"

#include <Arduino.h>
#include "config.h"
#if HAS_LED && LED_NO_RESISTOR
#include "driver/gpio.h"
static const int LED_PWM_CH = 7, LED_PWM_BITS = 8, LED_PWM_DUTY = 64;  // 25 %
#endif

namespace led {

static int left = 0;  // half-cycles left (on + off = 2)
static uint16_t onTime = 0, offTime = 0;
static uint32_t nextAt = 0;
static bool lit = false;

static void write(bool on) {
  lit = on;
#if HAS_LED && LED_NO_RESISTOR
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(PIN_LED, on ? LED_PWM_DUTY : 0);
#else
  ledcWrite(LED_PWM_CH, on ? LED_PWM_DUTY : 0);
#endif
#elif HAS_LED
  digitalWrite(PIN_LED, on ? HIGH : LOW);
#endif
}

void begin() {
#if HAS_LED && LED_NO_RESISTOR
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_LED, 5000, LED_PWM_BITS);
#else
  ledcSetup(LED_PWM_CH, 5000, LED_PWM_BITS);
  ledcAttachPin(PIN_LED, LED_PWM_CH);
#endif
  gpio_set_drive_capability((gpio_num_t)PIN_LED, GPIO_DRIVE_CAP_0);  // weakest: limits the current
#elif HAS_LED
  pinMode(PIN_LED, OUTPUT);
#endif
  write(false);
}

void blink(int count, uint16_t onMs, uint16_t offMs) {
  onTime = onMs;
  offTime = offMs;
  left = count * 2;
  nextAt = millis();
  write(false);
}

void update() {
  if (left <= 0 || (int32_t)(millis() - nextAt) < 0) return;
  write(!lit);
  nextAt = millis() + (lit ? onTime : offTime);
  if (--left == 0) write(false);
}

}  // namespace led
