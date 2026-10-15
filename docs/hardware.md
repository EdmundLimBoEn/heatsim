# Connect the cardboard model

The current default uses **one limit switch over USB to control the simulated portable fan**. Press means ON; release means OFF. Choose the fan's location in **Flat simulation → Devices**. The switch changes power at that selected location; it does not measure position or power a real fan. The earlier two-opening demonstration remains available by setting `SINGLE_FAN_SWITCH` to `0`.

## Wire first, with USB unplugged

| Switch terminal | Board connection | Purpose |
|---|---|---|
| COM | GND | Common return |
| NO | D5, the digital pin labelled 5 | Press pulls the input LOW, turning the simulated fan ON |
| NC | Leave unconnected | Not used |

The sketch enables `INPUT_PULLUP`, so the open switch reads HIGH and the pressed switch reads LOW. **No wire goes to 5 V or 3.3 V.** Use the actual COM/NO markings; terminal position varies between switches. This assumes a bare passive switch, not a powered sensor module. USB powers the board only. [Arduino input-pullup example](https://docs.arduino.cc/tutorials/generic/digital-input-pullup/).

D5/D6 avoid the original SSTuino's Wi-Fi connections on D2/D4. They are also digital pins in the SSTuino II core. These assignments are a proposed demo wiring plan, not a measurement of your board. [Classic connections](https://github.com/d3lta-v/SSTuino/blob/master/README.md#startup-states-table), [SSTuino II pin definitions](https://github.com/FourierIndustries-LLP/SSTuino_II_Core/blob/master/megaavr/variants/uno-wifi/pins_arduino.h).

The [complete sketch](../firmware/heatsim_board/heatsim_board.ino) defaults to `SINGLE_FAN_SWITCH 1`, `FAN_SWITCH_PIN = 5`, and `FAN_SWITCH_ACTIVE = LOW`. Debounce takes 30 ms without blocking serial handling. It sends `FAN:ON` or `FAN:OFF` on stable changes, at startup, and when the browser requests state. Conflicting on-screen power requests return `ERR:BUSY` and the switch's actual state. Disconnect the board to use on-screen fan power independently.

**Alternative two-opening mode:** set `SINGLE_FAN_SWITCH` to `0`. D5 then controls WIN1 (bedroom 3 north window), and D6 controls DOOR1 (main entrance). Each `flaps[]` row has `limitSwitch`:

- **`false`, default:** a momentary button toggles the opening once per press. Releasing the button does not toggle it again.
- **`true`:** mount a limit switch so a fully closed flap presses it. Pressed means closed; released means open. The physical switch owns this state. A conflicting web command returns `ERR:BUSY` and the actual state, so the app returns to the physical position.

Both modes debounce for 30 ms. Change the per-row setting to mix one button and one limit switch. Keep D0/D1 free for serial. Mount switches on removable tabs outside the building footprint until the team measures the actual bodies and lever travel. The model's tiny flaps do not set the switch mounting-hole dimensions.

## Upload and connect

1. Open `firmware/heatsim_board/heatsim_board.ino` in Arduino IDE.
2. **SSTuino II:** follow the manufacturer's board-package installation, use a package **newer than v1.1.1** with Arduino IDE 2, and select **SSTuino II → SSTuino II Rev A**. The manufacturer warns that older packages with IDE 2 can brick the board. [Setup instructions](https://knowledge.fourier.industries/sstuino-innovators-kit-v2-parts-list-2.html), [board selection](https://knowledge.fourier.industries/programming-the-sstuino-ii.html).
3. **Original SSTuino / Arduino Uno fallback:** select Arduino Uno for the Classic. Its NEU USB adapter uses CP2102; use the manufacturer's setup instructions if the port is missing. [Classic board selection](https://sstuino.fourier.industries/tutorials/helloWorld.html), [adapter setup](https://sstuino.fourier.industries/tutorials/gettingStarted.html).
4. Upload. In Serial Monitor choose **115200 baud** and **Newline**. Enter `PING` and expect `PONG`; enter `GET:ALL` and expect states ending in `END`.
5. **Close Serial Monitor** before connecting from the web app. Open the app in desktop Chrome or Edge at `http://localhost:5173`, click **Connect model**, and select the board's port. The web connection waits 1.5 seconds for reset, sends `HELLO` and `GET:ALL`, and uses the board's states.
6. In **Flat simulation → Devices**, choose the portable fan location and a speed above zero. Press the switch: portable fan power should turn on. Release it: power should turn off. USB messages show `FAN:ON` and `FAN:OFF`. Unplug USB: the link should become disconnected while the app keeps running. Reconnect: the current switch state wins, while the selected location, speed, direction and scenario remain unchanged.

For a quick Serial Monitor check, the default sketch replies to `GET:ALL` with only `FAN:ON` or `FAN:OFF`, then `END`. It intentionally omits unowned opening, position and scenario states. Close Serial Monitor before browser connection. If the fan checkbox changes but airflow stays still, select a fan speed above zero and resume the simulation.

Web Serial requires a secure context and user permission for the port. Desktop Chrome supports it; `localhost` works. Safari and Firefox should use the app's on-screen controls. A reconnect can reuse a single already-permitted port. [Chrome Web Serial guide](https://developer.chrome.com/docs/capabilities/serial), [Web Serial specification](https://wicg.github.io/serial/).

## Servos: optional until the parts are identified

**The default sketch drives no servos.** Optional opening servos belong only to the alternative `SINGLE_FAN_SWITCH 0` mode. A servo is an actuator, not an input. The one-switch fan connection uses only D5 and GND.

The sketch contains an `ENABLE_SERVOS` switch, default `0`, and proposed signal pins D9 (WIN1) and D10 (DOOR1). To enable it, first identify the servo model, confirm its voltage/current requirements, compile the board-compatible `Servo` library, and verify its signal pins on the actual board. Supply servos from a suitable separate supply with its GND tied to board GND; do not power an unknown servo from a GPIO. SSTuino II's manufacturer specifically notes that servo current can reset the board. [Manufacturer FAQ](https://knowledge.fourier.industries/frequently-asked-questions-faq-sstuino-ii.html).

Set `ENABLE_SERVOS` to `1` only after that check. The provisional 90° closed / 120° open values are **not calibrated for your linkage**. Start with the horn detached, set a safe neutral position, then fit and adjust each row's `closedDegrees` / `openDegrees` so the flap never pushes against a hard stop. Servos attach to move and detach after 600 ms. In limit-switch mode the channel remains a manual physical input and does not drive its servo.

In the alternative `SINGLE_FAN_SWITCH 0` button mode, typing `WIN1:1` changes its logical state and echoes `WIN1:1`; with calibrated servos enabled it also commands movement. The default single-switch mode rejects `WIN1` because it owns only fan power. An opening echo confirms a requested command, not measured servo position. AC, purifier, scenario and fan placement remain software settings; no motors, relays, fan-yaw servo or sensor wiring is provided.

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
c++ -std=c++17 -Wall -Wextra -Werror -Wno-unused-parameter -DSINGLE_FAN_SWITCH=0 firmware/test_firmware.cpp -o /tmp/heatsim-legacy-firmware-check
/tmp/heatsim-legacy-firmware-check
```

The C++ checks exercise the actual sketch in both modes: startup and reconnect state, press/release debounce, held switch, conflicting host commands, selected-location preservation, protocol bounds and the legacy opening controls. They are not AVR board compiles or physical tests. No `arduino-cli` is installed here. Upload and the actual USB/switch round trip remain unverified until performed on the supplied board.

Written by gpt-6-astra in Codex on behalf of Edmund
