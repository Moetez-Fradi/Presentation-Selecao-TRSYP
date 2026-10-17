// Teammate's vibrator bench test (works). Relay module, active LOW.
// Wiring:
//   ESP32 GND  -> relay module GND
//   ESP32 3V3  -> relay VCC
//   GPIO 13    -> relay IN1
//   motor supply + (ESP32 5V) -> relay COM
//   relay NO   -> motor +
//   motor -    -> motor supply - (ESP32 GND + relay GND)
#include <Arduino.h>

const int RELAY_PIN = 13;

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // Relay OFF
}

void loop() {
  digitalWrite(RELAY_PIN, LOW);  // Motor ON
  delay(1000);

  digitalWrite(RELAY_PIN, HIGH); // Motor OFF
  delay(1000);
}
