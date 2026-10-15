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

int main() {
  for (bool& input : inputs) input = HIGH;
  setup();
  assert(Serial.baud == 115200);
  assert(Serial.output == "HELLO:HEATSIM/1\n");
  assert(exchange("PING\nHELLO\r\n") == "PONG\nHELLO:HEATSIM/1\n");
  assert(exchange("WIN1:1\n") == "WIN1:1\n");
  assert(exchange("WIN1:1\n") == "WIN1:1\n");
  assert(exchange("WIN1:2\nFANANG:181\nFANANG:90x\nSCN:0\n") == "ERR:RANGE\nERR:RANGE\nERR:RANGE\nERR:RANGE\n");
  assert(exchange(std::string(100, 'X') + "\nPING\n") == "ERR:RANGE\nPONG\n");
  assert(exchange("WIN9:1\n") == "ERR:UNKNOWN\n");
  assert(exchange("FAN:ON\nFANANG:45\n") == "FAN:ON\nFANANG:45\n");
  const std::string dump = exchange("GET:ALL\n");
  assert(dump.find("WIN1:1\nDOOR1:0\n") == 0);
  assert(dump.find("FAN:ON\nFANANG:45\n") != std::string::npos);
  assert(dump.substr(dump.size() - 4) == "END\n");
  Serial.output.clear();
  inputs[5] = LOW; loop();
  nowMs += 10; inputs[5] = HIGH; loop();
  nowMs += 10; inputs[5] = LOW; loop();
  nowMs += 29; loop(); assert(Serial.output.empty());
  nowMs += 1; loop(); assert(Serial.output == "WIN1:0\n");
  nowMs += 50; loop(); assert(Serial.output == "WIN1:0\n");
  inputs[5] = HIGH; loop(); nowMs += 31; loop();
  assert(Serial.output == "WIN1:0\n");
  flaps[1].limitSwitch = true;
  inputs[6] = LOW; loop(); nowMs += 31; loop();
  inputs[6] = HIGH; loop(); nowMs += 31; loop();
  assert(flaps[1].open);
  assert(exchange("DOOR1:0\n") == "ERR:BUSY\nDOOR1:1\n");
  assert(flaps[1].open);
  std::cout << "Firmware logic passed: protocol, range checks, overflow recovery, debounce, limit authority.\n";
}
