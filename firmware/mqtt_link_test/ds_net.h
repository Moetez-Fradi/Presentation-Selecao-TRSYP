#pragma once
// Dosing station <-> dashboard link: Wi-Fi + MQTT over TLS, plus the same JSON over USB serial.
//
// Uses the ESP-IDF MQTT client bundled with arduino-esp32 (2.x and 3.x). It runs in its own task with an
// outbox, so publishing never blocks the dosing loop, and it reconnects by itself.
//
// Topics (trsyp/<STATION_ID>/...):
//   cmd     dashboard -> ESP32   start | stop | tare | status | ping | done
//   evt     ESP32 -> dashboard   dose, error, ack
//   status  ESP32 -> dashboard   retained, ~2 Hz
//   result  ESP32 -> dashboard   retained, QoS 1, one per dose
//   online  ESP32 last-will      retained "true" / "false"
//
// Libraries: ArduinoJson 7. Board package: esp32 by Espressif 2.x or 3.x.

#include <Arduino.h>
#include <ArduinoJson.h>

namespace dsnet {

// Call once in setup(), after Serial.begin(115200).
void begin();

// Next command from MQTT or USB serial. Non-blocking; returns false if none.
// "ping" commands are consumed internally (see msSincePing).
bool nextCommand(JsonDocument &cmd);

// Publishing (non-blocking). Each message is also printed as one JSON line on Serial.
void publishStatus(const JsonDocument &doc);  // {"evt":"status",...}
void publishEvent(const JsonDocument &doc);   // {"evt":"dose"|"error"|"ack",...}
void publishResult(const JsonDocument &doc);  // {"evt":"result",...}

// Convenience: {"evt":"ack","cmd":..,"ok":..,"msg":..}
void ack(const char *cmd, bool ok, const char *msg = nullptr);
// Convenience: {"evt":"error","code":..}
void error(const char *code);

bool wifiUp();
bool brokerUp();

// Milliseconds since the dashboard's last ping (MQTT or serial).
// During a dose, stop the motor when this exceeds ~5000 (dashboard lost).
uint32_t msSincePing();

// ISO-8601 UTC timestamp ("2026-10-16T14:02:11Z"), from NTP once Wi-Fi is up.
// Falls back to "+<millis>ms" before the clock is set.
String isoNow();

}  // namespace dsnet
