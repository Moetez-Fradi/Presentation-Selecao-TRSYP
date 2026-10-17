#pragma once
// Timed phrases for the LCD bench test (LCD_SONG_TEST in config.h).
// Each phrase is shown word by word, spread over its `ms` (longer words get a bit more
// time). It starts on a clear screen, wraps to the next row, and scrolls up when
// the screen is full. text "" = blank screen for `ms`. The last phrase stays on screen.
// Put your own text in the strings; keep words separated by single spaces.
#include <stdint.h>

struct Phrase {
  const char *text;
  uint32_t ms;
};

static const Phrase SONG[] = {
    {"ken 3malt dharoura ", 1500},              // 1.5 s
    {"ki trespecti l pdg respect li ylem l 9aroura", 4000},  // 4 s
    {"3ich chrara baroudaa", 1500},            // 1.5 s
    {"", 1500},                                    // blank 1.5 s
    {"lbere7 naw lioum s7at", 2000},             // 2 s
    {"rod belek marouba", 1500},             // 1.5 s
    {"", 500},                             // blank 1.5 s
    {"ma taba3hech tha3louba", 1500},  
    {"", 2000}            // 4 s
};
