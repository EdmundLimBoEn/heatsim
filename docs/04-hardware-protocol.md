# 04 · Hardware and serial protocol

**Final prototype mapping (16 Oct): D5 now controls the Bedroom 3 main standing fan (fan preset 1), held = ON and released = OFF. D4 and switch polarity are unchanged. The already-uploaded sketch still sends `PUR:ON/OFF`; the app maps that legacy channel to the fan, and sends main-fan power requests back on `PUR`. The purifier is software-only. No reflash is required. On a D5 update, the main fan returns to its Bedroom 3 preset; other fans and purifier settings are preserved. References to D5 purifier control below describe the previous mapping.**

**Current MVP:** the default sketch uses D4 for a button that toggles both Bedroom 3 windows together, and D5 for the corner purifier switch (held pressed ON, released OFF). Board revision, upload and the physical USB round trip are **not yet verified**. The app still works standalone. The default sketch drives no servos or motors. **There are no environmental sensors** (no PSI, PM2.5, temperature or humidity). See [the practical wiring guide](hardware.md).

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

## 2. Current Bedroom 3 controls and alternative opening demonstration

**Default `SINGLE_PURIFIER_SWITCH 1`: D4 button→GND, and purifier COM→GND / NO→D5 / NC unconnected.** Both use `INPUT_PULLUP` and 30 ms nonblocking debounce. D4 toggles WIN1 (Bedroom 3 north) and WIN4 (Bedroom 3 east): both open→close both; otherwise→open both. Only a new stable LOW press toggles; holding/releasing does nothing. Individual host WIN1/WIN4 commands set and echo only that channel. D5 pressed LOW sends `PUR:ON`, released HIGH sends `PUR:OFF`; conflicting host power requests return `ERR:BUSY` plus the actual state. The app targets the Bedroom 3 purifier corner, slot 2 at x=11.5 m, z=2.8 m. No voltage supply or motor connects to either input. D4 is a free digital header input on SSTuino II; the older Classic shares D4 with Wi-Fi and needs a verified unused pin instead (see wiring guide).

Boot initializes logical windows closed, samples D5 and emits `WIN1`, `WIN4`, `PUR`. `GET:ALL` emits those same three owned states, then `END`. Board reset therefore closes logical windows; a reconnect without reset preserves board window state. Fan settings, other openings, weather and live simulation fields are unchanged. Other valid logical settings can echo but are omitted from this mode's dump.

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
The cardboard model shows the **full flat**, as specified in the [physical build pack](physical-model.md). Six openings are mapped for optional hardware; every opening also has an on-screen control:
| HW id | Sim object (exact JSON/GLB name) |
|---|---|
| WIN1 | `window_bedroom3_1` (north) |
| WIN2 | `window_living_1` (south) |
| WIN3 | `window_living_3` (east) |
| WIN4 | `window_bedroom3_2` (east) |
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
| `GET:ALL` | request states owned by this firmware mode | default Bedroom 3 mode: `WIN1:..`, `WIN4:..`, `PUR:..`, then `END`; alternative mode: configured openings and logical settings, then `END` |
| `WIN<n>:<0\|1>`, `DOOR<n>:<0\|1>` | set a configured channel; servo movement only if enabled and calibrated | echo, or `ERR:BUSY` plus actual limit-switch state |
| `FAN:<ON\|OFF>` | requests logical fan power; independent of the D5 purifier switch | echo |
| `PUR:<ON\|OFF>` | requests purifier power; default Bedroom 3 mode is physically authoritative | echo, or `ERR:BUSY` plus actual switch state |
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

The [sketch](../firmware/heatsim_board/heatsim_board.ino) defaults to D4 window-group and D5 purifier controls in §2. Setting `SINGLE_PURIFIER_SWITCH` to `0` restores the alternative D5/D6 opening inputs. Both modes implement 30 ms nonblocking debounce, bounded ASCII parsing, range checks, handshake and heartbeat replies. State dumps include only states owned by the selected mode. `LED` and `MODE` return `ERR:UNKNOWN`. Servos are disabled by default and only relevant to the alternative opening mode.

**Bedroom 3 controls acceptance:** with Serial Monitor at 115200 and "Newline", `PING` returns `PONG`; `GET:ALL` returns WIN1, WIN4, actual PUR and END. D4 bounce/hold/release must not duplicate a toggle; the next full press toggles both windows again. Individual WIN1/WIN4 requests echo once. D5 press/release each produce the actual purifier state after debounce; conflicting requests return `ERR:BUSY` plus actual state. In desktop Chrome, check both windows and the purifier without changing fan, weather or other openings. Alternative mode retains WIN1/DOOR1 checks. Test servos separately only after enabling and calibrating them.

Host-side tests exercise the parser, connection handling and sketch through mocked Arduino functions. The default sketch separately compiled successfully for SSTuino II Rev A (core 1.1.3, FQBN `sstuino-ii:megaavr:4809`). Firmware upload, physical USB behaviour, wiring and servo movement remain unverified. Follow [hardware.md](hardware.md) for exact check commands and remaining hardware steps.

Written by gpt-6-astra in Codex on behalf of Edmund
