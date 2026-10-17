#include "ui/display.h"

#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include "config.h"
#include "control/doser.h"
#include "net/ds_net.h"
#include "sensors/inputs.h"
#include "sensors/scale.h"
#include "ui/lcd.h"

namespace display {

#if HAS_LCD && !LCD_SONG_TEST

// ---- custom glyphs ------------------------------------------------------------
// Stored in CGRAM slots 0-7 but written as codes 8-15 (same glyphs), so a row
// buffer never contains a 0 byte.
enum : char { BAR1 = 8, BAR2, BAR3, BAR4, CHECK, CROSS, WIFI, HOURGLASS };
static const char FULL = (char)0xFF;  // full block, built into the HD44780 ROM

static const uint8_t GLYPHS[8][8] = {
    {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x10},  // bar 1/5
    {0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18},  // bar 2/5
    {0x1C, 0x1C, 0x1C, 0x1C, 0x1C, 0x1C, 0x1C, 0x1C},  // bar 3/5
    {0x1E, 0x1E, 0x1E, 0x1E, 0x1E, 0x1E, 0x1E, 0x1E},  // bar 4/5
    {0x00, 0x00, 0x02, 0x02, 0x14, 0x08, 0x00, 0x00},  // check: narrow, right column empty
    {0x00, 0x00, 0x14, 0x08, 0x14, 0x00, 0x00, 0x00},  // cross: narrow, right columns empty
    {0x00, 0x0E, 0x11, 0x04, 0x0A, 0x00, 0x04, 0x00},  // wifi
    {0x1F, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x1F, 0x00},  // hourglass
};

static const char *SAVER_TEXT = "TRSYP 3.0  *  Laboratory 4.0  *  Weigh. Dose. Verify. Trace.  *  ";
static const uint32_t BOOT_MS = 2600;
static const uint32_t PAGE_MS = 3000;
static const uint32_t SAVER_AFTER_MS = 60000;

static const int W = LCD_COLS;
static char row0[W + 1], row1[W + 1];

// message from the dashboard
static portMUX_TYPE msgMux = portMUX_INITIALIZER_UNLOCKED;
static char msgText[96] = "";
static uint32_t msgUntil = 0;
static bool msgNew = false;

static uint32_t blinkUntil = 0;  // backlight blinking while millis() < blinkUntil

// ---- row helpers ----------------------------------------------------------------
static void clear(char *r) {
  memset(r, ' ', W);
  r[W] = 0;
}
static void put(char *r, int col, const char *s) {
  for (int i = 0; s[i] && col + i < W; i++)
    if (col + i >= 0) r[col + i] = s[i];
}
static void putRight(char *r, const char *s) { put(r, W - (int)strlen(s), s); }
static void center(char *r, const char *s) { put(r, (W - (int)strlen(s)) / 2, s); }

// text scrolling right-to-left through the whole row
static void marquee(char *r, const char *s, uint32_t now, uint32_t stepMs = 280) {
  int len = strlen(s);
  if (len <= W) {
    put(r, 0, s);
    return;
  }
  int span = len + 4;
  int off = (now / stepMs) % span;
  for (int i = 0; i < W; i++) {
    int k = (off + i) % span;
    r[i] = k < len ? s[k] : ' ';
  }
}

// smooth progress bar: 5 sub-steps per cell
static void bar(char *r, float frac) {
  if (frac < 0) frac = 0;
  bool over = frac > 1.0f;
  if (over) frac = 1;
  int units = (int)(frac * W * 5 + 0.5f);
  for (int i = 0; i < W; i++) {
    int u = units - i * 5;
    r[i] = u >= 5 ? FULL : u <= 0 ? ' ' : (char)(BAR1 + u - 1);
  }
  if (over) r[W - 1] = '>';
}

static void fmtGrams(char *out, size_t n, float g) {
  if (fabsf(g) < 999.995f) snprintf(out, n, "%.2f", g);
  else snprintf(out, n, "%.0f", g);
}

static const char *errorText(const char *code) {
  if (!strcmp(code, "NO_CUP")) return "Cup removed - motor stopped";
  if (!strcmp(code, "NO_FLOW")) return "No flow - shake hopper from dashboard, then retry";
  if (!strcmp(code, "HOPPER_EMPTY")) return "Hopper empty - refill";
  if (!strcmp(code, "POWER_OFF")) return "12 V supply is off";
  if (!strcmp(code, "TIMEOUT")) return "Dose took too long";
  if (!strcmp(code, "ABORTED")) return "Stopped from the dashboard";
  if (!strcmp(code, "LINK_LOST")) return "Dashboard link lost - motor stopped";
  if (!strcmp(code, "SCALE_FAULT")) return "Load cell fault - check HX711";
  return "Error";
}

// ---- screens ----------------------------------------------------------------------
static void drawBoot(uint32_t) {
  center(row0, "TRSYP 3.0");
  center(row1, "SELECAO");
}

static void drawMessage(uint32_t now) {
  char text[96];
  portENTER_CRITICAL(&msgMux);
  strlcpy(text, msgText, sizeof(text));
  portEXIT_CRITICAL(&msgMux);
  char *split = strchr(text, '|');
  if (split) {
    *split = 0;
    marquee(row0, text, now);
    marquee(row1, split + 1, now);
  } else if ((int)strlen(text) <= W) {
    center(row0, text);
  } else {
    marquee(row0, text, now);
  }
}

static void drawIdle(const doser::View &v, uint32_t now, uint32_t idleSinceMs) {
  char w[16];
  fmtGrams(w, sizeof(w), v.weight);
  char right[20];
  snprintf(right, sizeof(right), "%s g", w);

  bool cup = inputs::cupPresent(), tared = scale::tared(), net = dsnet::brokerUp();
  bool saver = cup && net && now - idleSinceMs > SAVER_AFTER_MS;

  if (saver) {
    marquee(row0, SAVER_TEXT, now, 300);
    putRight(row1, right);
    row1[0] = v.stable ? CHECK : HOURGLASS;
    return;
  }

  if (v.calibrating) {
    put(row0, 0, "CALIBRATING");
    row0[W - 1] = (now / 400) % 2 ? HOURGLASS : ' ';
    putRight(row1, right);
    return;
  }

  put(row0, 0, !strcmp(v.state, "IDLE") ? "READY" : v.state);
  putRight(row0, right);

  // row 2: rotating pages; a failing check stays pinned
  char line[24];
  bool problem = !cup || !net;
  int page = problem ? 0 : (now / PAGE_MS) % 4;
  if (page == 1 && !v.lastStatus[0]) page = 0;
  time_t tnow = time(nullptr);
  if (page == 3 && tnow < 1700000000) page = 2;

  switch (page) {
    case 0:
      snprintf(line, sizeof(line), "%cCup %cTare %cNet", cup ? CHECK : CROSS, tared ? CHECK : CROSS, net ? CHECK : CROSS);
      put(row1, 0, line);
      break;
    case 1: {
      char m[16];
      fmtGrams(m, sizeof(m), v.lastMeasured);
      snprintf(line, sizeof(line), "Last%c %s g", strcmp(v.lastStatus, "ACCEPTED") ? CROSS : CHECK, m);
      put(row1, 0, line);
      break;
    }
    case 2:
      if (dsnet::wifiUp()) {
        row1[0] = WIFI;
        String ssid = WiFi.SSID();
        put(row1, 2, ssid.substring(0, W - 7).c_str());
        snprintf(line, sizeof(line), "%d", (int)WiFi.RSSI());
        putRight(row1, line);
      } else {
        put(row1, 0, "WiFi connecting");
      }
      break;
    case 3: {
      struct tm lt;
      localtime_r(&tnow, &lt);
      strftime(line, sizeof(line), "%H:%M:%S", &lt);
      put(row1, 0, line);
      putRight(row1, "TRSYP");
      break;
    }
  }
}

static void drawDosing(const doser::View &v, uint32_t now) {
  char label[8];
  if (!strcmp(v.state, "SETTLE")) strcpy(label, v.trims ? "TRIM" : "WAIT");
  else if (!strcmp(v.state, "MANUAL")) strcpy(label, "HAND");
  else strlcpy(label, v.phase, sizeof(label));
  if (!strcmp(label, "TRIM") && v.trims) snprintf(label, sizeof(label), "TRIM%d", v.trims);
  put(row0, 0, label);

  char w[12], t[12], right[24];
  fmtGrams(w, sizeof(w), v.weight);
  fmtGrams(t, sizeof(t), v.target);
  snprintf(right, sizeof(right), "%s/%s", w, t);
  putRight(row0, right);

  bar(row1, v.target > 0 ? v.weight / v.target : 0);
  // settling: a "breathing" last cell so it is obvious the machine is waiting, not stuck
  if (!strcmp(v.state, "SETTLE") && (now / 300) % 2) row1[W - 1] = HOURGLASS;
}

static void drawChecks(const doser::View &v, uint32_t now) {
  put(row0, 0, "TARING");
  row0[W - 1] = (now / 400) % 2 ? HOURGLASS : ' ';
  put(row1, 0, v.sample);
}

static void drawResult(const doser::View &v, uint32_t now) {
  bool ok = !strcmp(v.lastStatus, "ACCEPTED");
  row0[0] = ok ? CHECK : CROSS;
  put(row0, 2, v.lastStatus[0] ? v.lastStatus : "DONE");
  char d[12];
  snprintf(d, sizeof(d), "%+.2f", v.lastDev);
  putRight(row0, d);

  char m[12], line[28];
  if ((now / PAGE_MS) % 2 == 0) {
    fmtGrams(m, sizeof(m), v.lastMeasured);
    put(row1, 0, v.lastSample);
    snprintf(line, sizeof(line), " %s g", m);
    putRight(row1, line);
  } else {
    fmtGrams(m, sizeof(m), v.weight);
    put(row1, 0, "Now");
    snprintf(line, sizeof(line), "%s g", m);
    putRight(row1, line);
  }
}

static void drawError(const doser::View &v, uint32_t now) {
  row0[0] = CROSS;
  put(row0, 2, v.lastError[0] ? v.lastError : "ERROR");
  marquee(row1, errorText(v.lastError), now, 250);
}

// ---- task -------------------------------------------------------------------------
static void task(void *) {
  for (int i = 0; i < 8; i++) lcd::createChar(i, GLYPHS[i]);
  uint32_t start = millis();
  char lastState[8] = "";
  float idleRef = 0;
  uint32_t idleSince = millis();
  bool lightOn = true;
  float shown = 0;
  uint32_t shownAt = 0;

  for (;;) {
    uint32_t now = millis();
    doser::View v;
    doser::view(v);

    // calm number: refresh at most 2x/s when idle (4x/s while dosing), ignore tiny wiggles
    bool dosing = !strcmp(v.state, "DOSING") || !strcmp(v.state, "SETTLE") || !strcmp(v.state, "MANUAL");
    uint32_t period = dosing ? 250 : 500;
    float band = dosing ? 0.0f : 0.03f;
    if (now - shownAt >= period && fabsf(v.weight - shown) >= band) {
      shown = v.weight;
      shownAt = now;
    }
    v.weight = shown;

    // state entry effects
    if (strcmp(v.state, lastState)) {
      if (!strcmp(v.state, "ERROR")) blinkUntil = now + 1500;
      if (!strcmp(v.state, "DONE") && strcmp(v.lastStatus, "ACCEPTED")) blinkUntil = now + 900;
      strlcpy(lastState, v.state, sizeof(lastState));
      idleSince = now;
      idleRef = v.weight;
    }
    // any real change on the scale wakes the screensaver
    if (fabsf(v.weight - idleRef) > 0.5f) {
      idleRef = v.weight;
      idleSince = now;
    }

    bool showMsg;
    portENTER_CRITICAL(&msgMux);
    showMsg = (int32_t)(msgUntil - now) > 0;
    if (msgNew) {
      msgNew = false;
      blinkUntil = now + 800;
      idleSince = now;
    }
    portEXIT_CRITICAL(&msgMux);

    clear(row0);
    clear(row1);
    if (now - start < BOOT_MS) drawBoot(now - start);
    else if (showMsg) drawMessage(now);
    else if (!strcmp(v.state, "CHECKS")) drawChecks(v, now);
    else if (!strcmp(v.state, "DOSING") || !strcmp(v.state, "SETTLE") || !strcmp(v.state, "MANUAL")) drawDosing(v, now);
    else if (!strcmp(v.state, "DONE")) drawResult(v, now);
    else if (!strcmp(v.state, "ERROR")) drawError(v, now);
    else drawIdle(v, now, idleSince);

    lcd::setRow(0, row0);
    if (LCD_ROWS > 1) lcd::setRow(1, row1);

    bool light = (int32_t)(blinkUntil - now) > 0 ? (now / 150) % 2 : true;
    if (light != lightOn) {
      lcd::backlight(light);
      lightOn = light;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
#endif

void begin() {
#if HAS_LCD && !LCD_SONG_TEST
  if (!lcd::found()) return;
  setenv("TZ", "<+01>-1", 1);  // Tunisia, UTC+1 all year
  tzset();
  xTaskCreatePinnedToCore(task, "display", 4096, nullptr, 1, nullptr, 0);
#endif
}

void message(const char *text, uint32_t ms) {
#if HAS_LCD && !LCD_SONG_TEST
  portENTER_CRITICAL(&msgMux);
  strlcpy(msgText, text, sizeof(msgText));
  msgUntil = millis() + ms;
  msgNew = true;
  portEXIT_CRITICAL(&msgMux);
#else
  (void)text;
  (void)ms;
#endif
}

}  // namespace display
