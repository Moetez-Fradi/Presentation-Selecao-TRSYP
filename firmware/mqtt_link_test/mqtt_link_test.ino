// MQTT link test: a bare ESP32 pretending to be the dosing station.
// No load cell or motor needed. Proves phone dashboard <-> hotspot <-> HiveMQ <-> ESP32,
// and shows the exact message flow the real firmware must follow.
//
// 1. Copy secrets.h.example to secrets.h and fill it in.
// 2. Board: "ESP32 Dev Module" (esp32 package 3.x). Library: ArduinoJson 7.
// 3. Flash, open Serial Monitor at 115200, then press Start on the dashboard.
//
// The BOOT button (GPIO 0) toggles the fake cup, to test the NO_CUP error live.

#include <ArduinoJson.h>
#include "ds_net.h"

const int PIN_BOOT = 0;
const uint32_t LINK_TIMEOUT_MS = 5000;  // stop the dose if the dashboard goes silent

enum State { IDLE, DOSING, SETTLE, MANUAL, DONE, ERROR_ };
const char *STATE_NAME[] = {"IDLE", "DOSING", "SETTLE", "MANUAL", "DONE", "ERROR"};

State state = IDLE;
bool cup = true;
float weight = 0;  // fake load cell, grams
float target = 10, tol = 0.1, overshoot = 0.2, weightAtStop = 0;
String recipeId, materialId, sampleId, method, tStart;
uint32_t doseStartMs = 0, settleUntil = 0, lastStatusMs = 0, lastDoseMs = 0;
int trims = 0;

const char *phase() {
  if (state == MANUAL) return "MANUAL";
  if (state == SETTLE) return "SETTLE";
  if (trims > 0) return "TRIM";
  if (weight < 0.75f * target) return "FAST";
  if (weight < 0.95f * target) return "SLOW";
  return "FINE";
}

void sendStatus() {
  JsonDocument d;
  d["evt"] = "status";
  d["state"] = STATE_NAME[state];
  d["weight_g"] = roundf(weight * 100) / 100;
  d["cup"] = cup;
  d["hopper_ok"] = true;
  d["hopper_pct"] = 80;
  d["power_ok"] = true;
  d["tare_ok"] = cup && fabsf(weight) < 0.05f;
  dsnet::publishStatus(d);
}

void finish(const char *errorCode = nullptr) {
  float dev = weight - target;
  JsonDocument r;
  r["evt"] = "result";
  r["run_id"] = sampleId + "-" + String(millis() % 100000, 36);
  r["recipe_id"] = recipeId;
  r["material_id"] = materialId;
  r["sample_id"] = sampleId;
  r["method"] = method;
  r["target_g"] = target;
  r["tol_g"] = tol;
  r["measured_g"] = roundf(weight * 100) / 100;
  r["dev_g"] = roundf(dev * 100) / 100;
  r["status"] = errorCode ? "INCOMPLETE" : (fabsf(dev) <= tol + 1e-4f ? "ACCEPTED" : "REJECTED");
  r["overshoot_g"] = roundf((weight - weightAtStop) * 1000) / 1000;
  r["trim_steps"] = trims;
  r["t_start"] = tStart;
  r["t_end"] = dsnet::isoNow();
  r["duration_ms"] = millis() - doseStartMs;
  if (errorCode) r["error"] = errorCode;
  // real firmware: append this line to LittleFS /log.jsonl BEFORE publishing
  dsnet::publishResult(r);
  state = errorCode ? ERROR_ : DONE;
  sendStatus();
}

void fail(const char *code) {
  JsonDocument d;
  d["evt"] = "error";
  d["code"] = code;
  d["phase"] = phase();
  d["weight_g"] = roundf(weight * 100) / 100;
  dsnet::publishEvent(d);
  finish(code);
}

bool busy() { return state == DOSING || state == SETTLE || state == MANUAL; }

void handle(JsonDocument &c) {
  const char *cmd = c["cmd"] | "";
  if (!strcmp(cmd, "status")) return sendStatus();
  if (!strcmp(cmd, "tare")) {
    if (busy()) return dsnet::ack(cmd, false, "busy");
    weight = 0;
    if (state == DONE || state == ERROR_) state = IDLE;
    dsnet::ack(cmd, true);
    return sendStatus();
  }
  if (!strcmp(cmd, "stop")) {
    dsnet::ack(cmd, true);
    if (busy()) fail("ABORTED");
    return;
  }
  if (!strcmp(cmd, "done")) {
    if (state != MANUAL) return dsnet::ack(cmd, false, "not in manual");
    dsnet::ack(cmd, true);
    return finish();
  }
  if (!strcmp(cmd, "start")) {
    if (busy()) return dsnet::ack(cmd, false, "busy");
    if (!cup) {
      dsnet::ack(cmd, false, "NO_CUP");
      return dsnet::error("NO_CUP");
    }
    recipeId = c["recipe_id"] | "";
    materialId = c["material_id"] | "";
    sampleId = c["sample_id"] | "";
    method = c["method"] | "auto";
    target = c["target_g"] | 10.0f;
    tol = c["tol_g"] | 0.1f;
    overshoot = c["overshoot_g"] | 0.2f;
    weight = 0;  // auto-tare
    trims = 0;
    weightAtStop = 0;
    doseStartMs = millis();
    tStart = dsnet::isoNow();
    state = method == "manual" ? MANUAL : DOSING;
    dsnet::ack(cmd, true);
    return sendStatus();
  }
  dsnet::ack(cmd, false, "unknown command");
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  dsnet::begin();
}

void loop() {
  JsonDocument c;
  if (dsnet::nextCommand(c)) handle(c);

  // BOOT button = lift the cup
  static bool lastBtn = HIGH;
  bool btn = digitalRead(PIN_BOOT);
  if (lastBtn == HIGH && btn == LOW) cup = !cup;
  lastBtn = btn;

  uint32_t now = millis();
  static uint32_t lastStep = now;
  float dt = (now - lastStep) / 1000.0f;
  lastStep = now;

  if (busy()) {
    if (!cup) fail("NO_CUP");
    else if (dsnet::msSincePing() > LINK_TIMEOUT_MS) fail("LINK_LOST");
    else if (now - doseStartMs > 120000) fail("TIMEOUT");
  }

  // fake closed loop: rate chosen from the (fake) measured weight, never from time
  if (state == DOSING) {
    const char *p = phase();
    float rate = !strcmp(p, "FAST") ? 1.5f : !strcmp(p, "SLOW") ? 0.5f : 0.12f;
    weight += rate * dt;
    if (trims == 0 && weight >= target - overshoot) {
      weightAtStop = weight;
      weight += 0.03f;  // powder still falling
      state = SETTLE;
      settleUntil = now + 600;
    } else if (trims > 0) {
      state = SETTLE;
      settleUntil = now + 400;
    }
  } else if (state == SETTLE && now >= settleUntil) {
    if (weight < target - tol && trims < 6) {
      weight += 0.04f;  // one trim pulse
      trims++;
      state = DOSING;
    } else {
      finish();
    }
  } else if (state == MANUAL) {
    weight += 0.4f * dt;  // a slow, steady "spatula"
  }

  if (busy() && now - lastDoseMs >= 150) {
    lastDoseMs = now;
    JsonDocument d;
    d["evt"] = "dose";
    d["phase"] = phase();
    d["weight_g"] = roundf(weight * 100) / 100;
    d["t_ms"] = now - doseStartMs;
    if (state != MANUAL) d["stop_at_g"] = target - overshoot;
    d["vib"] = false;
    dsnet::publishEvent(d);
  }
  if (now - lastStatusMs >= 500) {
    lastStatusMs = now;
    sendStatus();
  }
  delay(5);
}
