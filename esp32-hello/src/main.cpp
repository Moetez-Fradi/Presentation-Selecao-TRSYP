#include <Arduino.h>
#include <HX711.h>
#include <Preferences.h>
#include "weight_filter.h"

// HX711 wiring: VCC -> 3V3, GND -> GND, DT -> G32, SCK -> G33
const int HX711_DT_PIN = 32;
const int HX711_SCK_PIN = 33;

const unsigned long PRINT_INTERVAL_MS = 250;
const unsigned long SENSOR_TIMEOUT_MS = 1000;  // HX711 gives ~10 samples/s, so 1 s of silence is a fault
const long HX711_MAX = 8388607;                // 24-bit ADC limits: hitting them means overload or bad wiring
const long HX711_MIN = -8388608;

HX711 scale;
Preferences prefs;  // keeps the calibration in flash across reboots
WeightFilter filter;

long tareOffset = 0;            // raw reading of the empty scale
float calibrationFactor = 0.0f; // raw units per gram, 0 = not calibrated
bool verbose = false;

unsigned long lastSampleMs = 0;
unsigned long lastPrintMs = 0;
bool sensorFault = false;
bool overload = false;

bool isCalibrated() { return calibrationFactor != 0.0f; }

float rawToGrams(long raw) {
  float units = raw - tareOffset;
  return isCalibrated() ? units / calibrationFactor : units;
}

void printHelp() {
  Serial.println();
  Serial.println("Commands (type in the serial monitor, then press Enter):");
  Serial.println("  t        tare: set the current load as zero (scale must be empty)");
  Serial.println("  c<grams> calibrate with a known weight on the scale, e.g. c500");
  Serial.println("  v        toggle verbose output (raw, median, filtered, noise, drift)");
  Serial.println("  r        reset calibration");
  Serial.println();
}

void tare() {
  Serial.println("Taring... keep the scale empty and still");
  tareOffset = scale.read_average(20);
  filter.reset();
  Serial.println("Done, scale is at zero");
}

void calibrate(float knownGrams) {
  if (knownGrams <= 0) {
    Serial.println("Give the known weight in grams, e.g. c500");
    return;
  }
  Serial.printf("Calibrating with %.1f g... keep it still\n", knownGrams);
  long loaded = scale.read_average(20) - tareOffset;
  if (labs(loaded) < 1000) {
    Serial.println("Calibration failed: almost no change from zero. Is the weight on the scale? Did you tare first?");
    return;
  }
  calibrationFactor = (float)loaded / knownGrams;
  prefs.putFloat("factor", calibrationFactor);
  filter.reset();
  Serial.printf("Calibrated: factor = %.3f raw units per gram (saved)\n", calibrationFactor);
}

void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  char c = tolower(cmd[0]);
  if (c == 't') {
    tare();
  } else if (c == 'c') {
    calibrate(cmd.substring(1).toFloat());
  } else if (c == 'v') {
    verbose = !verbose;
    Serial.printf("Verbose output %s\n", verbose ? "on" : "off");
  } else if (c == 'r') {
    calibrationFactor = 0.0f;
    prefs.remove("factor");
    filter.reset();
    Serial.println("Calibration reset, showing raw units");
  } else {
    printHelp();
  }
}

void readSensor() {
  if (!scale.is_ready()) {
    if (!sensorFault && millis() - lastSampleMs > SENSOR_TIMEOUT_MS) {
      sensorFault = true;
      Serial.println("ERROR: HX711 not responding. Check wiring: DT -> G32, SCK -> G33, VCC -> 3V3, GND -> GND");
    }
    return;
  }

  long raw = scale.read();
  lastSampleMs = millis();
  if (sensorFault) {
    sensorFault = false;
    Serial.println("HX711 is responding again");
  }

  overload = raw >= HX711_MAX || raw <= HX711_MIN;
  if (overload) return;  // a clipped reading says nothing about the weight, keep it out of the filter

  filter.add(rawToGrams(raw));
}

void printReading() {
  if (sensorFault) return;
  if (overload) {
    Serial.println("OVERLOAD: reading out of range (too much weight, or a load cell wire is loose)");
    return;
  }

  const char* unit = isCalibrated() ? "g" : "raw";
  const char* state = filter.stable() ? "stable" : "settling";
  if (verbose) {
    Serial.printf("%.1f %s  %s  | median=%.2f filtered=%.2f noise=%.3f drift=%.3f\n",
                  filter.weight(), unit, state, filter.rawMedian(), filter.filtered(),
                  filter.stdDev(), filter.zeroDrift());
  } else {
    Serial.printf("Weight: %.1f %s  %s\n", filter.weight(), unit, state);
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\nHX711 scale");

  prefs.begin("scale", false);
  if (prefs.isKey("factor")) calibrationFactor = prefs.getFloat("factor", 0.0f);

  scale.begin(HX711_DT_PIN, HX711_SCK_PIN);
  if (!scale.wait_ready_timeout(2000)) {
    Serial.println("ERROR: HX711 not found. Check wiring: DT -> G32, SCK -> G33, VCC -> 3V3, GND -> GND");
  }
  tare();

  if (isCalibrated()) {
    Serial.printf("Loaded calibration factor %.3f\n", calibrationFactor);
  } else {
    Serial.println("Not calibrated yet: readings are raw units. Put a known weight on and type c<grams>");
  }
  printHelp();
  lastSampleMs = millis();
}

void loop() {
  if (Serial.available()) {
    handleCommand(Serial.readStringUntil('\n'));
  }

  readSensor();

  if (millis() - lastPrintMs >= PRINT_INTERVAL_MS) {
    lastPrintMs = millis();
    printReading();
  }
}
