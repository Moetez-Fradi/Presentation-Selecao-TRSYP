// Teammate's stepper bench test (works). A4988: STEP G25, DIR G26, EN G27 (LOW = on).
// One revolution each way, 1 s pause. 400 steps/rev = 200-step motor at 1/2 microstepping.
#include <Arduino.h>

#define STEP_PIN 25   // Step pin connected to A4988 STEP
#define DIR_PIN 26   // Direction pin connected to A4988 DIR
#define ENABLE_PIN 27 // Optional, connected to A4988 ENABLE

int stepsPerRevolution = 400; // Adjust based on your motor

void stepMotor(int steps);

void setup() {
  Serial.begin(115200);
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);
  pinMode(ENABLE_PIN, OUTPUT);

  digitalWrite(ENABLE_PIN, LOW); // Enable driver (LOW = ON)
  Serial.println("Stepper Motor Test Start");
}

void loop() {
  // Rotate clockwise
  digitalWrite(DIR_PIN, HIGH);
  stepMotor(stepsPerRevolution); // One full rotation
  delay(1000);

  // Rotate counterclockwise
  digitalWrite(DIR_PIN, LOW);
  stepMotor(stepsPerRevolution);
  delay(1000);
}

void stepMotor(int steps) {
  for (int i = 0; i < steps; i++) {
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(1000); // Control speed (lower = faster)
    digitalWrite(STEP_PIN, LOW);
    delayMicroseconds(1000);
  }
}
