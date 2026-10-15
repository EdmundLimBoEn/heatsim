// SSTuino II Rev A (core newer than 1.1.1), or Arduino Uno; USB protocol v1.
#include <string.h>

// One passive limit switch: COM -> GND, NO -> D5. Press = Bedroom 3 purifier ON.
// Set to 0 to restore the optional two-opening WIN1/DOOR1 demonstration.
#ifndef SINGLE_PURIFIER_SWITCH
#define SINGLE_PURIFIER_SWITCH 1
#endif
const uint8_t PURIFIER_SWITCH_PIN = 5;
const bool PURIFIER_SWITCH_ACTIVE = LOW;
bool purifierRaw = HIGH, purifierStable = HIGH;
unsigned long purifierChangedAt = 0;

// Set to 1 only after checking the servo supply and calibrating with horns detached.
#define ENABLE_SERVOS 0
#if ENABLE_SERVOS
#include <Servo.h>
#endif

struct Flap {
  const char* key;
  uint8_t inputPin;
  bool limitSwitch;
  uint8_t servoPin, closedDegrees, openDegrees;
  bool open, raw, stable;
  unsigned long changedAt, movedAt;
};

// false = button toggles on press; true = limit switch pressed when flap is closed.
Flap flaps[] = {
  {"WIN1", 5, false, 9, 90, 120, false, HIGH, HIGH, 0, 0},
  {"DOOR1", 6, false, 10, 90, 120, false, HIGH, HIGH, 0, 0}
};
const size_t FLAP_COUNT = SINGLE_PURIFIER_SWITCH ? 0 : sizeof(flaps) / sizeof(flaps[0]);
const unsigned long DEBOUNCE_MS = 30;
#if ENABLE_SERVOS
Servo servos[FLAP_COUNT];
#endif

struct Setting { const char* key; uint8_t minimum, maximum, value; bool onOff; };
Setting settings[] = {
  {"FAN", 0, 1, 0, true}, {"FANANG", 0, 180, 90, false},
  {"FANPOS", 0, 9, 0, false}, {"FANSPD", 0, 3, 2, false},
  {"AC", 0, 1, 0, true}, {"PUR", 0, 1, 0, true},
  {"PURPOS", 0, 9, 0, false}, {"SCN", 1, 6, 1, false}
};
const size_t SETTING_COUNT = sizeof(settings) / sizeof(settings[0]);
const size_t PURIFIER_SETTING_INDEX = 5;
char inputLine[34];
uint8_t inputLength = 0;
bool oversized = false;

void printFlap(size_t index) {
  Serial.print(flaps[index].key);
  Serial.print(':');
  Serial.println(flaps[index].open ? 1 : 0);
}

void printSetting(size_t index) {
  Serial.print(settings[index].key);
  Serial.print(':');
  if (settings[index].onOff) Serial.println(settings[index].value ? "ON" : "OFF");
  else Serial.println(settings[index].value);
}

void moveFlap(size_t index) {
#if ENABLE_SERVOS
  Flap& flap = flaps[index];
  if (flap.limitSwitch) return;
  servos[index].attach(flap.servoPin);
  servos[index].write(flap.open ? flap.openDegrees : flap.closedDegrees);
  flap.movedAt = millis();
#endif
}

bool parseNumber(const char* text, uint8_t minimum, uint8_t maximum, uint8_t& result) {
  if (!*text) return false;
  unsigned int value = 0;
  for (const char* cursor = text; *cursor; ++cursor) {
    if (*cursor < '0' || *cursor > '9') return false;
    value = value * 10 + (*cursor - '0');
    if (value > maximum) return false;
  }
  if (value < minimum) return false;
  result = value;
  return true;
}

void handleLine(char* line) {
  if (!*line || line[0] == '#') return;
  if (strcmp(line, "HELLO") == 0) { Serial.println("HELLO:HEATSIM/1"); return; }
  if (strcmp(line, "PING") == 0) { Serial.println("PONG"); return; }
  if (strcmp(line, "GET:ALL") == 0) {
#if SINGLE_PURIFIER_SWITCH
    // Only PUR is physically owned; the app maps it to the Bedroom 3 corner.
    printSetting(PURIFIER_SETTING_INDEX);
#else
    for (size_t i = 0; i < FLAP_COUNT; ++i) printFlap(i);
    for (size_t i = 0; i < SETTING_COUNT; ++i) printSetting(i);
#endif
    Serial.println("END");
    return;
  }
  char* value = strchr(line, ':');
  if (!value) { Serial.println("ERR:UNKNOWN"); return; }
  *value++ = '\0';
  for (size_t i = 0; i < FLAP_COUNT; ++i) {
    if (strcmp(line, flaps[i].key) != 0) continue;
    if (strcmp(value, "0") != 0 && strcmp(value, "1") != 0) { Serial.println("ERR:RANGE"); return; }
    bool open = value[0] == '1';
    if (flaps[i].limitSwitch && open != flaps[i].open) {
      Serial.println("ERR:BUSY");
      printFlap(i);
      return;
    }
    flaps[i].open = open;
    moveFlap(i);
    printFlap(i);
    return;
  }
  for (size_t i = 0; i < SETTING_COUNT; ++i) {
    Setting& setting = settings[i];
    if (strcmp(line, setting.key) != 0) continue;
    uint8_t next;
    if (setting.onOff) {
      if (strcmp(value, "ON") != 0 && strcmp(value, "OFF") != 0) { Serial.println("ERR:RANGE"); return; }
      next = strcmp(value, "ON") == 0;
    } else if (!parseNumber(value, setting.minimum, setting.maximum, next)) {
      Serial.println("ERR:RANGE");
      return;
    }
#if SINGLE_PURIFIER_SWITCH
    if (i == PURIFIER_SETTING_INDEX && next != setting.value) {
      Serial.println("ERR:BUSY");
      printSetting(i);
      return;
    }
#endif
    setting.value = next;
    printSetting(i);
    return;
  }
  Serial.println("ERR:UNKNOWN");
}

void setup() {
  Serial.begin(115200);
#if SINGLE_PURIFIER_SWITCH
  pinMode(PURIFIER_SWITCH_PIN, INPUT_PULLUP);
  purifierRaw = purifierStable = digitalRead(PURIFIER_SWITCH_PIN);
  settings[PURIFIER_SETTING_INDEX].value = purifierStable == PURIFIER_SWITCH_ACTIVE;
#endif
  for (size_t i = 0; i < FLAP_COUNT; ++i) {
    Flap& flap = flaps[i];
    pinMode(flap.inputPin, INPUT_PULLUP);
    flap.raw = flap.stable = digitalRead(flap.inputPin);
    if (flap.limitSwitch) flap.open = flap.stable == HIGH;
    moveFlap(i);
  }
  Serial.println("HELLO:HEATSIM/1");
#if SINGLE_PURIFIER_SWITCH
  printSetting(PURIFIER_SETTING_INDEX);
#endif
}

void loop() {
  const unsigned long now = millis();
#if SINGLE_PURIFIER_SWITCH
  const bool purifierReading = digitalRead(PURIFIER_SWITCH_PIN);
  if (purifierReading != purifierRaw) { purifierRaw = purifierReading; purifierChangedAt = now; }
  if (purifierReading != purifierStable && now - purifierChangedAt >= DEBOUNCE_MS) {
    purifierStable = purifierReading;
    settings[PURIFIER_SETTING_INDEX].value = purifierStable == PURIFIER_SWITCH_ACTIVE;
    printSetting(PURIFIER_SETTING_INDEX);
  }
#endif
  for (size_t i = 0; i < FLAP_COUNT; ++i) {
    Flap& flap = flaps[i];
    const bool reading = digitalRead(flap.inputPin);
    if (reading != flap.raw) { flap.raw = reading; flap.changedAt = now; }
    if (reading != flap.stable && now - flap.changedAt >= DEBOUNCE_MS) {
      flap.stable = reading;
      if (flap.limitSwitch || reading == LOW) {
        flap.open = flap.limitSwitch ? reading == HIGH : !flap.open;
        moveFlap(i);
        printFlap(i);
      }
    }
#if ENABLE_SERVOS
    if (servos[i].attached() && millis() - flap.movedAt >= 600) servos[i].detach();
#endif
  }
  // Bound work per loop so a noisy serial sender cannot starve switch sampling.
  for (uint8_t budget = 0; budget < 64 && Serial.available(); ++budget) {
    char character = Serial.read();
    if (character == '\n') {
      if (inputLength && inputLine[inputLength - 1] == '\r') --inputLength;
      inputLine[inputLength] = '\0';
      if (oversized) Serial.println("ERR:RANGE");
      else handleLine(inputLine);
      inputLength = 0;
      oversized = false;
    } else if (!oversized) {
      if (inputLength >= 32 && !(inputLength == 32 && character == '\r')) oversized = true;
      else if (character != '\r' && (character < 32 || character > 126)) oversized = true;
      else inputLine[inputLength++] = character;
    }
  }
}
