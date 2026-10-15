# 04 · Hardware and serial protocol

**Current MVP:** the user has a SSTuino and one limit switch. The default sketch maps a passive COM→GND / NO→D5 switch to the simulated purifier in the Bedroom 3 corner: held pressed ON, released OFF. Board revision, upload and the physical USB round trip are **not yet verified**. The app still works standalone. The default sketch drives no servos or motors. **There are no environmental sensors** (no PSI, PM2.5, temperature or humidity). See [the practical wiring guide](hardware.md).

The protocol below is implemented; sections explicitly marked planned or optional are not required to run the app. Cooling Lab is also standalone. Its high-level exhaust/supply fan is a software experiment; no new serial command or physical ventilation actuator is added. Its envelope parameters describe the full-size flat, not the cardboard.

## 1. Planned board: SSTuino II (confirm the supplied revision)
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

Possible spare-board fallback: Arduino Uno or Nano over USB serial. Keep this protocol and verify the board/core and pin assignments before uploading; no physical fallback board has been tested.

## 2. Current one-switch wiring and alternative opening controls

**Default `SINGLE_PURIFIER_SWITCH 1`: COM→GND, NO→D5, NC unconnected.** `INPUT_PULLUP` makes pressed LOW = `PUR:ON`, released HIGH = `PUR:OFF`, with 30 ms nonblocking debounce. No 5 V, 3.3 V or motor connects to the switch input. The app applies each physical PUR state to the Bedroom 3 corner purifier, slot 2 at x=11.5 m, z=2.8 m. The switch owns only purifier power. Setup sends the current state. `GET:ALL` returns only `PUR:<ON|OFF>` and `END`; fan settings, weather, openings and live simulation fields remain unchanged. A conflicting host `PUR` request returns `ERR:BUSY` followed by the actual switch state. Other valid logical settings can echo, but are not included in this mode's state dump.

**Alternative `SINGLE_PURIFIER_SWITCH 0`:** the previous two-opening demonstration below. Neither wiring mode has been tested on the user's board yet.
| Function | Model part | Pin | Default behaviour |
|---|---|---|---|
| WIN1 input | bedroom 3 north window | **D5** | `INPUT_PULLUP`; button between input and GND toggles once per press |
| DOOR1 input | main entrance | **D6** | `INPUT_PULLUP`; button between input and GND toggles once per press |
| WIN1 servo | optional window actuator | **D9**, proposed | disabled by `ENABLE_SERVOS 0` |
| DOOR1 servo | optional door actuator | **D10**, proposed | disabled by `ENABLE_SERVOS 0` |

The actual sketch has these two `flaps[]` entries. `WIN2`, `WIN3` and `DOOR2` are mapped in the app but need extra configured firmware channels and verified pins before they work on a board. Fan, AC, purifier and scenario commands are logical settings; no motor, relay or fan-yaw actuator is implemented.

Each flap defaults to `limitSwitch=false` (button mode). Set it to `true` for a limit switch pressed by the closed flap: COM → GND, NO → input; pressed means closed, released means open. Debounce is 30 ms. In this mode the switch owns the state and its servo stays disabled. Check the actual board and switch markings before connecting them.

**Optional servo power:** identify the actual servo model and its voltage/current requirements first. Use a suitable separate supply and join supply, servo and board GND; do not power an unknown servo from a GPIO. Verify the board-compatible `Servo` library and signal pins before setting `ENABLE_SERVOS` to `1`. The sketch's provisional `closedDegrees=90` / `openDegrees=120` values are not calibrated: start with horns detached, then adjust each linkage without driving into a hard stop. No servo model, supply or mounting dimensions have been confirmed.

## 3. Name mapping: hardware id → sim object (`src/config/mapping.ts`) [D, editable]
The cardboard model shows the **full flat**, as specified in the [physical build pack](physical-model.md). Five openings are mapped for optional hardware; every opening also has an on-screen control:
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

**State semantics:** a state line sets a state rather than reporting a toggle event. The same `KEY:VALUE` syntax is used in both directions:
- **Board → host:** the channel's logical state, or the observed open/closed state when configured as a limit-switch input.
- **Host → board:** request that state. In button mode the sketch updates the logical state, optionally commands an enabled servo, then **echoes the same line**. An echo does not measure servo position. In limit-switch mode a conflicting request returns `ERR:BUSY` followed by the actual state.
- The host applies echoes idempotently without sending another command back. No board is needed for standalone controls.

### 4.1 Board → host
| Line | Values | When |
|---|---|---|
| `HELLO:HEATSIM/1` | n/a | on boot and in reply to `HELLO` |
| `WIN<n>:<0\|1>` | n = 1..9; 1 = open | a button toggled it, or echo of a command |
| `DOOR<n>:<0\|1>` | n = 1..9 | same |
| `FAN:<ON\|OFF>` | n/a | same |
| `FANANG:<deg>` | integer 0..180; 90 = facing the slot's base heading | logical command echo or state dump; host sends at ≤10 Hz |
| `FANPOS:<slot>` | integer 0..9; app accepts configured slots 0..4 | logical command echo or state dump |
| `FANSPD:<0..3>` | integer 0..3 | logical command echo or state dump |
| `AC:<ON\|OFF>`, `PUR:<ON\|OFF>` | n/a | logical command echo or state dump |
| `PURPOS:<slot>` | integer 0..9; app accepts configured slots 0..5 | logical command echo or state dump |
| `SCN:<n>` | 1..6 | logical command echo or state dump; scenario button remains optional |
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
| `GET:ALL` | request states owned by this firmware mode | default single-switch: `PUR:..`, then `END`; alternative opening mode: every configured opening and logical setting, then `END` |
| `WIN<n>:<0\|1>`, `DOOR<n>:<0\|1>` | set a configured channel; servo movement only if enabled and calibrated | echo, or `ERR:BUSY` plus actual limit-switch state |
| `FAN:<ON\|OFF>` | requests logical fan power; independent of the D5 purifier switch | echo |
| `PUR:<ON\|OFF>` | requests purifier power; default single-switch mode is physically authoritative | echo, or `ERR:BUSY` plus actual switch state |
| `FANANG:<deg>` | set logical fan angle; no yaw actuator in this sketch | echo |
| `FANPOS:<slot>` | logical only (there is no slot actuator on the model) | echo |
| `FANSPD:<0..3>`, `AC:<ON\|OFF>`, `PURPOS:<0..9>`, `SCN:<1..6>` | update logical settings within the stated range | echo |
| `LED:<r>,<g>,<b>` | 0..255 each, on the RGB LED via `WiFi.setLEDs` (stretch) | `# ok` |
| `MODE:<LOCAL\|REMOTE>` | `REMOTE` makes buttons send `BTN:<id>` only and lets the host decide (stretch; default LOCAL) | echo |

Example session for alternative `SINGLE_PURIFIER_SWITCH 0` mode:
```
< HELLO:HEATSIM/1
> GET:ALL
< WIN1:0
< DOOR1:0
< FAN:OFF
< FANANG:90
< FANPOS:0
< FANSPD:2
< AC:OFF
< PUR:OFF
< PURPOS:0
< SCN:1
< END
(user presses WIN1 button)        < WIN1:1
(user clicks "Optimise → Apply")  > FANPOS:2      > FANANG:45     > FAN:ON
                                  < FANPOS:2      < FANANG:45     < FAN:ON
```

### 4.3 Host rules
- On connect: wait 1.5 s (many AVR boards reset when the port opens [U for SSTuino]), send `HELLO`, then `GET:ALL`. **The hardware state wins on connect**: apply the dump to AppState.
- Outgoing commands are sent only for state the user changed via keyboard, UI, scenario or optimiser, and only for mapped ids. Coalesce `FANANG` to ≤10 Hz.
- If no `HELLO` arrives within 3 s, keep the port open, show "connected (no handshake)", and still parse lines (old sketches).

## 5. Browser side: Web Serial (`src/hardware.ts`, integrated by `src/main.ts`)
- `navigator.serial.requestPort()` must run inside a click handler (the "Connect SSTuino" button or the `C` key). Then `port.open({ baudRate: 115200 })`. Remember the port: on load, `navigator.serial.getPorts()` and auto-open if exactly one is found.
- Read: the serial stream reader → `TextDecoder` → bounded `HardwareLineParser` → `parseLine()` → state callbacks. Oversized/corrupt lines are ignored.
- Write: the serial stream writer encodes validated messages with `TextEncoder`; `send(line)` appends `\n`.
- Stream completion, read/write errors and heartbeat timeout release locks and offer reconnect. The sim keeps running.
- Chrome or Edge on desktop only (not Safari or Firefox) [U, believed true]. Secure context is required, and `localhost` qualifies [U].

## 6. Planned alternative: Bun bridge (not implemented)

There is no `tools/bridge/` or WebSocket client in this MVP. USB uses Web Serial directly. Browsers without Web Serial still run the standalone app through on-screen and keyboard controls. A serial-to-WebSocket bridge remains future work if a demonstrated need arises.

## 7. Implemented Arduino sketch (`firmware/heatsim_board/heatsim_board.ino`)

The [sketch](../firmware/heatsim_board/heatsim_board.ino) defaults to the single D5 purifier switch in §2. Setting `SINGLE_PURIFIER_SWITCH` to `0` restores the two opening inputs. Both modes implement 30 ms nonblocking debounce, bounded ASCII parsing, range checks, handshake and heartbeat replies. State dumps include only states owned by the selected mode. `LED` and `MODE` return `ERR:UNKNOWN`. Servos are disabled by default and only relevant to the alternative opening mode.

**Single-switch acceptance:** with Arduino IDE Serial Monitor at 115200 and "Newline", `PING` returns `PONG`; `GET:ALL` returns the actual `PUR:ON` or `PUR:OFF` and `END`. Press and release each produce one state update after debounce. A conflicting `PUR` request returns `ERR:BUSY` followed by the observed state. Close Serial Monitor, connect from desktop Chrome, and confirm the Bedroom 3 corner purifier responds without changing fan, weather or openings. Alternative opening mode retains its WIN1/DOOR1 checks. Test servo movement separately only after enabling and calibrating it.

Host-side tests exercise the parser, connection handling and the sketch through mocked Arduino functions. They do **not** verify AVR compilation, firmware upload, physical USB behaviour, wiring or servo movement. Follow [hardware.md](hardware.md) for exact check commands and the remaining hardware steps.

Written by gpt-6-astra in Codex on behalf of Edmund
