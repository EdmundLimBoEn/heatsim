# HeatSim

**Run the complete presentation demo with a keyboard and on-screen controls. No SSTuino, electronics, account or server backend is required.** HeatSim helps homeowners explore window, fan and purifier choices in an approximate 4-room HDB flat, with a printable cardboard model for the team to build. Results are simulated comparisons, not measurements or personalised health advice.

The app has three workspaces, using a planar model and a separate room/layer thermal model:

| Workspace | What it illustrates | What it does not claim |
|---|---|---|
| **My flat** | A 3D scene around a qualitative 2D plan-view airflow, heat, haze and relative-pressure field. | Full 3D airflow, turbulence or measured pressure. |
| **Window fan test** | A separate whole-flat model with lower/upper air layers and a surface temperature per room; matched opening, purifier, high-level fan and envelope experiments, with an ideal-expansion calculator. | Calibrated building performance, a resolved 3D plume, or cooling produced by ideal expansion in the room solver. |
| **Compare floor plans** | Three validated JSON floor plans, shared manual conditions, plan-specific room-network calculations and a reviewable client handoff. | Automatic image/PDF interpretation, surveyed dimensions, professional CFD or compliance certification. |

The supplied SSTuino is optional. The current demo uses a D4 button for both Bedroom 3 windows and a D5 held switch for its purifier; the physical USB round trip remains unverified. [CHECKLIST.md](CHECKLIST.md) records the completed software checks and the remaining physical/rehearsal work.

## Run it

From this repository, using Bun and a supported Node.js installation (22.12+ in the 22.x series, or 24.x):

```sh
bun install --frozen-lockfile
bun run dev
```

Open **http://localhost:5173** in desktop Chrome or Edge. Keep the terminal running. **How to use HeatSim** opens a short guide when needed; it does not interrupt startup. If Vite reports another port because 5173 is occupied, use the address it prints. Internet is needed to install dependencies. Simulation calculations and plan imports use local code/assets; weather is manual or explicitly loaded from Open-Meteo. The optional Windy reference display/link needs internet and does not supply values to the simulation.

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

## Deploy the public demo

The public demo is hosted at **https://heatsim.sillyapps.co** using Cloudflare Workers Static Assets. All simulation still runs in the browser; hosting adds no backend, accounts or analytics. The corner QR code links to this address.

With the `cf` CLI authenticated to the account owning `sillyapps.co`:

```sh
bun run build:cloudflare
cf deploy --prebuilt --dry-run
cf deploy --prebuilt
```

`bun run deploy` rebuilds and deploys in one command. `scripts/prepare-cloudflare.mjs` packages only `dist/` into the Cloudflare Build Output API layout, with the custom domain declared in its generated config. This leaves local Vite development unchanged and requires no additional runtime dependency. `cf deploy` provisions the domain and HTTPS certificate; first-time certificate propagation may take a few minutes. Rebuild before deploying after any source change.

## Give these files to the build crew

The footprint is **187.692 × 118.462 mm**, inside the requested **200 × 150 mm** area and an A4 base. All walls are **40 mm tall**. The roofless model uses **two A4 sheets of 3 mm cardboard total**: one base and one extra sheet containing all 13 walls. Reuse opening cutouts as leaves; paper templates and tape are separate.

- [Complete build-pack ZIP](public/build-pack/heatsim-build-pack.zip)
- [Builder handoff and assembly order](docs/physical-model.md)
- [Opening measurement guide and nine wall reference pages](public/build-pack/measurement-guide.html)
- [A4 floor plan](public/build-pack/floor-plan.svg)
- [All 13 walls nested on one A4 sheet](public/build-pack/all-walls-stock.svg)
- [Door/window leaves](public/build-pack/door-window-leaves.svg), [wall dimensions](public/build-pack/cut-list.csv), [opening dimensions](public/build-pack/openings.csv)
- [Printable pack and schedules](public/build-pack/index.html), served at **http://localhost:5173/build-pack/** while the app runs

The [measurement guide](public/build-pack/measurement-guide.html) gives each opening's **LEFT and RIGHT cut edges from WALL LEFT = 0**, plus named **clear gaps to adjacent openings or wall ends**. Vertical measurements start at **WALL BOTTOM = 0** and include sill, top edge, opening height and cardboard above it. Follow each wall's stated viewing direction. A right-edge-to-wall-right distance can span other openings; use the named gap for the clear cardboard between neighbors.

The nine new wall reference pages are paper instructions, not additional cardboard stock. Existing cutting sheets, cut dimensions and the two-sheet material count are unchanged. The cutting sheets also retain their opening-offset/gap labels and the complete 20-opening table.

Print at **100% / Actual size**, turn off “Fit to page”, and measure the **50 mm calibration bar** before cutting. The handoff accounts for 3 mm butt joints and one narrowed doorway. Dry-fit actual stock before gluing; no real switch or servo mounting dimensions are assumed.

## Simple studio controls

Use **Home** for whole-flat switches, **Room** for individual openings, **Devices** for fan/purifier settings, **Weather** for conditions and orientation, and **Suggest** for reviewed recommendations. The model stays beside the controls on desktop. Select a room to open its controls. **More** holds USB, exports and help. The header QR opens https://heatsim.sillyapps.co.

In **Window fan test**, choose a demo and Compare; open **Customize test** to adjust its inputs.

## Add and arrange standing fans

In **My flat → Devices → Standing fans**, choose **Add fan** for up to **eight total**, including the Main fan. Use **Fan to adjust** or click a fan to select it, then set its power, speed and **Direction (degrees)**: **0° plan top, 90° plan right, 180° plan bottom, 270° plan left**.

Drag a fan onto valid room floor, or use **Move to a room** and **Exact floor position** (X right / Z down the plan, in metres) without dragging. Invalid or overlapping manual placements are rejected; Escape cancels a drag. **Remove fan** removes an added fan; the Main fan can also be deleted; Add fan restores it, and legacy Main fan controls can restore it. The purifier still uses its existing preset positions.

**Suggest changes** holds added fans fixed while trying Main fan preset positions. Apply/Undo and exports retain the added-fan setup; this is not a search over every fan’s placement. Main-fan shortcuts remain under **Main fan presets & shortcuts**. Legacy `FANPOS` clears the Main fan’s free position, and `FANANG` restores its slot-relative angle; neither removes added fans. D4/D5 controls are unchanged.

## Compare floor plans

For the **noncommercial hackathon demo**, open **Compare floor plans**, click **Try the 3 example plans** or import your own supported JSON, enter one shared weather/starting-condition brief, and compare. Each plan supplies its actual room sizes, openings, orientation and declared devices to the model. This is a separate study; imported plans do not change the original HDB workspaces or cardboard cut geometry.

Drag study appliances into another room, or use their room selectors; movement updates the room assignment used by the model and report. In My flat, standing fans use valid floor placement, while the purifier uses marked slots; fixed AC units stay fixed.

Use the [floor-plan JSON and study guide](docs/contractor-study.md) for the three examples, complete input sample, validation rules, weather provenance and report workflow. Images/PDFs are not automatically interpreted. Windy is a reference display; model conditions must be entered manually.

The launch workflow is for homeowners comparing ideas before renovating or moving. It sits between informal placement ideas and a site-specific professional assessment. This local, noncommercial demo has no billing, accounts or saved cloud projects; earlier contractor licensing ideas remain future hypotheses. Its uncalibrated results are not compliance or equipment-sizing evidence.

## Window fan test

**Window fan test** (the Cooling Lab model) studies the **full-size flat**, independently of the running 3D apartment's readings. It uses two air layers and a lumped surface temperature in each room to illustrate heat storage, conduction, surface-to-air exchange, solar gains and ventilation. It is a reduced-order teaching model, not 3D CFD.

Use **Quick fan off / on** to isolate the selected high-level fan, or **Captured baseline / candidate** to save a setup and compare changed openings, purification, fan settings or envelope properties. Both arms use the **current shared weather, corridor boundary, initial state and duration**; saving a baseline does not freeze old weather. Read the listed changed settings and compare temperature, haze, air exchange, heat removed and electricity together. An exhaust needs a connected make-up-air route. Hotter or hazier replacement air can make an outcome worse. A circulating fan mixes air and adds energy rather than manufacturing cold air.

The pressure/temperature calculator is separate: its ideal isentropic static-temperature drop is **not** subtracted from room temperatures. The main scene's pressure index cannot be entered as pascals. See [cooling science](docs/cooling-science.md) and [fan thermodynamics](docs/fan-thermodynamics.md) for the physical explanation and sources.

Envelope properties and fan flows describe assumptions about the **full-size flat**, not the 3 mm cardboard. The build pack remains **two A4 sheets with no roof**; no extra cardboard or hardware fit is implied.

## Set outdoor conditions manually

In **My flat → Weather → Set my own weather**, enter outdoor temperature, PM2.5 and wind speed; **Wind from North** means air arriving from the north towards the south. Numeric inputs and sliders stay synchronized. **Reset outdoor conditions to scenario** restores weather while retaining openings, devices and current readings; selecting another scenario also resets the indoor fields.

The optional **US EPA PM2.5 index equivalent (24-hour scale)** converts a scenario concentration to an index, or an entered integer index back to a representative concentration. It is **not Singapore PSI, live AQI or a health forecast**, and does not imply a 24-hour measurement. PM2.5 in **µg/m³** remains the model input; values beyond the index's supported range remain usable as raw concentrations. No API is called. [Method and limits](docs/02-simulation.md) follow the EPA breakpoint table.

Window fan test has its own shared outdoor controls. Its optional **Separate conditions at the main door** supplies a fixed sheltered temperature/PM2.5 boundary at the exterior main entrance only. Windows still use outdoor air. This boundary does not simulate a corridor volume or respond to heat/pollution leaving the flat; the internal corridor rooms are unchanged.

## A short standalone apartment demo

Use the [presentation walkthrough](docs/presentation-demo.md) for the final rehearsal and recovery steps.

1. In **My flat → Windows & doors**, close all windows and doors. Open **More → Science views** and enable **Show pressure and validation**. Press **Y** for **Validation case**; it opens the internal doors while leaving exterior openings as they are. Select **Air movement**.
2. Press **1** to open the bedroom 3 north window and **Shift+1** to open the main door. The connected route through bedroom 3, the corridor and living/dining now carries air. Select **Haze** to see the outdoor tracer move indoors.
3. Press **E** for **Haze outside**. Openings and devices are retained when changing scenarios. Close the window and main door, choose the purifier's **Bedroom 3** slot in **Devices**, then press **P**. Compare the room's PM2.5 before and after simulated time passes.
4. Press **W** for **Hot afternoon**. Use **F** for the portable fan, and compare comfort with the fan off/on. Choose an AC unit and use **A** to compare cooling and the illustrative power reading. A fan moves air; it does not refrigerate the room.
5. Click **Suggest changes** in **What to try** (or press **O**). Read the concrete changes and their simulated heat, haze and device-power trade-offs, then click **Apply these changes**. **Undo** restores the prior setup while it is still applicable. Comparisons start fresh under the same scenario; selecting a room does not make this a room-only optimisation.
6. Open **More** for **All room readings**, **Export readings (CSV)**, **Download map image** and **Build the cardboard model**.

Playback starts at a **30× target speed**; busy devices may advance more slowly. The clock and energy reflect simulated time actually completed. **Space** pauses/resumes, **Backspace** resets fields and the simulation clock while keeping controls, and **H** shows the shortcuts. Keyboard shortcuts pause while typing in a form control or using a dialog. Everything needed for this demo is also on screen.

## Optional electronics: D4 windows and D5 purifier

Follow [the wiring and firmware guide](docs/hardware.md) and [protocol v1](docs/04-hardware-protocol.md). The default `SINGLE_PURIFIER_SWITCH = 1` now enables both Bedroom 3 controls, with **30 ms debounce**:

- **D4 button → GND:** each stable press toggles both Bedroom 3 windows. If both are open, it closes both; otherwise it opens both. Holding or releasing does not toggle again. The two messages are `WIN1` (north) and `WIN4` (east); `WIN2`/`WIN3` still refer to the living-room windows.
- **D5 limit switch: COM → GND, NO → D5, NC unused:** hold to enable the **Bedroom 3 corner purifier**; release to disable it. This sends `PUR:ON` / `PUR:OFF`. Both inputs use `INPUT_PULLUP`; see the guide's SSTuino II versus classic-board D4 check before wiring.

On boot, both logical window states start closed and the purifier samples its physical switch. `GET:ALL` reports those three states; it does not reset fan, weather or unrelated openings. On screen, select **Bedroom 3 → Open both windows / Close both windows** for the same group action. Individual controls and keyboard **1** (north) / **4** (east) remain independent; keyboard 4 is not the physical D4 group button. Set `SINGLE_PURIFIER_SWITCH = 0` only for the alternative WIN1/D5 and DOOR1/D6 demonstration.

USB uses **115200 baud, ASCII `KEY:VALUE` lines**. There are no temperature, humidity or PM sensors. **Servos are disabled by default; no physical purifier or fan is powered.** The SSTuino II Rev A target compiles with core 1.1.3; firmware upload, switch wiring and USB round trips remain unverified on the supplied board. The standalone demo requires none of those physical checks.

## What the simulation means

HeatSim is a **qualitative teaching demonstration**, not a validated building assessment. The main apartment view is toy CFD: a **64 × 48 grid with 20 cm cells at y = 1.2 m** transports heat and PM2.5 using a steady pressure-flow approximation. It has no vertical buoyancy or turbulence. The 3D view is a presentation of the apartment, not a 3D airflow solver.

In the main apartment, six scenarios supply initial fields and default outdoor conditions; manual weather controls override the outdoor values. Its power display assumes **50 W per powered fan with nonzero speed, 40 W per purifier and 1000 W per active AC**, and energy integrates those assumed watts over simulated time. Comfort is an illustrative indicator, not a medical heat index. No sensors are used. Optional Open-Meteo regional forecasts can supply outdoor temperature, humidity and cardinal wind; they are not measured window airflow. The master-bath window is above the slice and has no effect on this 2D field. Pressure, when displayed, is a **normalized qualitative index from −1 to +1**, not pascals or measured building pressure; arrows indicate simulated planar flow direction. Pressure is normalized separately for each arrangement: compare colors within the current layout, not as absolute pressure differences between layouts.

Cooling Lab is a different reduced-order calculation. Its layer and surface temperatures, exchange rates and envelope coefficients are assumptions, not measurements. It does not transport humidity, model condensation/dehumidification, or establish a health-safe ventilation strategy. Neither model validates the other.

When WebGPU is available, the apartment can run **heat and haze transport on the GPU while airflow stays on the CPU**. It automatically continues on CPU if the GPU path is unavailable or fails. Check the visible engine badge; neither mode changes the planar physics. Cooling Lab runs separately in its CPU worker. If WebGL cannot create the 3D scene, a labelled 2D plan shows room values and arrows from the current planar solver; it does not claim successful 3D rendering. Actual GPU verification is recorded in the checklist, independently of mocked tests.

**No 3D LBM engine or SimScale/OpenFOAM validation has been completed.** The original plans for those remain in `docs/` as a clearly marked roadmap. Do not say that the model has been validated against professional CFD or real hardware.

## Project map

- [Current architecture](docs/01-architecture.md) and [implemented simulation](docs/02-simulation.md)
- [Rendering and controls](docs/03-rendering-ui.md), [cooling science](docs/cooling-science.md) and [fan thermodynamics](docs/fan-thermodynamics.md)
- [Six scenarios and layout comparison](docs/05-scenarios-optimiser.md)
- [Acceptance checklist](CHECKLIST.md), [build plan](docs/07-build-plan.md), [assets and provenance](docs/08-assets.md)
- [Original reference-CFD plan, not completed](docs/06-validation-simscale-openfoam.md)

Written by gpt-6-astra in Codex on behalf of Edmund

## Fast presentation controls

Use **Try a change** beside the apartment for internal doors, all exterior openings, ceiling fans and standing fans. Right-click a standing fan or purifier to turn it on/off or rotate it; fans can be deleted, including the Main fan. The same menus are reachable from Devices without a mouse. Purifier rotation is visual only because its cleaning source is omnidirectional.

**Choose area & weather** loads one timestamped Open-Meteo regional forecast for a Singapore area, with no key or account. Manual controls work offline; haze stays manual. Set which direction the top of the plan faces to rotate the home relative to geographic wind and sun. Wind is rounded to four directions and is not measured at the flat's window. API free use is for this noncommercial demo; see [Open-Meteo](https://open-meteo.com/) for terms and attribution.

**Window fan test** has cooler-air, blocked-route and hotter-air examples using the unchanged thermal model. **Compare floor plans → Open plan** focuses one plan and replays its recorded comparison, with room readings and flow arrows.

Written by gpt-6-astra in Codex on behalf of Edmund
