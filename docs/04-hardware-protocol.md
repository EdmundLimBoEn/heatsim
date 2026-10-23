# Hardware protocol v2

The rewritten final-round sketch uses D4 for **all 11 windows**, optional D3 for **all 9 doors**, and D5 for **main standing-fan power**. No sensors, motor outputs or servos. The app retains v1 compatibility; upload v2 for the new buttons. See [wiring and verification](hardware.md).

## Wire contract

USB serial: 115200 baud, printable ASCII, newline-delimited, optional CR before LF. Maximum 32 characters excluding the terminator. Oversized/non-ASCII lines are discarded through the next newline and return `ERR:RANGE`; parsing then resumes. Input work is bounded to 64 bytes per loop so switch sampling is not starved. Three INPUT_PULLUP inputs debounce for 30 ms using rollover-safe 32-bit elapsed time.

- D4 / D3: button between pin and GND. One stable LOW press toggles its group: if every member is open, close all; otherwise open all. Hold/release do not repeat. A button held at startup does not toggle until released and pressed again.
- D5: COM to GND, NO to D5, NC unconnected. LOW = fan ON, HIGH = OFF. D5 is authoritative for power while connected. Set `FAN_SWITCH_ACTIVE` only if deliberately using different switch polarity; default is LOW.
- D3 may be left unconnected. Its pull-up keeps it HIGH. Doors remain operable from the screen/keyboard and their echoes update the board's logical state. D4 and D5 are independent of it.

## Handshake and state

`HELLO` → `HELLO:HEATSIM/2`; `PING` → `PONG`; `GET:ALL` → WIN1…WIN11, DOOR1…DOOR9, actual FAN, then `END`. Boot sends the same dump preceded by HELLO. On board reset all logical openings start closed and D5 is sampled; reconnect without reset retains the board's logical openings. A dump does not reset weather, simulation fields, purifier, extra fans, or fan position/heading/speed.

Individual opening commands `KEY:0/1` set and echo only that opening. `FAN:ON/OFF` echoes if it matches the stable physical state; a conflict returns `ERR:BUSY` then actual `FAN`. `PUR:ON/OFF` and `AC:ON/OFF` are independent software states. The app restores a removed main fan when D5 turns ON and gives it speed 2 if its speed was zero, preserving position and rotation. OFF never resurrects a deleted fan.

Other valid settings echo once: FANANG 0…180, FANPOS 0…4, FANSPD 0…3, PURPOS 0…5, SCN 1…6. Unknown keys return `ERR:UNKNOWN`; invalid values return `ERR:RANGE`. There are no LED/MODE/servo outputs in this sketch. Incoming state updates do not cause outgoing echoes.

## Geometry mapping

| Key | Canonical JSON name |
|---|---|
| WIN1 | `window_bedroom3_1` |
| WIN2 | `window_living_1` |
| WIN3 | `window_living_3` |
| WIN4 | `window_bedroom3_2` |
| WIN5 | `window_master_1` |
| WIN6 | `window_master_bath` |
| WIN7 | `window_bedroom2_1` |
| WIN8 | `window_service_yard` |
| WIN9 | `window_living_2` |
| WIN10 | `window_master_2` |
| WIN11 | `window_kitchen` |
| DOOR1 | `main_door` |
| DOOR2 | `door_bedroom3` |
| DOOR3 | `door_master_bedroom` |
| DOOR4 | `door_common_bath` |
| DOOR5 | `door_bedroom2` |
| DOOR6 | `door_master_bath` |
| DOOR7 | `door_kitchen` |
| DOOR8 | `door_service_yard` |
| DOOR9 | `door_shelter` |

Existing WIN1…WIN4 and DOOR1…DOOR2 retain their v1 names. Windows WIN10/11 are now accepted; other out-of-range IDs are rejected. These IDs cover every canonical window and door, including bathrooms, yard, shelter and main entrance.

## Compatibility and failure handling

The app recognizes v1 and v2 greetings. v1 `PUR` retains the previous D5→main-fan compatibility mapping, but no longer resets its position. v2 uses FAN directly and restores PUR to the purifier. A visible old-sketch message prompts upgrading. D5 remains main-fan power, not ceiling-fan power.

Browser startup waits 1.5 seconds for board reset, sends HELLO and GET:ALL, then pings every 2 seconds. Missing responses for 5 seconds disconnect cleanly. USB removal releases streams; controls remain usable offline. Browser writes and cleanup each have a one-second deadline; a cleanup timeout reports that the OS may still hold the physical port, while allowing a new connection. Receive processing yields after 256 bytes or a four-millisecond processing budget (individual callbacks/refreshes may take longer), batches opening/device changes per slice, and retains at most an 8192-byte read plus a partial line. Reads above 8192 bytes or more than 16384 received bytes in a one-second window disconnect the sender. These browser safeguards do not change the wire protocol. Serial Monitor must be closed before browser connection.

## Verification

`firmware/test_firmware.cpp` executes the actual sketch with mocked Arduino I/O, testing all-group toggles, mixed states, debounce, holds/releases, startup, D5 authority, D3 absent, range/overflow recovery and timer rollover. TypeScript tests cover complete geometry mappings, v1/v2 routing, fragmented serial data, lifecycle and no-echo behavior. The v2 sketch compiles for SSTuino II Rev A. Physical wiring/upload and an actual switch-to-browser round trip still require the supplied board.
