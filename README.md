# HeatSim

**Run the complete presentation demo with a keyboard and on-screen controls. No SSTuino, electronics, account or server backend is required.** HeatSim explores heat, ventilation and haze in an approximate 4-room HDB flat, with a printable cardboard model for the team to build.

The working MVP renders a 3D apartment in three.js and runs a **qualitative 2D plan-view simulation** underneath it. The board has not arrived; USB control is an optional next step. See [verified checks and remaining work](CHECKLIST.md).

## Run it

From this repository, using Bun and a supported Node.js installation (22.12+ in the 22.x series, or 24.x):

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://localhost:5173** in desktop Chrome or Edge. Keep the terminal running. If Vite reports another port because 5173 is occupied, use the address it prints. Internet is needed to install dependencies; the running app uses local assets and does not fetch weather or sensor readings.

npm also works:

```sh
npm install
npm run dev
```

Checks and a production preview:

```sh
bun run test
bun run build
bun run preview
```

The preview defaults to **http://localhost:4173**. Equivalent commands are `npm test`, `npm run build` and `npm run preview`. Regenerate the cardboard pack with `bun run build:pack` or `npm run build:pack`; that command needs Python 3 and uses its standard library.

## Give these files to the build crew

The footprint is **187.692 × 118.462 mm**, inside the requested **200 × 150 mm** area and an A4 base. All walls are **40 mm tall**. The roofless model uses **two A4 sheets of 3 mm cardboard total**: one base and one extra sheet containing all 13 walls. Reuse opening cutouts as leaves; paper templates and tape are separate.

- [Complete build-pack ZIP](public/build-pack/heatsim-build-pack.zip)
- [Builder handoff and assembly order](docs/physical-model.md)
- [A4 floor plan](public/build-pack/floor-plan.svg)
- [All 13 walls nested on one A4 sheet](public/build-pack/all-walls-stock.svg)
- [Door/window leaves](public/build-pack/door-window-leaves.svg), [wall dimensions](public/build-pack/cut-list.csv), [opening dimensions](public/build-pack/openings.csv)
- [Printable pack and schedules](public/build-pack/index.html), served at **http://localhost:5173/build-pack/** while the app runs

Print at **100% / Actual size**, turn off “Fit to page”, and measure the **50 mm calibration bar** before cutting. The handoff accounts for 3 mm butt joints and one narrowed doorway. Dry-fit actual stock before gluing; no real switch or servo mounting dimensions are assumed.

## A short standalone demo

Use the [presentation walkthrough](docs/presentation-demo.md) for the final rehearsal and recovery steps.

1. In **Environment**, close all windows and doors. Press **Y** for **Validation case**; it opens the internal doors while leaving exterior openings as they are. Select the **Airflow** overlay.
2. Press **1** to open the bedroom 3 north window and **Shift+1** to open the main door. The connected route through bedroom 3, the corridor and living/dining now carries air. Select **Air quality** to see the outdoor tracer move indoors.
3. Press **E** for **Haze outside**. Openings and devices are retained when changing scenarios. Close the window and main door, choose the purifier's **Bedroom 3** slot in **Devices**, then press **P**. Compare the room's PM2.5 before and after simulated time passes.
4. Press **W** for **Hot afternoon**. Use **F** for the portable fan, and compare comfort with the fan off/on. Choose an AC unit and use **A** to compare cooling and the illustrative power reading. A fan moves air; it does not refrigerate the room.
5. Press **O** to compare layouts in a background worker. Review the suggestion and **click Apply layout**. Enter is also available when focus is outside a button or form control. Applying starts a fresh simulation, so comparisons share the scenario's initial conditions.
6. Use **All room readings** to inspect all rooms and export CSV; use the camera button to download the view. Open **Build the physical model** for the printable pack.

Playback starts at **30×**. **Space** pauses/resumes, **Backspace** resets fields and the simulation clock while keeping controls, and **H** shows the shortcuts. Keyboard shortcuts pause while typing in a form control or using a dialog. Everything needed for this demo is also on screen.

## Optional electronics, when the board arrives

Follow [the wiring and firmware guide](docs/hardware.md) and [protocol v1](docs/04-hardware-protocol.md). The proposed default sketch has **two physical inputs**: WIN1 on D5 and DOOR1 on D6, each using `INPUT_PULLUP` and a switch to GND. It supports either momentary buttons or per-channel limit-switch mode.

USB uses **115200 baud, ASCII `KEY:VALUE` lines**. There are no temperature, humidity or PM sensors. **Servos are disabled by default.** Board selection, firmware upload, switch wiring, USB round trips and servo power/travel have not been physically verified. Do those checks when the actual SSTuino and parts arrive; the standalone demo needs none of them.

## What the simulation means

HeatSim is a **qualitative toy CFD demonstration**, not a validated building assessment. A **64 × 48 grid with 20 cm cells at y = 1.2 m** transports heat and PM2.5 using a steady pressure-flow approximation. It has no vertical buoyancy or turbulence. The 3D view is a presentation of the apartment, not a 3D airflow solver.

Outdoor conditions and initial fields come from six scenarios. Power assumes **50 W per fan, 40 W per purifier and 1000 W per active AC**, and energy integrates those assumed watts over simulated time. Comfort is an illustrative indicator, not a medical heat index. No sensors or live environmental API are used. The master-bath window is above the slice and has no effect on this 2D field. Pressure, when displayed, is a **normalized qualitative index from −1 to +1**, not pascals or measured building pressure; arrows indicate simulated planar flow direction. Pressure is normalized separately for each arrangement: compare colors within the current layout, not as absolute pressure differences between layouts.

**No 3D LBM/WebGPU engine or SimScale/OpenFOAM validation has been completed.** The original plans for those remain in `docs/` as a clearly marked roadmap. Do not say that the model has been validated against professional CFD or real hardware.

## Project map

- [Current architecture](docs/01-architecture.md) and [implemented simulation](docs/02-simulation.md)
- [Rendering and controls](docs/03-rendering-ui.md)
- [Six scenarios and layout comparison](docs/05-scenarios-optimiser.md)
- [Acceptance checklist](CHECKLIST.md), [build plan](docs/07-build-plan.md), [assets and provenance](docs/08-assets.md)
- [Original reference-CFD plan, not completed](docs/06-validation-simscale-openfoam.md)

Written by gpt-6-astra in Codex on behalf of Edmund
