#include "control/doser.h"

#include <Arduino.h>
#include "actuators/auger.h"
#include "config.h"
#include "net/ds_net.h"
#include "sensors/inputs.h"
#include "sensors/scale.h"
#include "sensors/ultrasonic.h"
#include "ui/display.h"
#include "ui/led.h"

namespace doser {

// CHECKS = auto-tare before the dose starts
enum State { IDLE, CHECKS, DOSING, SETTLE, MANUAL, DONE, ERROR_ };
static const char *STATE_NAME[] = {"IDLE", "CHECKS", "DOSING", "SETTLE", "MANUAL", "DONE", "ERROR"};

struct Job {
  String recipeId, materialId, sampleId, method, tStart;
  float target = 0, tol = 0, overshoot = 0;
};

static State state = IDLE;
static Job job;
static uint32_t doseStartMs = 0, settleStartMs = 0, lastStatusMs = 0, lastDoseMs = 0;
static uint32_t lastRiseMs = 0;
static float lastRiseG = 0, weightAtStop = 0, measuredOvershoot = 0;
static int trims = 0;
static View snap;  // published at the end of every update()
static portMUX_TYPE snapMux = portMUX_INITIALIZER_UNLOCKED;
static char lastStatus[12] = "", lastSample[24] = "", lastError[16] = "";
static float lastMeasured = 0, lastDev = 0;
static uint32_t vibOffAt = 0;  // bench "vib" command

static float round2(float x) { return roundf(x * 100) / 100; }
static bool busy() { return state == CHECKS || state == DOSING || state == SETTLE || state == MANUAL; }
static bool manual() { return job.method == "manual"; }

static const char *phase() {
  if (state == MANUAL) return "MANUAL";
  if (state == SETTLE) return "SETTLE";
  if (trims > 0) return "TRIM";
  float w = scale::grams();
  if (w < FAST_UNTIL * job.target) return "FAST";
  if (w < SLOW_UNTIL * job.target) return "SLOW";
  return "FINE";
}

static auger::Speed speedFor(const char *p) {
  if (!strcmp(p, "FAST")) return auger::Speed::Fast;
  if (!strcmp(p, "SLOW")) return auger::Speed::Slow;
  return auger::Speed::Fine;
}

// ---- outgoing ----------------------------------------------------------------

static void sendStatus() {
  JsonDocument d;
  d["evt"] = "status";
  d["state"] = STATE_NAME[state];
  d["weight_g"] = round2(scale::grams());
  d["cup"] = inputs::cupPresent();
  d["vib"] = vibrator::on();
  d["cup_raw"] = inputs::cupRaw();
  d["cup_flips"] = inputs::cupFlips();
  d["hopper_ok"] = inputs::hopperOk();
  if (inputs::hopperPct() >= 0) d["hopper_pct"] = inputs::hopperPct();
  if (inputs::hopperMm() >= 0) d["hopper_mm"] = roundf(inputs::hopperMm());
  d["hopper_cal"] = inputs::hopperCalibrated();
  d["us_edges"] = ultrasonic::edges();
  d["us_width"] = ultrasonic::lastWidthUs();
  d["power_ok"] = inputs::powerOk();
  d["tare_ok"] = busy() || scale::tared();
  // diagnostics (ignored by the dashboard UI, visible in the raw log)
  d["stable"] = scale::stable();
  d["scale_fault"] = scale::fault() || scale::overload();
  d["raw"] = scale::raw();
  d["auger"] = auger::fitted();
  d["cal_factor"] = roundf(scale::factor() * 1000) / 1000;
  d["calibrated"] = scale::calibrated();
  d["calibrating"] = scale::calibrating();
  dsnet::publishStatus(d);
}

static void sendDose() {
  JsonDocument d;
  d["evt"] = "dose";
  d["phase"] = phase();
  d["weight_g"] = round2(scale::grams());
  d["t_ms"] = millis() - doseStartMs;
  if (!manual()) d["stop_at_g"] = round2(job.target - job.overshoot);
  d["vib"] = vibrator::on();
  dsnet::publishEvent(d);
}

static void finish(const char *errorCode = nullptr) {
  auger::stop();
  vibrator::set(false);
  float measured = scale::grams();
  float dev = measured - job.target;

  JsonDocument r;
  r["evt"] = "result";
  r["run_id"] = job.sampleId + "-" + String(millis() % 1000000UL, 36);
  r["recipe_id"] = job.recipeId;
  r["material_id"] = job.materialId;
  r["sample_id"] = job.sampleId;
  r["method"] = job.method;
  r["target_g"] = job.target;
  r["tol_g"] = job.tol;
  r["measured_g"] = round2(measured);
  r["dev_g"] = round2(dev);
  r["status"] = errorCode ? "INCOMPLETE" : (fabsf(dev) <= job.tol + 1e-4f ? "ACCEPTED" : "REJECTED");
  r["overshoot_g"] = roundf(measuredOvershoot * 1000) / 1000;
  r["trim_steps"] = trims;
  r["t_start"] = job.tStart;
  r["t_end"] = dsnet::isoNow();
  r["duration_ms"] = millis() - doseStartMs;
  if (errorCode) r["error"] = errorCode;
  // TODO(storage): append to LittleFS /log.jsonl here, BEFORE publishing
  dsnet::publishResult(r);

  strlcpy(lastStatus, r["status"] | "", sizeof(lastStatus));
  strlcpy(lastSample, job.sampleId.c_str(), sizeof(lastSample));
  strlcpy(lastError, errorCode ? errorCode : "", sizeof(lastError));
  lastMeasured = measured;
  lastDev = dev;
  if (!errorCode && fabsf(dev) <= job.tol + 1e-4f) led::accepted();
  else led::rejected();
  state = errorCode ? ERROR_ : DONE;
  sendStatus();
}

static void fail(const char *code) {
  JsonDocument d;
  d["evt"] = "error";
  d["code"] = code;
  d["phase"] = phase();
  d["weight_g"] = round2(scale::grams());
  dsnet::publishEvent(d);
  finish(code);
}

static void toSettle() {
  auger::stop();
  vibrator::set(false);
  state = SETTLE;
  settleStartMs = millis();
}

// ---- commands ----------------------------------------------------------------

static const char *startBlocker() {
  if (scale::fault() || scale::overload()) return "SCALE_FAULT";
  if (!inputs::powerOk()) return "POWER_OFF";
  if (!inputs::cupPresent()) return "NO_CUP";
  if (!inputs::hopperOk()) return "HOPPER_EMPTY";
  return nullptr;
}

void handle(JsonDocument &c) {
  const char *cmd = c["cmd"] | "";

  if (!strcmp(cmd, "status")) return sendStatus();

  if (!strcmp(cmd, "tare")) {
    if (busy()) return dsnet::ack(cmd, false, "busy");
    scale::tare();
    if (state == DONE || state == ERROR_) state = IDLE;
    dsnet::ack(cmd, true);
    return sendStatus();
  }

  // calibration: tare with the platform empty, put a known mass on, then
  // {"cmd":"calibrate","mass_g":100}. The result arrives as {"evt":"calib",...}.
  if (!strcmp(cmd, "calibrate")) {
    if (busy()) return dsnet::ack(cmd, false, "busy");
    const char *why = nullptr;
    if (!scale::calibrate(c["mass_g"] | 0.0f, &why)) return dsnet::ack(cmd, false, why);
    dsnet::ack(cmd, true);
    return sendStatus();
  }

  // hopper level calibration: {"cmd":"hopper_cal","point":"empty"} then "full"
  if (!strcmp(cmd, "hopper_cal")) {
    const char *why = nullptr;
    bool empty = strcmp(c["point"] | "", "full") != 0;
    if (!inputs::hopperSetPoint(empty, &why)) return dsnet::ack(cmd, false, why);
    dsnet::ack(cmd, true, empty ? "empty saved" : "full saved");
    return sendStatus();
  }

  if (!strcmp(cmd, "cal_reset")) {
    if (busy()) return dsnet::ack(cmd, false, "busy");
    scale::resetCalibration();
    dsnet::ack(cmd, true);
    return sendStatus();
  }

  // bench tests, idle only: {"cmd":"jog","steps":400,"sps":500} and {"cmd":"vib","ms":1000}
  if (!strcmp(cmd, "jog")) {
    if (busy()) return dsnet::ack(cmd, false, "busy");
    int steps = constrain((int)(c["steps"] | 0), -4000, 4000);
    uint32_t sps = constrain((int)(c["sps"] | (int)AUGER_FAST_SPS), 20, 2000);
    float before = scale::grams();
    auger::jog(steps, sps);
    JsonDocument d;
    d["evt"] = "jog";
    d["steps"] = steps;
    d["sps"] = sps;
    d["before_g"] = round2(before);
    dsnet::publishEvent(d);
    return dsnet::ack(cmd, true);
  }
  // vibrator, idle only: {"cmd":"vib","on":true,"ms":3000} runs for ms (0 = until "on":false);
  // capped at VIB_MAX_MS so a forgotten "on" can't run the motor forever
  if (!strcmp(cmd, "vib")) {
    if (busy()) return dsnet::ack(cmd, false, "busy");
    bool on = c["on"] | true;
    uint32_t ms = c["ms"] | 0;
    vibrator::set(on);
    vibOffAt = on ? millis() + (ms ? min(ms, VIB_MAX_MS) : VIB_MAX_MS) : 0;
    dsnet::ack(cmd, true);
    return sendStatus();
  }

  // show a message on the station's LCD: {"cmd":"lcd","text":"Welcome|judges!","ms":5000}
  if (!strcmp(cmd, "lcd")) {
    display::message(c["text"] | "", constrain((int)(c["ms"] | 5000), 500, 60000));
    return dsnet::ack(cmd, true);
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
    if (scale::calibrating()) return dsnet::ack(cmd, false, "calibrating");
    if (const char *b = startBlocker()) {
      dsnet::ack(cmd, false, b);
      return dsnet::error(b);
    }
    job.recipeId = c["recipe_id"] | "";
    job.materialId = c["material_id"] | "";
    job.sampleId = c["sample_id"] | "";
    job.method = c["method"] | "auto";
    job.target = c["target_g"] | 0.0f;
    job.tol = c["tol_g"] | 0.1f;
    job.overshoot = c["overshoot_g"] | 0.2f;
    if (job.target <= 0 || job.tol <= 0) return dsnet::ack(cmd, false, "bad target/tolerance");
    // overshoot = powder still falling after the stop: never negative, never a big share of
    // the target. Clamped so a bad learned value can't move the stop threshold past the target.
    job.overshoot = constrain(job.overshoot, 0.0f, min(MAX_OVERSHOOT_G, 0.2f * job.target));

    trims = 0;
    measuredOvershoot = 0;
    weightAtStop = 0;
    doseStartMs = millis();
    job.tStart = dsnet::isoNow();
    scale::tare();  // tare before every dose; dosing starts once it is done
    state = CHECKS;
    dsnet::ack(cmd, true);
    return sendStatus();
  }

  dsnet::ack(cmd, false, "unknown command");
}

// ---- loop ----------------------------------------------------------------------

void begin() {
  state = IDLE;
}

static void publishView() {
  View v;
  strlcpy(v.state, STATE_NAME[state], sizeof(v.state));
  strlcpy(v.phase, busy() && state != CHECKS ? phase() : "", sizeof(v.phase));
  strlcpy(v.sample, job.sampleId.c_str(), sizeof(v.sample));
  v.weight = scale::grams();
  v.stable = scale::stable();
  v.target = job.target;
  v.tol = job.tol;
  v.trims = trims;
  strlcpy(v.lastStatus, lastStatus, sizeof(v.lastStatus));
  strlcpy(v.lastSample, lastSample, sizeof(v.lastSample));
  strlcpy(v.lastError, lastError, sizeof(v.lastError));
  v.lastMeasured = lastMeasured;
  v.lastDev = lastDev;
  v.calibrating = scale::calibrating();
  portENTER_CRITICAL(&snapMux);
  snap = v;
  portEXIT_CRITICAL(&snapMux);
}

void update() {
  uint32_t now = millis();
  if (vibOffAt && (int32_t)(now - vibOffAt) >= 0) {
    vibOffAt = 0;
    if (!busy()) vibrator::set(false);
    sendStatus();
  }

  scale::CalResult cal;
  if (scale::takeCalResult(cal)) {
    JsonDocument d;
    d["evt"] = "calib";
    d["ok"] = cal.ok;
    d["factor"] = cal.factor;
    d["mass_g"] = cal.massG;
    d["msg"] = cal.msg;
    dsnet::publishEvent(d);
    sendStatus();
  }

  if (busy()) {
    if (!inputs::cupPresent()) return fail("NO_CUP");
    if (!inputs::powerOk()) return fail("POWER_OFF");
    if (scale::fault() || scale::overload()) return fail("SCALE_FAULT");
    if (dsnet::msSincePing() > LINK_TIMEOUT_MS) return fail("LINK_LOST");
    if (now - doseStartMs > DOSE_TIMEOUT_MS) return fail("TIMEOUT");
  }

  switch (state) {
    case CHECKS:
      if (!scale::taring()) {
        state = manual() ? MANUAL : DOSING;
        lastRiseMs = now;
        lastRiseG = 0;
        sendStatus();
      }
      break;

    case DOSING: {
      float w = scale::grams();
      if (trims > 0) {
        // one trim pulse of a few microsteps, then settle and measure again
        auger::trimPulse(AUGER_TRIM_STEPS);
        toSettle();
        break;
      }
      if (w >= job.target - job.overshoot) {
        weightAtStop = w;
        toSettle();
        break;
      }
      const char *p = phase();
      auger::run(speedFor(p));

      if (auger::fitted()) {
        // no flow: the auger turns but the weight does not rise
        if (w > lastRiseG + NO_FLOW_RISE_G) {
          lastRiseG = w;
          lastRiseMs = now;
        }
        uint32_t stalled = now - lastRiseMs;
#if AUTO_VIBRATE
        vibrator::set(strcmp(p, "FINE") != 0 && stalled > 600);  // never in the fine phase
#endif
        if (stalled > NO_FLOW_MS) return fail(inputs::hopperOk() ? "NO_FLOW" : "HOPPER_EMPTY");
      }
      break;
    }

    case SETTLE: {
      uint32_t t = now - settleStartMs;
      if (t < SETTLE_MIN_MS || (!scale::stable() && t < SETTLE_MAX_MS)) break;
      float m = scale::grams();
      if (trims == 0) measuredOvershoot = m - weightAtStop;
      if (m < job.target - job.tol && trims < MAX_TRIMS) {
        trims++;
        state = DOSING;
      } else {
        finish();
      }
      break;
    }

    default:
      break;
  }

  if ((state == DOSING || state == SETTLE || state == MANUAL) && now - lastDoseMs >= DOSE_PERIOD_MS) {
    lastDoseMs = now;
    sendDose();
  }
  if (now - lastStatusMs >= STATUS_PERIOD_MS) {
    lastStatusMs = now;
    sendStatus();
  }
  publishView();
}

void view(View &out) {
  portENTER_CRITICAL(&snapMux);
  out = snap;
  portEXIT_CRITICAL(&snapMux);
}

}  // namespace doser
