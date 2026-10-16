# Connect the cardboard model

**Final prototype mapping (16 Oct): D5 now controls the Bedroom 3 main standing fan (fan preset 1), held = ON and released = OFF. D4 and switch polarity are unchanged. The already-uploaded sketch still sends `PUR:ON/OFF`; the app maps that legacy channel to the fan, and sends main-fan power requests back on `PUR`. The purifier is software-only. No reflash is required. On a D5 update, the main fan returns to its Bedroom 3 preset; other fans and purifier settings are preserved. References to D5 purifier control below describe the previous mapping.**

The default sketch has **two Bedroom 3 controls**: press the D4 button once to toggle both windows together; hold the D5 limit switch to turn the corner purifier ON and release it for OFF. The app remains usable without the board. Neither input powers a physical appliance or drives a servo.

## Wire first, with USB unplugged

| Control | Signal connection | Other connection | Behaviour |
|---|---|---|---|
| Bedroom 3 window button | D4 | GND | One debounced press toggles both windows; release does nothing |
| Purifier limit switch NO | D5 | COM to GND | Held pressed = ON; released = OFF |
| Purifier limit switch NC | Leave unconnected | — | Not used |

Both inputs use `INPUT_PULLUP`: the open switch reads HIGH and pressing connects it to GND for LOW. **No wire goes to 5 V or 3.3 V.** Use actual COM/NO labels; terminal position varies. A four-leg tactile button has permanently joined pairs, so use opposite contact pairs and check continuity. This assumes passive contacts, not a powered sensor module. [Arduino input-pullup example](https://docs.arduino.cc/tutorials/generic/digital-input-pullup/).

The SSTuino II's official core defines D4 and D5 as digital header pins. The original SSTuino Classic uses D4 for its Wi-Fi connection: do not assume that older board's attached module leaves D4 free; use a verified unused input and change `BEDROOM3_BUTTON_PIN` for a Classic configuration. The requested D4 wiring targets SSTuino II. [SSTuino II pin definitions](https://github.com/FourierIndustries-LLP/SSTuino_II_Core/blob/master/megaavr/variants/uno-wifi/pins_arduino.h), [Classic connections](https://github.com/d3lta-v/SSTuino/blob/master/README.md#startup-states-table).

The [complete sketch](../firmware/heatsim_board/heatsim_board.ino) keeps `SINGLE_PURIFIER_SWITCH 1` as the default Bedroom 3 controls mode. `BEDROOM3_BUTTON_PIN = 4`, `PURIFIER_SWITCH_PIN = 5`, and debounce is 30 ms without blocking serial handling.

- D4 sends absolute `WIN1:0/1` (north window) and `WIN4:0/1` (east window). If both are open, a press closes both; otherwise it opens both. Holding or releasing the button does not repeat the toggle. Individual on-screen window changes still work and are echoed once by the board.
- D5 sends `PUR:ON/OFF`. The app targets purifier slot 2 in the Bedroom 3 corner, x=11.5 m, z=2.8 m. A conflicting on-screen purifier power request returns `ERR:BUSY` and the actual switch state. Disconnect the board to control purifier power independently.
- Boot initializes both logical windows closed and samples the current purifier switch. Startup and `GET:ALL` report `WIN1`, `WIN4` and `PUR`; the latter ends with `END`. A board reset returns windows to closed. Reconnecting without a board reset retains its logical window states. Fan settings, other openings, weather and the running simulation fields are not reset by these messages.

**Alternative opening demonstration:** set `SINGLE_PURIFIER_SWITCH` to `0`. This disables the D4 group control; D5 then controls WIN1 and D6 controls DOOR1. Each `flaps[]` row defaults to `limitSwitch=false` (toggle once per button press). Set it to `true` for a switch pressed by a closed flap; pressed then means closed, released means open, and conflicting host requests return `ERR:BUSY` plus actual state. Servos remain disabled. Mount switches on removable tabs until actual body dimensions and travel are measured; tiny flap dimensions do not define mounting holes.

## Upload and connect

1. Open `firmware/heatsim_board/heatsim_board.ino` in Arduino IDE.
2. **SSTuino II:** follow the manufacturer's board-package installation, use a package **newer than v1.1.1** with Arduino IDE 2, and select **SSTuino II → SSTuino II Rev A**. The manufacturer warns that older packages with IDE 2 can brick the board. [Setup instructions](https://knowledge.fourier.industries/sstuino-innovators-kit-v2-parts-list-2.html), [board selection](https://knowledge.fourier.industries/programming-the-sstuino-ii.html).
3. **Original SSTuino / Arduino Uno fallback:** select Arduino Uno for the Classic. Its NEU USB adapter uses CP2102; use the manufacturer's setup instructions if the port is missing. [Classic board selection](https://sstuino.fourier.industries/tutorials/helloWorld.html), [adapter setup](https://sstuino.fourier.industries/tutorials/gettingStarted.html).
4. Upload. In Serial Monitor choose **115200 baud** and **Newline**. Enter `PING` and expect `PONG`; enter `GET:ALL` and expect states ending in `END`.
5. **Close Serial Monitor** before connecting from the web app. Open the app in desktop Chrome or Edge at `http://localhost:5173`, click **Connect model**, and select the board's port. The web connection waits 1.5 seconds for reset, sends `HELLO` and `GET:ALL`, and uses the board's states.
6. In **Flat simulation**, press D4 once: both Bedroom 3 windows should open. Release and press again: both close. Hold D5: the Bedroom 3 corner purifier turns on; release it: the purifier turns off. Unplug/reconnect and verify the board state is restored while unrelated controls and the live simulation remain unchanged.

In Serial Monitor, `GET:ALL` returns `WIN1:0/1`, `WIN4:0/1`, `PUR:ON/OFF`, then `END`. Close Serial Monitor before browser connection. Resume the simulation to see readings evolve. The purifier removes simulated haze locally; it does not refrigerate the room.

Web Serial requires a secure context and user permission for the port. Desktop Chrome supports it; `localhost` works. Safari and Firefox should use the app's on-screen controls. A reconnect can reuse a single already-permitted port. [Chrome Web Serial guide](https://developer.chrome.com/docs/capabilities/serial), [Web Serial specification](https://wicg.github.io/serial/).

## Servos: optional until the parts are identified

**The default sketch drives no servos.** Optional opening servos belong only to the alternative `SINGLE_PURIFIER_SWITCH 0` mode. A servo is an actuator, not an input. The default controls use only D4, D5 and GND.

The sketch contains an `ENABLE_SERVOS` switch, default `0`, and proposed signal pins D9 (WIN1) and D10 (DOOR1). To enable it, first identify the servo model, confirm its voltage/current requirements, compile the board-compatible `Servo` library, and verify its signal pins on the actual board. Supply servos from a suitable separate supply with its GND tied to board GND; do not power an unknown servo from a GPIO. SSTuino II's manufacturer specifically notes that servo current can reset the board. [Manufacturer FAQ](https://knowledge.fourier.industries/frequently-asked-questions-faq-sstuino-ii.html).

Set `ENABLE_SERVOS` to `1` only after that check. The provisional 90° closed / 120° open values are **not calibrated for your linkage**. Start with the horn detached, set a safe neutral position, then fit and adjust each row's `closedDegrees` / `openDegrees` so the flap never pushes against a hard stop. Servos attach to move and detach after 600 ms. In limit-switch mode the channel remains a manual physical input and does not drive its servo.

In the alternative `SINGLE_PURIFIER_SWITCH 0` button mode, typing `WIN1:1` changes its logical state and echoes `WIN1:1`; with calibrated servos enabled it also commands movement. The default Bedroom 3 mode supports WIN1 and WIN4, while D5 owns purifier power. An opening echo confirms a requested command, not measured servo position. AC, fan and scenario remain software settings; no motors, relays, fan-yaw servo or sensor wiring is provided.

## Integration and checks

The protocol is unchanged: **115200, ASCII, at most 32 characters, `KEY:VALUE` plus LF; never JSON**. Browser parsing rejects invalid ranges, unknown keys and corrupt/oversized lines. Incoming state updates do not automatically send commands back. Calls from UI changes use `sendOpening(kind, id, open)` or `send(line)`; unmapped objects are ignored. `PING` is sent every two seconds, and five seconds without a `PONG` ends the link.

```ts
const hardware = new HardwareConnection({
  onState: ({ kind, id, open }) => applyHardwareControl(kind, id, open),
  onStatus: status => showConnectionStatus(status),
  onLog: line => appendSerialLog(line),
});
connectButton.onclick = () => void hardware.connect();
void hardware.reconnectKnown();
// Only user-originated edits call hardware.sendOpening(kind, id, open).
```

Automated checks:

```sh
bun run test tests/hardware.test.ts tests/protocol.test.ts
c++ -std=c++17 -Wall -Wextra -Werror -Wno-unused-parameter firmware/test_firmware.cpp -o /tmp/heatsim-firmware-check
/tmp/heatsim-firmware-check
c++ -std=c++17 -Wall -Wextra -Werror -Wno-unused-parameter -DSINGLE_PURIFIER_SWITCH=0 firmware/test_firmware.cpp -o /tmp/heatsim-legacy-firmware-check
/tmp/heatsim-legacy-firmware-check
```

The C++ checks exercise the actual sketch in both modes: startup and reconnect state, D4 bounce/hold/release/mixed-state group toggle and timer rollover, D5 press/release/rollover and physical authority, protocol bounds and the legacy opening controls. The default sketch also **compiled successfully for SSTuino II Rev A**, using installed core 1.1.3 and the Arduino IDE's bundled CLI: 4,226 bytes of program storage and 259 bytes of global RAM. Reproduce the board compile with:

```sh
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile --fqbn sstuino-ii:megaavr:4809 --warnings more firmware/heatsim_board
```

Compilation does not upload the sketch or establish physical operation. Upload, wiring and the actual USB/switch round trip remain unverified until performed on the supplied board.

Written by gpt-6-astra in Codex on behalf of Edmund
