# HeatSim

**Run the complete presentation demo with a keyboard and on-screen controls. No SSTuino, electronics, account or server backend is required.** HeatSim explores heat, ventilation and haze in an approximate 4-room HDB flat, with a printable cardboard model for the team to build.

The app has two separate teaching models:

| Workspace | What it illustrates | What it does not claim |
|---|---|---|
| **3D apartment** | A 3D scene around a qualitative 2D plan-view airflow, heat, haze and relative-pressure field. | Full 3D airflow, turbulence or measured pressure. |
| **Cooling Lab** | A separate whole-flat model with lower/upper air layers and a surface temperature per room; matched high-level fan off/on experiments, envelope controls and an ideal-expansion calculator. | Calibrated building performance, a resolved 3D plume, or cooling produced by ideal expansion in the room solver. |

The board has not arrived; USB control is optional. [CHECKLIST.md](CHECKLIST.md) records the completed software checks and the remaining physical/rehearsal work.

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

## Cooling Lab

Cooling Lab studies the **full-size flat**, independently of the running 3D apartment's readings. It uses two air layers and a lumped surface temperature in each room to illustrate heat storage, conduction, surface-to-air exchange, solar gains and ventilation. It is a reduced-order teaching model, not 3D CFD.

The matched experiment changes only the selected high-level fan's on/off state; both cases start from the same state and run for the same simulated duration. Compare occupied-layer temperature, upper-layer temperature, haze, heat stored and estimated electricity together. An exhaust needs a connected make-up-air route. Hotter or hazier replacement air can make an outcome worse. A circulating fan mixes air and adds energy rather than manufacturing cold air.

The pressure/temperature calculator is separate: its ideal isentropic static-temperature drop is **not** subtracted from room temperatures. The main scene's pressure index cannot be entered as pascals. See [cooling science](docs/cooling-science.md) and [fan thermodynamics](docs/fan-thermodynamics.md) for the physical explanation and sources.

Envelope properties and fan flows describe assumptions about the **full-size flat**, not the 3 mm cardboard. The build pack remains **two A4 sheets with no roof**; no extra cardboard or hardware fit is implied.

## A short standalone apartment demo

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

HeatSim is a **qualitative teaching demonstration**, not a validated building assessment. The main apartment view is toy CFD: a **64 × 48 grid with 20 cm cells at y = 1.2 m** transports heat and PM2.5 using a steady pressure-flow approximation. It has no vertical buoyancy or turbulence. The 3D view is a presentation of the apartment, not a 3D airflow solver.

In the main apartment, outdoor conditions and initial fields come from six scenarios. Its power display assumes **50 W per fan, 40 W per purifier and 1000 W per active AC**, and energy integrates those assumed watts over simulated time. Comfort is an illustrative indicator, not a medical heat index. No sensors or live environmental API are used. The master-bath window is above the slice and has no effect on this 2D field. Pressure, when displayed, is a **normalized qualitative index from −1 to +1**, not pascals or measured building pressure; arrows indicate simulated planar flow direction. Pressure is normalized separately for each arrangement: compare colors within the current layout, not as absolute pressure differences between layouts.

Cooling Lab is a different reduced-order calculation. Its layer and surface temperatures, exchange rates and envelope coefficients are assumptions, not measurements. It does not transport humidity, model condensation/dehumidification, or establish a health-safe ventilation strategy. Neither model validates the other.

When WebGPU is available, the apartment can run **heat and haze transport on the GPU while airflow stays on the CPU**. It automatically continues on CPU if the GPU path is unavailable or fails. Check the visible engine badge; neither mode changes the planar physics. Cooling Lab runs separately in its CPU worker. Actual GPU verification is recorded in the checklist, independently of mocked tests.

**No 3D LBM engine or SimScale/OpenFOAM validation has been completed.** The original plans for those remain in `docs/` as a clearly marked roadmap. Do not say that the model has been validated against professional CFD or real hardware.

## Project map

- [Current architecture](docs/01-architecture.md) and [implemented simulation](docs/02-simulation.md)
- [Rendering and controls](docs/03-rendering-ui.md), [cooling science](docs/cooling-science.md) and [fan thermodynamics](docs/fan-thermodynamics.md)
- [Six scenarios and layout comparison](docs/05-scenarios-optimiser.md)
- [Acceptance checklist](CHECKLIST.md), [build plan](docs/07-build-plan.md), [assets and provenance](docs/08-assets.md)
- [Original reference-CFD plan, not completed](docs/06-validation-simscale-openfoam.md)

Written by gpt-6-astra in Codex on behalf of Edmund
