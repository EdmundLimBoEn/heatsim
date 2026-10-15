# Connect the cardboard model

The working baseline uses **two switch inputs over USB**: WIN1 is the bedroom 3 north window, DOOR1 is the main entrance. No sensors are used. The whole flat still has on-screen controls; only the five mapped openings in [the protocol](04-hardware-protocol.md) can receive hardware commands.

## Wire first, with USB unplugged

| Input | Board input | Switch wiring | App object |
|---|---|---|---|
| WIN1 | D5 | Normally-open button/switch between D5 and GND | `window_bedroom3_1` |
| DOOR1 | D6 | Normally-open button/switch between D6 and GND | `main_door` |

The sketch enables `INPUT_PULLUP`. Do not connect these switch inputs to an external supply. A four-leg tactile button has two permanently joined pairs: use opposite contact pairs and check continuity. For a three-terminal limit switch, use **COM → GND, NO → input**, following the labels on the actual part.

D5/D6 avoid the original SSTuino's Wi-Fi connections on D2/D4. They are also digital pins in the SSTuino II core. These assignments are a proposed demo wiring plan, not a measurement of your board. [Classic connections](https://github.com/d3lta-v/SSTuino/blob/master/README.md#startup-states-table), [SSTuino II pin definitions](https://github.com/FourierIndustries-LLP/SSTuino_II_Core/blob/master/megaavr/variants/uno-wifi/pins_arduino.h).

In [the sketch](../firmware/heatsim_board/heatsim_board.ino), each `flaps[]` row has `limitSwitch`:

- **`false`, default:** a momentary button toggles the opening once per press. Releasing the button does not toggle it again.
- **`true`:** mount a limit switch so a fully closed flap presses it. Pressed means closed; released means open. The physical switch owns this state. A conflicting web command returns `ERR:BUSY` and the actual state, so the app returns to the physical position.

Both modes debounce for 30 ms. Change the per-row setting to mix one button and one limit switch. Keep D0/D1 free for serial. Mount switches on removable tabs outside the building footprint until the team measures the actual bodies and lever travel. The model's tiny flaps do not set the switch mounting-hole dimensions.

## Upload and connect

1. Open `firmware/heatsim_board/heatsim_board.ino` in Arduino IDE.
2. **SSTuino II:** follow the manufacturer's board-package installation, use a package **newer than v1.1.1** with Arduino IDE 2, and select **SSTuino II → SSTuino II Rev A**. The manufacturer warns that older packages with IDE 2 can brick the board. [Setup instructions](https://knowledge.fourier.industries/sstuino-innovators-kit-v2-parts-list-2.html), [board selection](https://knowledge.fourier.industries/programming-the-sstuino-ii.html).
3. **Original SSTuino / Arduino Uno fallback:** select Arduino Uno for the Classic. Its NEU USB adapter uses CP2102; use the manufacturer's setup instructions if the port is missing. [Classic board selection](https://sstuino.fourier.industries/tutorials/helloWorld.html), [adapter setup](https://sstuino.fourier.industries/tutorials/gettingStarted.html).
4. Upload. In Serial Monitor choose **115200 baud** and **Newline**. Enter `PING` and expect `PONG`; enter `GET:ALL` and expect states ending in `END`.
5. **Close Serial Monitor** before connecting from the web app. Open the app in desktop Chrome or Edge at `http://localhost:5173`, click **Connect model**, and select the board's port. The web connection waits 1.5 seconds for reset, sends `HELLO` and `GET:ALL`, and uses the board's states.
6. Press the WIN1 button: the bedroom 3 north window should toggle in the app. Press DOOR1: the main entrance should toggle. Unplug USB: the link should become disconnected while the app keeps running.

Web Serial requires a secure context and user permission for the port. Desktop Chrome supports it; `localhost` works. Safari and Firefox should use the app's on-screen controls. A reconnect can reuse a single already-permitted port. [Chrome Web Serial guide](https://developer.chrome.com/docs/capabilities/serial), [Web Serial specification](https://wicg.github.io/serial/).

## Servos: optional until the parts are identified

**The default sketch drives no servos.** It sends logical opening states from buttons, or actual open/closed states from limit switches. A servo is an actuator, not an input. The app's physical-switch connection works without a servo.

The sketch contains an `ENABLE_SERVOS` switch, default `0`, and proposed signal pins D9 (WIN1) and D10 (DOOR1). To enable it, first identify the servo model, confirm its voltage/current requirements, compile the board-compatible `Servo` library, and verify its signal pins on the actual board. Supply servos from a suitable separate supply with its GND tied to board GND; do not power an unknown servo from a GPIO. SSTuino II's manufacturer specifically notes that servo current can reset the board. [Manufacturer FAQ](https://knowledge.fourier.industries/frequently-asked-questions-faq-sstuino-ii.html).

Set `ENABLE_SERVOS` to `1` only after that check. The provisional 90° closed / 120° open values are **not calibrated for your linkage**. Start with the horn detached, set a safe neutral position, then fit and adjust each row's `closedDegrees` / `openDegrees` so the flap never pushes against a hard stop. Servos attach to move and detach after 600 ms. In limit-switch mode the channel remains a manual physical input and does not drive its servo.

For the default button mode, typing `WIN1:1` changes its logical state and echoes `WIN1:1`; with calibrated servos enabled it also commands movement. An echo confirms the requested servo command, not measured position. The other protocol controls (fan, AC, purifier and scenario) are logical states only in this sketch; no motors, relays, fan-yaw servo or sensor wiring is provided.

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
```

The C++ check exercises the actual sketch's default protocol, overflow recovery, switch debounce and limit-switch authority through mocked Arduino functions. It is not an AVR board compile or a physical test. Actual USB, switch wiring, servo movement, firmware upload and board-core compatibility still require the team's hardware.

Written by gpt-6-astra in Codex on behalf of Edmund
