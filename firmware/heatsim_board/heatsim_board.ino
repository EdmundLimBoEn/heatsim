// HeatSim protocol v2. D4: all windows; optional D3: all doors; D5: main fan.
// Each input uses INPUT_PULLUP: button/switch NO to pin, COM to GND. No motors/servos.
#include <string.h>

const uint8_t WINDOW_BUTTON_PIN = 4, DOOR_BUTTON_PIN = 3, FAN_SWITCH_PIN = 5;
const bool FAN_SWITCH_ACTIVE = LOW;
const uint32_t DEBOUNCE_MS = 30;
struct Input { uint8_t pin; bool raw, stable; uint32_t changedAt; };
Input inputsToRead[] = {{WINDOW_BUTTON_PIN, HIGH, HIGH, 0}, {DOOR_BUTTON_PIN, HIGH, HIGH, 0}, {FAN_SWITCH_PIN, HIGH, HIGH, 0}};
const char* windowKeys[] = {"WIN1", "WIN2", "WIN3", "WIN4", "WIN5", "WIN6", "WIN7", "WIN8", "WIN9", "WIN10", "WIN11"};
const char* doorKeys[] = {"DOOR1", "DOOR2", "DOOR3", "DOOR4", "DOOR5", "DOOR6", "DOOR7", "DOOR8", "DOOR9"};
const size_t WINDOW_COUNT = sizeof(windowKeys) / sizeof(windowKeys[0]);
const size_t DOOR_COUNT = sizeof(doorKeys) / sizeof(doorKeys[0]);
bool windowsOpen[WINDOW_COUNT] = {}, doorsOpen[DOOR_COUNT] = {};
struct Setting { const char* key; uint8_t minimum, maximum, value; bool onOff; };
Setting settings[] = {
  {"FAN", 0, 1, 0, true}, {"FANANG", 0, 180, 90, false},
  {"FANPOS", 0, 4, 0, false}, {"FANSPD", 0, 3, 2, false},
  {"AC", 0, 1, 0, true}, {"PUR", 0, 1, 0, true},
  {"PURPOS", 0, 5, 0, false}, {"SCN", 1, 6, 1, false}
};
const size_t SETTING_COUNT = sizeof(settings) / sizeof(settings[0]);
char inputLine[34];
uint8_t inputLength = 0;
bool oversized = false;
void printOpening(const char* key, bool open) {
  Serial.print(key); Serial.print(':'); Serial.println(open ? 1 : 0);
}
void printSetting(size_t index) {
  Serial.print(settings[index].key); Serial.print(':');
  if (settings[index].onOff) Serial.println(settings[index].value ? "ON" : "OFF");
  else Serial.println(settings[index].value);
}
void printState() {
  for (size_t i = 0; i < WINDOW_COUNT; ++i) printOpening(windowKeys[i], windowsOpen[i]);
  for (size_t i = 0; i < DOOR_COUNT; ++i) printOpening(doorKeys[i], doorsOpen[i]);
  printSetting(0);
}
void toggleGroup(const char* const* keys, bool* states, size_t count) {
  bool allOpen = true;
  for (size_t i = 0; i < count; ++i) allOpen = allOpen && states[i];
  for (size_t i = 0; i < count; ++i) { states[i] = !allOpen; printOpening(keys[i], states[i]); }
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
  if (strcmp(line, "HELLO") == 0) { Serial.println("HELLO:HEATSIM/2"); return; }
  if (strcmp(line, "PING") == 0) { Serial.println("PONG"); return; }
  if (strcmp(line, "GET:ALL") == 0) { printState(); Serial.println("END"); return; }
  char* value = strchr(line, ':');
  if (!value) { Serial.println("ERR:UNKNOWN"); return; }
  *value++ = '\0';
  for (size_t group = 0; group < 2; ++group) {
    const char* const* keys = group == 0 ? windowKeys : doorKeys;
    bool* states = group == 0 ? windowsOpen : doorsOpen;
    const size_t count = group == 0 ? WINDOW_COUNT : DOOR_COUNT;
    for (size_t i = 0; i < count; ++i) {
      if (strcmp(line, keys[i]) != 0) continue;
      if (strcmp(value, "0") != 0 && strcmp(value, "1") != 0) { Serial.println("ERR:RANGE"); return; }
      states[i] = value[0] == '1'; printOpening(keys[i], states[i]); return;
    }
  }
  for (size_t i = 0; i < SETTING_COUNT; ++i) {
    Setting& setting = settings[i];
    if (strcmp(line, setting.key) != 0) continue;
    uint8_t next;
    if (setting.onOff) {
      if (strcmp(value, "ON") != 0 && strcmp(value, "OFF") != 0) { Serial.println("ERR:RANGE"); return; }
      next = strcmp(value, "ON") == 0;
    } else if (!parseNumber(value, setting.minimum, setting.maximum, next)) { Serial.println("ERR:RANGE"); return; }
    if (i == 0 && next != setting.value) { Serial.println("ERR:BUSY"); printSetting(0); return; }
    setting.value = next; printSetting(i); return;
  }
  Serial.println("ERR:UNKNOWN");
}
void setup() {
  Serial.begin(115200);
  for (size_t i = 0; i < 3; ++i) {
    Input& input = inputsToRead[i];
    pinMode(input.pin, INPUT_PULLUP);
    input.raw = input.stable = digitalRead(input.pin); input.changedAt = millis();
  }
  for (size_t i = 0; i < WINDOW_COUNT; ++i) windowsOpen[i] = false;
  for (size_t i = 0; i < DOOR_COUNT; ++i) doorsOpen[i] = false;
  settings[0].value = inputsToRead[2].stable == FAN_SWITCH_ACTIVE;
  Serial.println("HELLO:HEATSIM/2"); printState(); Serial.println("END");
}
void loop() {
  const uint32_t now = millis();
  for (size_t i = 0; i < 3; ++i) {
    Input& input = inputsToRead[i]; const bool reading = digitalRead(input.pin);
    if (reading != input.raw) { input.raw = reading; input.changedAt = now; }
    if (reading == input.stable || uint32_t(now - input.changedAt) < DEBOUNCE_MS) continue;
    input.stable = reading;
    if (i == 2) { settings[0].value = reading == FAN_SWITCH_ACTIVE; printSetting(0); }
    else if (reading == LOW) {
      if (i == 0) toggleGroup(windowKeys, windowsOpen, WINDOW_COUNT);
      else toggleGroup(doorKeys, doorsOpen, DOOR_COUNT);
    }
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
