# Three-minute standalone presentation

The complete demo works without an SSTuino. The board has not arrived, so describe physical switches and servos as the next integration step. The current demonstration is **qualitative toy CFD**: a 3D apartment showing a 2D plan-view approximation, not measured or calibrated building performance.

## Prepare before presenting

1. Run `bun run dev`, open the printed localhost address, and refresh once to start from the default controls. Keep the terminal running.
2. Select **Floor plan** and keep **Cutaway** on. Choose **30× speed** explicitly: four real seconds represent about two simulated minutes when the browser can keep up. Use the displayed simulation clock as the reference.
3. In **Environment**, click **Close windows** and **Close all doors**. In **Devices**, ensure portable fan, purifier and AC are off. Fresh loads already have these states; scenario changes preserve existing controls.
4. Use the controls below on screen. Keyboard shortcuts are optional: **Y** selects Validation, **1** toggles its north window, and **Shift+1** toggles the main door. Shortcuts are suspended while a form field or dialog has focus. Click a neutral heading before using them.

## Walkthrough

| Time | Do | Say |
|---|---|---|
| 0:00–0:20 | Show **3D model**, briefly switch **Isometric → Floor plan**. | “HeatSim helps us ask what happens when we change a home's openings and devices. This is an approximate four-room flat, and every reading is simulated.” |
| 0:20–0:55 | Select **Validation case**, then **Airflow**. With outside openings closed the field is still. Open the bedroom 3 **north window** and the **main door**. Select **Pressure**, then return to **Airflow**. | “Opening both ends creates a connected ventilation route through bedroom 3, its internal door, the corridor and living/dining. The arrows show direction. Pressure colours show a relative index for this arrangement, not pascals.” |
| 0:55–1:20 | Select **Air quality** and let the clock advance at least two simulated minutes. Then select **Haze outside**, click **Close windows** and **Close all doors**, and turn on the portable purifier at **3. Bedroom 3**. Watch that room after two more simulated minutes. | “An open route also carries outdoor haze indoors. With the openings shut, the purifier lowers particles near the room where we place it.” |
| 1:20–2:00 | Turn the purifier off. Select **Hot afternoon (west sun)**. In **Devices**, use the portable fan at **1. Bedroom 3**, medium speed. Compare **Airflow** and the selected room's **Feels like** reading. Turn the fan off, select the AC's **Bedroom 3** room, turn AC on, and show **Temperature** after two simulated minutes. | “A fan moves air and changes our illustrative comfort score; it does not refrigerate the room. AC lowers temperature but uses more of our assumed device power.” |
| 2:00–2:40 | Turn AC off. Select **Haze outside**, keeping all windows and doors closed. Set **Available devices → Fan + purifier**. Click **Compare layouts** and explain the trade-off while it works. Review the first result and **click Apply layout**. | “We compare arrangements from the same starting conditions. This percentage combines heat, haze and assumed power; it is not the percentage of haze removed. The search may decide the original arrangement is already best.” |
| 2:40–3:00 | Show **All room readings** or export a CSV. Close the dialog and open **Build the physical model**. | “The screen model comes with a build pack: two A4 sheets of 3 mm cardboard, no roof. The building is about 188 by 118 mm. We can add physical buttons later; the web demonstration already works independently.” |

Validation deliberately opens **all internal doors** when selected. That includes bedroom 3's door; closing it breaks the demonstrated route. **Haze outside does not open that door on a fresh load.** To repeat cross-ventilation directly from Haze outside, also open **Bedroom 3 → Door to corridor** (`Shift+2`). The haze scenario's wind direction differs from Validation, so do not narrate both as the same north-to-south flow.

## Rehearsal evidence

The following were checked directly with the current plan engine on 15 October 2026, from fresh preset fields for **120 simulated seconds**. They establish a visible cause and effect; they are not real-world predictions, promises of exact live readouts, or browser frame-rate measurements.

| Setup | Bedroom 3 result |
|---|---|
| Validation, internal doors open, exterior openings closed | 0.00 m/s mean air speed; PM2.5 stays at 0 |
| Validation, only north window open | Approximately zero mean speed; particles spread slowly by diffusion |
| Validation, north window and main door open | About 0.15 m/s mean speed; PM2.5 approaches the illustrative outdoor value of 100 µg/m³ |
| Haze outside, all openings closed, purifier off | PM2.5 stays at the initial 40 µg/m³ |
| Same closed haze setup, portable purifier in bedroom 3 | PM2.5 falls to about 22.5 µg/m³ |
| Hot afternoon, closed, no devices | About 31.1°C temperature and 33.2°C illustrative feels-like |
| Same hot setup, portable fan in bedroom 3 | Temperature stays about 31.1°C; feels-like falls to about 32.8°C; assumed power 50 W |
| Same hot setup, bedroom 3 AC only, 25°C setpoint | About 25.7°C temperature; assumed power 1000 W |

A closed Haze outside comparison with no active devices and the **Fan + purifier** budget evaluated 27 layouts in about nine seconds in a local Bun run. Its best combined score was about 2.25% lower. Browser timing and later tuning can differ; present the actual displayed result, including zero improvement or a time-limited search.

## Avoid surprises on stage

- **Scenario selection preserves openings and equipment.** Close them or turn them off explicitly for a clean comparison. **Reset readings** restarts fields and time while keeping the current controls.
- **Click Apply layout.** Enter activates a focused button, so after clicking Compare layouts it may start another comparison instead of applying the result.
- **Use room readings for local effects.** A purifier or AC in one bedroom changes that bedroom more clearly than the whole-home average.
- **A sealed flat can correctly show no airflow or pressure variation.** A single opening alone does not create a sustained through-flow in this steady 2D approximation. Use the connected two-opening case or a powered fan to demonstrate motion.
- **Pressure is normalised within each arrangement.** Colour intensity cannot establish an absolute pressure increase between two different arrangements. This model does not simulate vertical buoyancy or turbulence.
- **Pause with the on-screen Pause button** while explaining a result. Close dialogs before returning to shortcuts. Changing controls invalidates a previous optimiser comparison.
- **Do not claim reference-CFD or electronics validation.** No SimScale/OpenFOAM comparison, board upload, real USB round trip or servo calibration has been completed. The master-bath window is above the simulated slice and does not change the 2D field.

Written by gpt-6-astra in Codex on behalf of Edmund
