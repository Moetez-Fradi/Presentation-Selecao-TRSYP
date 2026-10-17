// Dosing station firmware.
//   net/        Wi-Fi + MQTT + USB serial link to the dashboard (signed commands)
//   sensors/    load cell (HX711 + filter), cup / hopper / 12 V inputs
//   actuators/  auger stepper, vibrator
//   control/    dosing state machine + protocol
//   ui/         I2C character LCD
// What is fitted, pins and calibration: include/config.h. Network: include/secrets.h.

#include <Arduino.h>
#include <ArduinoJson.h>

#include "actuators/auger.h"
#include "control/doser.h"
#include "net/ds_net.h"
#include "sensors/inputs.h"
#include "sensors/scale.h"
#include "ui/display.h"
#include "ui/lcd.h"
#include "ui/led.h"

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("{\"evt\":\"log\",\"msg\":\"dosing station boot\"}");

  led::begin();
  led::boot();
  lcd::begin();
  scale::begin();
  inputs::begin();
  auger::begin();
  vibrator::begin();
  dsnet::begin();
  doser::begin();
  display::begin();  // LCD screens, own task on core 0
}

void loop() {
  scale::update();
  inputs::update();
  auger::update();
  vibrator::update();
  lcd::update();

  led::update();

  JsonDocument cmd;
  if (dsnet::nextCommand(cmd)) doser::handle(cmd);
  if (inputs::tarePressed()) {
    // same path as the dashboard's Tare: refused (and logged) during a dose
    JsonDocument tare;
    tare["cmd"] = "tare";
    doser::handle(tare);
  }

  doser::update();
}
