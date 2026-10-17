#include "ui/lcd.h"

#include <Arduino.h>
#include "config.h"

#if HAS_LCD
#include <LiquidCrystal_I2C.h>
#include <Wire.h>
#include "ui/song.h"
#endif

namespace lcd {

#if HAS_LCD
static LiquidCrystal_I2C *screen = nullptr;
static uint8_t address = 0;

// PCF8574 backpacks answer at 0x20-0x27 (PCF8574) or 0x38-0x3F (PCF8574A)
static uint8_t findBackpack() {
  for (uint8_t a = 0x20; a <= 0x3F; a++) {
    if (a > 0x27 && a < 0x38) continue;
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) return a;
  }
  return 0;
}

static void writeRow(int row, const char *text) {
  char buf[LCD_COLS + 1];
  int i = 0;
  for (; i < LCD_COLS && text[i]; i++) buf[i] = text[i];
  for (; i < LCD_COLS; i++) buf[i] = ' ';  // pad: overwrites the old text, no clear() flicker
  buf[LCD_COLS] = 0;
  screen->setCursor(0, row);
  screen->print(buf);
}
#endif

void begin() {
#if HAS_LCD
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  address = findBackpack();
  if (!address) {
    Serial.println("{\"evt\":\"log\",\"msg\":\"lcd: no I2C device on SDA G21 / SCL G22\"}");
    return;
  }
  Serial.printf("{\"evt\":\"log\",\"msg\":\"lcd: found at 0x%02X\"}\n", address);
  screen = new LiquidCrystal_I2C(address, LCD_COLS, LCD_ROWS);
  screen->init();
  screen->backlight();
  show("TRSYP 3.0", "LCD ok");
#endif
}

#if HAS_LCD
static char shadow[4][21];  // what is on the glass, to send only changed cells
static bool shadowValid = false;
#endif

void createChar(uint8_t slot, const uint8_t rows[8]) {
#if HAS_LCD
  if (!screen) return;
  uint8_t r[8];
  memcpy(r, rows, 8);
  screen->createChar(slot, r);
  shadowValid = false;  // createChar moves the cursor; redraw everything once
#endif
}

void setRow(int row, const char *text) {
#if HAS_LCD
  if (!screen || row >= LCD_ROWS) return;
  if (!shadowValid) {
    for (int r = 0; r < LCD_ROWS; r++) memset(shadow[r], 0xFE, LCD_COLS);  // force a full redraw
    shadowValid = true;
  }
  // write each run of changed cells with one setCursor: I2C is slow, cells are cheap to skip
  int c = 0;
  while (c < LCD_COLS) {
    if (text[c] == shadow[row][c]) {
      c++;
      continue;
    }
    int start = c;
    while (c < LCD_COLS && text[c] != shadow[row][c]) c++;
    screen->setCursor(start, row);
    for (int i = start; i < c; i++) {
      screen->write((uint8_t)text[i]);
      shadow[row][i] = text[i];
    }
  }
#endif
}

void backlight(bool on) {
#if HAS_LCD
  if (!screen) return;
  if (on) screen->backlight();
  else screen->noBacklight();
#endif
}

bool found() {
#if HAS_LCD
  return screen != nullptr;
#else
  return false;
#endif
}

void show(const char *line1, const char *line2) {
#if HAS_LCD
  if (!screen) return;
  writeRow(0, line1);
  if (LCD_ROWS > 1) writeRow(1, line2);
#endif
}

#if HAS_LCD && LCD_SONG_TEST
// ---- word-by-word player for SONG -------------------------------------------
static constexpr size_t SONG_LEN = sizeof(SONG) / sizeof(SONG[0]);
static constexpr int MAX_WORDS = 24;

static char rows[LCD_ROWS][LCD_COLS + 1];
static int row = 0, col = 0;
static bool dirty[LCD_ROWS];

static size_t phrase = 0;
static uint32_t phraseStart = 0;
static int nWords = 0, shown = 0;
static const char *wordAt[MAX_WORDS];
static int wordLen[MAX_WORDS];
static uint32_t wordTime[MAX_WORDS];  // ms after phraseStart when the word appears

static void clearRows() {
  for (int r = 0; r < LCD_ROWS; r++) {
    memset(rows[r], ' ', LCD_COLS);
    rows[r][LCD_COLS] = 0;
    dirty[r] = true;
  }
  row = col = 0;
}

static void appendWord(const char *w, int len) {
  if (len > LCD_COLS) len = LCD_COLS;
  if (col > 0 && col + 1 + len > LCD_COLS) {  // doesn't fit: next row, scroll if full
    if (row < LCD_ROWS - 1) {
      row++;
    } else {
      for (int r = 0; r < LCD_ROWS - 1; r++) memcpy(rows[r], rows[r + 1], LCD_COLS);
      memset(rows[LCD_ROWS - 1], ' ', LCD_COLS);
      for (int r = 0; r < LCD_ROWS; r++) dirty[r] = true;
    }
    col = 0;
  }
  if (col > 0) col++;  // space before the word
  memcpy(rows[row] + col, w, len);
  col += len;
  dirty[row] = true;
}

// splits the phrase into words and spreads their start times over its duration,
// weighted by length so a long word doesn't flash by
static void startPhrase(uint32_t now) {
  phraseStart = now;
  nWords = shown = 0;
  clearRows();
  const char *p = SONG[phrase].text;
  while (*p && nWords < MAX_WORDS) {
    while (*p == ' ') p++;
    if (!*p) break;
    const char *s = p;
    while (*p && *p != ' ') p++;
    wordAt[nWords] = s;
    wordLen[nWords] = p - s;
    nWords++;
  }
  uint32_t total = 0;
  for (int i = 0; i < nWords; i++) total += wordLen[i] + 1;
  uint32_t acc = 0;
  for (int i = 0; i < nWords; i++) {
    wordTime[i] = total ? (uint64_t)SONG[phrase].ms * acc / total : 0;
    acc += wordLen[i] + 1;
  }
}

static void flushRows() {
  for (int r = 0; r < LCD_ROWS; r++) {
    if (!dirty[r]) continue;
    writeRow(r, rows[r]);
    dirty[r] = false;
  }
}
#endif

void update() {
#if HAS_LCD && LCD_SONG_TEST
  // plays SONG once from the first update() call; phrase timing is anchored to the
  // song start so LCD writes never make it drift
  static uint32_t songStart = 0;
  if (!screen || phrase >= SONG_LEN) return;
  uint32_t now = millis();
  if (!songStart) {
    songStart = now;
    startPhrase(now);
  }
  uint32_t t = now - phraseStart;
  while (shown < nWords && t >= wordTime[shown]) {
    appendWord(wordAt[shown], wordLen[shown]);
    shown++;
  }
  flushRows();
  if (SONG[phrase].ms == 0 || t < SONG[phrase].ms) return;  // last phrase (ms 0) stays
  uint32_t next = phraseStart + SONG[phrase].ms;
  if (++phrase < SONG_LEN) startPhrase(next);
#endif
}

}  // namespace lcd
