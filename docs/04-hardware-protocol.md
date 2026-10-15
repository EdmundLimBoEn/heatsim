# 04 · Hardware and serial protocol

The hardware is **input and actuation only**: buttons on a cardboard model, and SG90 servos that open the model's windows and doors and aim a model fan. **There are no sensors** (no PSI, PM2.5, temperature or humidity). [D]

## 1. Board: SSTuino II
| Fact | Tag |
|---|---|
| The main MCU is an **ATmega4809** (8-bit AVR, the chip you program, 5 V). The **ESP32 is only a Wi-Fi coprocessor** running WiFiNINA over SPI. Board is Nano Every-like. | [V] knowledge.fourier.industries |
| ⇒ **No ESP32-only libraries** (ESPAsyncWebServer, ESPHome, arduinoWebSockets-ESP32 etc. will not compile or run). Use plain Arduino or megaAVR libraries. | [V] inference from the above |
| Arduino IDE 2: add the Boards Manager URL `https://fourierindustries-llp.github.io/SSTuino_II_Core/package_FourierIndustries-LLP_SSTuino_II_Core_index.json`, install "SSTuino", select **Tools › Board › SSTuino II › SSTuino II Rev A**. | [V] |
| **Use board package newer than v1.1.1 with IDE 2.** v1.1.1 or older with IDE 2 risks bricking the board. | [V] |
| `LED_BUILTIN` is not pin 13 on this board. The RGB LED sits on the ESP32 (`WiFi.setLEDs(r,g,b)` via WiFiNINA). | [V] |
| The USB serial device appears on the Mac as `/dev/cu.usbmodem*` | [U] check on the day |
| PWM-capable pins and 5 V pin current limit: read them off "SSTuino II Rev A Pinout Final.png" in the SSTuino_II_Core repo | [U] |
| The standard `Servo` library supports megaAVR (ATmega4809) | [U] compile-test first thing |

Spare-board fallback: Arduino Uno or Nano (USB serial). The protocol and sketch are identical apart from pin numbers.

## 2. Wiring and pin map (fill in on the day: **TBD**)
| Function | Model part | Pin | Notes |
|---|---|---|---|
| BTN_WIN1 | button for window 1 | **TBD** | `INPUT_PULLUP`, button to GND |
| BTN_WIN2 | button for window 2 | **TBD** | |
| BTN_DOOR1 | button for door 1 | **TBD** | |
| BTN_DOOR2 | button for door 2 | **TBD** | |
| BTN_FAN | fan on/off | **TBD** | |
| BTN_FANANG | fan angle step (+15°, wraps 0→180→0) | **TBD** | |
| BTN_FANPOS | fan slot step (0→1→…→N−1→0) | **TBD** | |
| BTN_SCN | cycle scenario (optional) | **TBD** | |
| SRV_WIN1 | SG90 for window 1 flap | **TBD (PWM)** | |
| SRV_WIN2 | SG90 window 2 | **TBD (PWM)** | |
| SRV_DOOR1 | SG90 door 1 | **TBD (PWM)** | |
| SRV_FANANG | SG90 that yaws the model fan | **TBD (PWM)** | |

**Power:** servos run from a **separate 5 V supply** (a USB power bank with a cut cable, or 4×AA through a 5 V regulator). **Servo GND, supply GND and board GND are tied together.** Only the signal wires go to board pins. Never power more than one SG90 from the board's 5 V pin, because brown-outs reset the board [U, standard practice]. Add a 470–1000 µF capacitor across the servo supply if they jitter [U].
SG90 needs a 50 Hz pulse of about 0.5–2.4 ms for 0–180° [U, varies by clone]. Calibrate per servo with `SRV_<id>_MIN/MAX` constants.

## 3. Name mapping: hardware id → sim object (`src/config/mapping.ts`) [D, editable]
The cardboard model shows **bedroom 3 + corridor + living room** (TBD by the Designer; edit the mapping and nothing else):
| HW id | Sim object (exact JSON/GLB name) |
|---|---|
| WIN1 | `window_bedroom3_1` (north) |
| WIN2 | `window_living_1` (south) |
| WIN3 | `window_living_3` (east) |
| DOOR1 | `main_door` (south, to common corridor) |
| DOOR2 | `door_bedroom3` (internal) |
| FANPOS 0..4 | slots in doc 05 §3 |
Unmapped ids are logged and ignored.

## 4. Protocol v1 [D]
**Transport:** USB CDC serial, **115200 baud, 8N1**, **ASCII**, one message per line terminated by `\n`. A `\r` before it is tolerated and stripped. At most 32 characters per line. Keys are UPPERCASE. Format `KEY:VALUE` (or a bare `KEY` for commands without a value). Lines starting with `#` are free-text logs (the host shows them in the log panel and otherwise ignores them). Unknown keys get `ERR:UNKNOWN` (board) or are logged (host). **Never JSON.**

**State semantics:** the board owns the *physical* state of the servos. A state line means "this is now the state", not "a button was pressed". The same `KEY:VALUE` syntax is used in both directions:
- **Board → host:** "the model is now in this state" (after a button toggle or after executing a command).
- **Host → board:** "please move to this state". The board moves the servo, then **echoes the same line** as confirmation. The host treats the echo idempotently (it sets the same state again, with no loop because nothing changes).

### 4.1 Board → host
| Line | Values | When |
|---|---|---|
| `HELLO:HEATSIM/1` | n/a | on boot and in reply to `HELLO` |
| `WIN<n>:<0\|1>` | n = 1..9; 1 = open | a button toggled it, or echo of a command |
| `DOOR<n>:<0\|1>` | n = 1..9 | same |
| `FAN:<ON\|OFF>` | n/a | same |
| `FANANG:<deg>` | integer 0..180; 90 = facing the slot's base heading | same. Rate-limited to ≤10 Hz. |
| `FANPOS:<slot>` | 0..9 | same |
| `FANSPD:<0..3>` | n/a | same (if there's a speed button) |
| `AC:<ON\|OFF>`, `PUR:<ON\|OFF>`, `PURPOS:<slot>` | n/a | only if those buttons exist (optional) |
| `SCN:<n>` | 1..6 | scenario button (optional) |
| `BTN:<id>` | raw button id | debug only; the host logs it |
| `PONG` | n/a | reply to `PING` |
| `END` | n/a | end of a `GET:ALL` dump |
| `ERR:<UNKNOWN\|RANGE\|BUSY>` | n/a | bad command |
| `# text` | n/a | debug log |

### 4.2 Host → board
| Line | Effect | Board reply |
|---|---|---|
| `HELLO` | handshake | `HELLO:HEATSIM/1` |
| `PING` | liveness (host sends every 2 s; disconnected if no `PONG` within 5 s) | `PONG` |
| `GET:ALL` | request full state | every state line (`WIN1:..`, `DOOR1:..`, `FAN:..`, `FANANG:..`, `FANPOS:..`) then `END` |
| `WIN<n>:<0\|1>`, `DOOR<n>:<0\|1>` | move that flap servo | echo |
| `FAN:<ON\|OFF>` | sets the logical fan state (the model fan may be decorative) | echo |
| `FANANG:<deg>` | yaw servo to deg | echo |
| `FANPOS:<slot>` | logical only (there is no slot actuator on the model) | echo |
| `LED:<r>,<g>,<b>` | 0..255 each, on the RGB LED via `WiFi.setLEDs` (stretch) | `# ok` |
| `MODE:<LOCAL\|REMOTE>` | `REMOTE` makes buttons send `BTN:<id>` only and lets the host decide (stretch; default LOCAL) | echo |

Example session:
```
< HELLO:HEATSIM/1
> GET:ALL
< WIN1:0
< WIN2:0
< DOOR1:0
< DOOR2:1
< FAN:OFF
< FANANG:90
< FANPOS:0
< END
(user presses WIN1 button)        < WIN1:1
(user clicks "Optimise → Apply")  > FANPOS:2      > FANANG:45     > FAN:ON
                                  < FANPOS:2      < FANANG:45     < FAN:ON
```

### 4.3 Host rules
- On connect: wait 1.5 s (many AVR boards reset when the port opens [U for SSTuino]), send `HELLO`, then `GET:ALL`. **The hardware state wins on connect**: apply the dump to AppState.
- Outgoing commands are sent only for state the user changed via keyboard, UI, scenario or optimiser, and only for mapped ids. Coalesce `FANANG` to ≤10 Hz.
- If no `HELLO` arrives within 3 s, keep the port open, show "connected (no handshake)", and still parse lines (old sketches).

## 5. Browser side: Web Serial (`src/io/webserial.ts`)
- `navigator.serial.requestPort()` must run inside a click handler (the "Connect model" button or the `C` key). Then `port.open({ baudRate: 115200 })`. Remember the port: on load, `navigator.serial.getPorts()` and auto-open if exactly one is found.
- Read: `port.readable.pipeThrough(new TextDecoderStream())` → line splitter (`TransformStream` buffering on `\n`) → `parseLine()` (shared with the WS path) → `InputEvent`.
- Write: a `TextEncoderStream` writer; `send(line)` appends `\n`.
- Handle the `disconnect` event and read errors: set `link.connected=false`, release locks, offer reconnect. The sim keeps running.
- Chrome or Edge on desktop only (not Safari or Firefox) [U, believed true]. Secure context is required, and `localhost` qualifies [U].

## 6. Alternative: Bun bridge (`tools/bridge/`, optional)
Use it if Web Serial misbehaves, or to let a second browser or tool see the lines.
- `bun run tools/bridge/bridge.ts --port /dev/cu.usbmodemXXXX --baud 115200 --ws 8787`
- It relays lines verbatim: serial → every WS client, WS client → serial. No parsing. Logs to the console with timestamps.
- Browser: `new WebSocket("ws://localhost:8787")`, same `parseLine()`.
- Serial in Bun: use the `serialport` npm package. **[U] Whether its native addon loads under Bun is unverified.** If it fails, run the same script with Node (`npx tsx bridge.ts`), using `serialport` + `ws`.

## 7. Arduino sketch outline (`firmware/heatsim_board/heatsim_board.ino`)
```cpp
// Board: SSTuino II Rev A (ATmega4809), core > v1.1.1, Arduino IDE 2.
#include <Servo.h>               // [U] confirm megaAVR support by compiling first
// ---- config (pins TBD) ----
struct Flap { const char* key; uint8_t btnPin; uint8_t srvPin; uint8_t closedDeg, openDeg; bool open; Servo s; };
Flap flaps[] = { {"WIN1", /*btn*/0,/*srv*/0, 10,100,false}, {"WIN2",0,0,10,100,false},
                 {"DOOR1",0,0,0,90,false}, {"DOOR2",0,0,0,90,true} };
// fan: on/off button, angle button, slot button, yaw servo
// ---- state ----
// bool fanOn; int fanAng=90; int fanPos=0;
// ---- setup ----
// Serial.begin(115200); pins INPUT_PULLUP; attach servos and move to the initial state;
// Serial.println("HELLO:HEATSIM/1");
// ---- loop ----
// 1. Buttons: 30 ms debounce (millis-based, no delay()). On press, toggle state → moveServo() → printState(key).
// 2. Serial: accumulate chars into a 33-byte buffer until '\n'; strip '\r'; handleLine():
//      "HELLO" → HELLO line; "PING" → "PONG"; "GET:ALL" → dump + "END";
//      "<KEY>:<VAL>" → validate range → set state → moveServo() → echo; otherwise "ERR:UNKNOWN".
// 3. Servo power hygiene: attach() before a move, detach() ~600 ms after it (millis timer) to stop SG90 jitter/hum.
// No String class in the hot path (heap fragmentation on AVR); use char buffers + strncmp/atoi.
```
**Firmware acceptance:** with the Arduino IDE Serial Monitor at 115200 and "Newline" line ending, typing `PING` → `PONG`, `GET:ALL` → full dump plus `END`, `WIN1:1` → the servo moves and `WIN1:1` is echoed. Pressing each button prints exactly one line per press.
