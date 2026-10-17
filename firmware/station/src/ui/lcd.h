#pragma once
// Character LCD on the I2C bus (PCF8574 backpack). With HAS_LCD = 0 these do nothing.
#include <stdint.h>

namespace lcd {

void begin();                                // scans I2C, finds the backpack, inits the screen
void update();                               // call every loop (drives the timed-lines test)
void show(const char *line1, const char *line2 = "");  // pads/cuts to LCD_COLS
bool found();

// For the display task (ui/display): call from one task only.
void createChar(uint8_t slot, const uint8_t rows[8]);  // custom glyph 0..7
void setRow(int row, const char *text);  // exactly LCD_COLS chars; only changed cells are sent
void backlight(bool on);

}  // namespace lcd
