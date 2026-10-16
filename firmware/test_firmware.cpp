#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>

constexpr bool HIGH = true, LOW = false;
constexpr int INPUT_PULLUP = 2;
unsigned long nowMs = 0;
bool inputs[20];
unsigned long millis() { return nowMs; }
void pinMode(uint8_t, int) {}
bool digitalRead(uint8_t pin) { return inputs[pin]; }
struct MockSerial {
  std::string input, output;
  unsigned long baud = 0;
  void begin(unsigned long value) { baud = value; }
  int available() { return input.size(); }
  char read() { char value = input[0]; input.erase(0, 1); return value; }
  template<class T> void print(T value) { std::ostringstream text; text << value; output += text.str(); }
  void print(uint8_t value) { print(static_cast<int>(value)); }
  template<class T> void println(T value) { print(value); output += '\n'; }
} Serial;
#include "heatsim_board/heatsim_board.ino"

std::string exchange(const std::string& input) {
  Serial.output.clear();
  Serial.input = input;
  do { loop(); } while (Serial.available());
  return Serial.output;
}

std::string groupLines(const char* const* keys, size_t count, bool open) {
  std::string out;
  for (size_t i = 0; i < count; ++i) out += std::string(keys[i]) + (open ? ":1\n" : ":0\n");
  return out;
}
void settle(uint8_t pin, bool state) { inputs[pin] = state; loop(); nowMs += 30; loop(); }
int main() {
  for (bool& input : inputs) input = HIGH;
  setup();
  assert(Serial.baud == 115200);
  const auto windows = [](bool on) { return groupLines(windowKeys, WINDOW_COUNT, on); };
  const auto doors = [](bool on) { return groupLines(doorKeys, DOOR_COUNT, on); };
  assert(Serial.output == "HELLO:HEATSIM/2\n" + windows(false) + doors(false) + "FAN:OFF\nEND\n");
  assert(exchange("PING\nHELLO\r\n") == "PONG\nHELLO:HEATSIM/2\n");
  assert(exchange("GET:ALL\n") == windows(false) + doors(false) + "FAN:OFF\nEND\n");
  assert(exchange("FAN:ON\n") == "ERR:BUSY\nFAN:OFF\n");
  assert(exchange("PUR:ON\n") == "PUR:ON\n");
  // All button groups debounce, toggle once, and accept mixed on-screen states.
  for (size_t group = 0; group < 2; ++group) {
    const uint8_t pin = group == 0 ? WINDOW_BUTTON_PIN : DOOR_BUTTON_PIN;
    const auto opened = group == 0 ? windows(true) : doors(true);
    const auto closed = group == 0 ? windows(false) : doors(false);
    Serial.output.clear();
    inputs[pin] = LOW; loop(); nowMs += 8; inputs[pin] = HIGH; loop();
    nowMs += 8; inputs[pin] = LOW; loop(); nowMs += 29; loop(); assert(Serial.output.empty());
    nowMs += 1; loop(); assert(Serial.output == opened);
    nowMs += 100; loop(); assert(Serial.output == opened);
    settle(pin, HIGH); assert(Serial.output == opened);
    Serial.output.clear(); settle(pin, LOW); assert(Serial.output == closed);
    settle(pin, HIGH);
    assert(exchange(group == 0 ? "WIN11:1\n" : "DOOR9:1\n") == (group == 0 ? "WIN11:1\n" : "DOOR9:1\n"));
    Serial.output.clear(); settle(pin, LOW); assert(Serial.output == opened);
    settle(pin, HIGH); Serial.output.clear();
    nowMs = UINT32_MAX - 10; inputs[pin] = LOW; loop();
    nowMs = 18; loop(); assert(Serial.output.empty());
    nowMs = 19; loop(); assert(Serial.output == closed);
    settle(pin, HIGH);
  }
  Serial.output.clear();
  inputs[FAN_SWITCH_PIN] = LOW; loop(); nowMs += 10; inputs[FAN_SWITCH_PIN] = HIGH; loop();
  nowMs += 10; inputs[FAN_SWITCH_PIN] = LOW; loop(); nowMs += 29; loop(); assert(Serial.output.empty());
  nowMs += 1; loop(); assert(Serial.output == "FAN:ON\n");
  nowMs += 100; loop(); assert(Serial.output == "FAN:ON\n");
  assert(exchange("FAN:OFF\n") == "ERR:BUSY\nFAN:ON\n");
  Serial.output.clear(); nowMs = UINT32_MAX - 10; inputs[FAN_SWITCH_PIN] = HIGH; loop();
  nowMs = 18; loop(); assert(Serial.output.empty()); nowMs = 19; loop(); assert(Serial.output == "FAN:OFF\n");
  // D3 left unwired stays HIGH; software doors, D4 and D5 keep working.
  assert(exchange("DOOR9:1\n") == "DOOR9:1\n");
  Serial.output.clear(); nowMs += 10000; loop(); assert(Serial.output.empty());
  settle(WINDOW_BUTTON_PIN, LOW); assert(Serial.output == windows(true));
  Serial.output.clear(); settle(FAN_SWITCH_PIN, LOW); assert(Serial.output == "FAN:ON\n");
  assert(doorsOpen[8]);
  assert(exchange("FAN:maybe\nWIN11:2\nDOOR9:yes\nFANANG:181\nFANPOS:5\nPURPOS:6\nSCN:0\n") == std::string("ERR:RANGE\n") + "ERR:RANGE\nERR:RANGE\nERR:RANGE\nERR:RANGE\nERR:RANGE\nERR:RANGE\n");
  assert(exchange("WIN12:1\nDOOR10:0\n") == "ERR:UNKNOWN\nERR:UNKNOWN\n");
  assert(exchange(std::string(100, 'X') + "\nPING\n") == "ERR:RANGE\nPONG\n");
  // Buttons held at boot must not toggle; D5 samples its actual state.
  inputs[DOOR_BUTTON_PIN] = LOW; Serial.output.clear(); setup(); nowMs += 100; loop();
  assert(Serial.output == "HELLO:HEATSIM/2\n" + windows(false) + doors(false) + "FAN:ON\nEND\n");
  assert(exchange("GET:ALL\n") == windows(false) + doors(false) + "FAN:ON\nEND\n");
  std::cout << "Firmware v2 passed: all openings, optional D3, debounce/hold/release/rollover, D5 authority, startup/reconnect and protocol bounds.\n";
}
