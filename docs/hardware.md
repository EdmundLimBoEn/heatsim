# Hardware: final-round prototype

| Input | Wiring | Action |
|---|---|---|
| D4 button | Button between D4 and GND | Toggle all windows |
| D3 button (optional) | Button between D3 and GND | Toggle all doors, including main entrance |
| D5 limit switch | COM → GND, NO → D5; NC unused | Held = main standing fan ON; released = OFF |

All inputs use internal pull-ups and 30 ms debounce. Leave D3 unconnected if the extra button is unavailable: doors still work on screen, and D4/D5 work normally. Buttons toggle once per press; holding does not repeat. No sensors, servos, relays or appliance power are connected. Unplug USB while changing wiring.

This wiring targets SSTuino II Rev A. The older SSTuino Classic shares D4 with Wi-Fi; do not assume its pin assignment is identical. The already-installed II core is used for the build.

## Upload the rewritten sketch

1. Open [heatsim_board.ino](../firmware/heatsim_board/heatsim_board.ino) in Arduino IDE.
2. Select **SSTuino II Rev A** and the board's USB port. Upload.
3. Open Serial Monitor at **115200**, newline endings. Send `HELLO`: expect `HELLO:HEATSIM/2`. A v1 reply means the old sketch is still running.
4. Press/release D5. Expect exactly `FAN:ON`, then `FAN:OFF` after debounce. If these do not appear, check COM/NO, common GND and pin D5. If polarity is reversed, check NO versus NC before changing code.
5. Press D4 twice: expect WIN1…WIN11 all `1`, then all `0`. Press D3 twice if fitted: DOOR1…DOOR9 all `1`, then all `0`. Holding buttons must not repeat.
6. Close Serial Monitor. Refresh https://heatsim.sillyapps.co, choose **Connect SSTuino**, and select that USB port. Look for **v2 · D4 windows / D3 doors / D5 fan**. The USB log shows the last five received messages.
7. Press/release D5 and confirm the **main standing fan** spins/stops. Move and rotate it, then repeat D5: placement must remain unchanged. D5 is not the ceiling fan or purifier.
8. Toggle D4 and optional D3; verify every window/door. Leave D3 unwired and verify D4/D5 plus on-screen doors still work. Unplug/reconnect USB and check the app remains responsive.

If the wire log shows FAN changes but nothing spins, confirm the main standing fan is visible in My flat. D5 ON restores a deleted main fan and raises a zero speed to medium. D5 owns fan power while connected; conflicting on-screen power commands return actual switch state. Disconnect USB for independent software power control.

A board reset closes logical openings; it does not move the physical cardboard pieces. Reconnect without a board reset preserves logical opening state. The purifier and added fans remain software-controlled.

## Reproducible checks

```sh
bun run test
c++ -std=c++17 -Wall -Wextra -Werror firmware/test_firmware.cpp -o /tmp/heatsim-firmware-check
/tmp/heatsim-firmware-check
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile --fqbn sstuino-ii:megaavr:4809 --warnings more firmware/heatsim_board
```

The v2 target build uses 4,515 bytes flash and 327 bytes RAM with the installed SSTuino II core. Host tests simulate Arduino inputs; they do not prove physical wiring. No upload was performed by the agent. See [protocol and complete opening mapping](04-hardware-protocol.md).

Written by gpt-6-astra in Codex on behalf of Edmund
