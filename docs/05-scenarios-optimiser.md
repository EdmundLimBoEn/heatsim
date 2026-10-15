# 05 · Scenarios and placement optimiser

**Main apartment implementation:** the apartment view and layout optimiser use the spatial **2D plan-view toy CFD** in `src/plan-simulation.ts`. The original 3D WebGPU LBM design is deferred. This document describes the implemented fallback, including its limits.

## 1. Scenario presets (`SCENARIOS` and `PRESETS` in `src/simulation.ts`) [V code; all numbers illustrative]
Heat and haze come **only** from these presets or manually entered on-screen conditions (no sensors, no live API). Each scenario sets the outdoor boundary conditions and initial indoor fields, then the user or hardware toggles openings and devices.

Façade naming follows the JSON plan: **N = z<0 side** (master, bedroom2, bedroom3 windows), **S = z>7.5** (living windows, service yard window, main door), **W = x<0** (master window 2, kitchen window), **E = x>12** (bedroom3 window 2, living window 3).

| # / key | id | Label | T_out °C | C_out µg/m³ | T_in0 °C | C_in0 | Sunny façades | Windward (ρ=1.003) | People | Default open |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 `Q` | `baseline` | Normal day | 30 | 20 | 30 | 15 | none | S (ρ 1.002) | no | none |
| 2 `W` | `hot_afternoon` | Hot afternoon (west sun) | 34 | 25 | 31 | 20 | **W** | S | yes | none |
| 3 `E` | `haze_outside` | Haze outside | 31 | **200** | 30 | 40 | none | S | yes | none |
| 4 `R` | `hot_haze` | Hot + hazy | 34 | 150 | 31 | 40 | W | S | yes | none |
| 5 `T` | `night_cool` | Evening cool-down | 27 | 20 | 31 | 15 | none | N (ρ 1.002) | yes | none |
| 6 `Y` | `validation` | Validation case (setup from doc 06) | 33 | 100 | 28 | 0 | none | N (ρ 1.003) | 100 W heat block in bedroom3 | internal doors open; exterior openings selected manually |

- The original planning notes cite **203 µg/m³ 1-h PM2.5 (west), 14 Oct 2026 9 PM** as inspiration for the 200 haze preset. The application treats 200 as an illustrative scenario value and fetches no live NEA data.
- The density values in the table remain scenario metadata from the LBM design. The implemented 2D pressure solve uses the manual wind-from façade when set, otherwise the scenario windward façade, and a heuristic pressure proportional to wind speed; it does not simulate lattice density. Preset wind speed is 1.2 m/s for `baseline` and `night_cool`, and 1.8 m/s otherwise.
- Fresh preset objects start with devices off and openings closed, except validation's internal doors. In the UI, **changing scenario preserves the existing windows, doors, device states, positions and AC setpoint**, resets indoor fields and simulated time, and clears old optimiser results. Selecting `validation` additionally opens all internal doors; exterior openings and devices remain as set.
- The fallback starts immediately from the specified indoor fields; there is no hidden 300-step LBM warm-up. Preset time is 20:00 for `night_cool` and 14:00 otherwise. Time of day scales west-sun heating. Humidity is a fixed comfort assumption, not a simulated moisture field.
- The UI shows each scenario's one-line story, e.g. "PM2.5 is 200 outdoors. Should Mdm Tan open the window?"

### Manual conditions and comparison context

The main **Outside the home** controls accept temperature **10–60°C**, wind speed **0–10 m/s**, PM2.5 **0–1000 µg/m³**, and **Wind from** North/East/South/West or Scenario direction. “From North” means towards the south. Manual edits retain current fields, devices and openings; **Reset outdoor conditions to scenario** restores preset weather without resetting those fields. Selecting another scenario clears the manual overrides and starts fresh indoor fields. Sun/occupancy behavior remains tied to the scenario, so manual temperature alone does not turn a night case into a sunny afternoon.

The **US EPA PM2.5 index equivalent (24-hour scale)** is a display/input convenience for scenario PM2.5, not Singapore PSI, a live AQI reading or a health forecast. It does not assert that a manually entered value has been averaged for 24 hours. The concentration remains the solver input. The main app accepts an equivalent integer **0–500** and maps it to a representative concentration; concentrations outside the supported equivalent scale remain valid raw inputs up to 1000 µg/m³. [Doc 02](02-simulation.md) records the rounding rule and official breakpoint source. Cooling Lab displays the equivalent alongside its shared outdoor concentration.

Cooling Lab can optionally prescribe a different sheltered reservoir at **the exterior main door only**. Its current corridor values, outdoor conditions, scenario initial fields and duration are shared by both arms of every comparison. That boundary is fixed, not a simulated corridor that responds to the flat. See the [step-by-step experiments](presentation-demo.md).

## 2. Demo storyline using the presets
1. `haze_outside`, all closed → indoor C stays low but T creeps up (people).
2. Open the **Bedroom 3 internal door** with `Shift+2` (`DOOR2`), then open WIN1 (bedroom3 north window, `1`) and DOOR1 (main door, `Shift+1`). All three must be open for the bedroom3 → corridor → dining ventilation path. Haze can then enter and spread along this path. For the separate validation demonstration, `Y` opens internal doors automatically; select the exterior openings manually.
3. Close the windows, turn the purifier on at a chosen slot, then press **Compare layouts** (`O`). Review the suggested positions and the measured **combined heat + haze + power score**, then press **Apply** (`Enter`). The percentage is improvement in this combined score, not a percentage reduction in haze alone.
4. Switch to `hot_afternoon` → the west rooms heat. Compare AC allowed vs fan-only to show the power trade-off (SDG 13). An allowed device can remain off if its benefit does not outweigh its power cost. Do not promise a positive improvement: the current layout may already be best.

## 3. Device slots (`src/config/slots.ts`) [D, positions in metres; snap to the nearest valid FLUID region at load]
Yaw convention: `d = (sin yaw, 0, cos yaw)`, so **yaw 0° = south (+z), 90° = east (+x), 180° = north, 270° = west**. Hardware `FANANG` 0..180 maps to `yaw = baseYaw + (FANANG − 90)`.

Portable fan slots (`FANPOS`):
| Slot | Room | x | z | baseYaw | Note |
|---|---|---|---|---|---|
| 0 | bedroom3 | 10.0 | 1.6 | 180 | facing the north window |
| 1 | corridor | 8.0 | 3.9 | 90 | corridor is 1 m wide, so this is tight; check clearance |
| 2 | living | 11.3 | 5.0 | 270 | |
| 3 | dining | 6.9 | 6.9 | 180 | |
| 4 | master_bedroom | 3.2 | 1.8 | 270 | |

Purifier slots (`PURPOS`):
| Slot | Room | x | z |
|---|---|---|---|
| 0 | living (GLB `purifier_living`) | 7.6 | 4.75 |
| 1 | master (GLB `purifier_master`) | 3.4 | 0.4 |
| 2 | bedroom3 | 11.5 | 2.8 |
| 3 | bedroom2 | 8.3 | 1.5 |
| 4 | living corner | 11.5 | 7.0 |
| 5 | dining | 4.7 | 7.1 |

AC units: the four wall units in the JSON (`ac_living`, `ac_master`, `ac_bedroom2`, `ac_bedroom3`). At most one is on at a time today (keeps the UI simple).

## 4. Optimiser (`src/optimiser.ts`, `src/optimiser.worker.ts`) [V code and tests]

### Problem and score
Given a snapshot of the scenario and controls, compare layouts within an **available-device budget**:

- `fan`: at most one portable fan.
- `fan+purifier` (default): at most one portable fan and one purifier.
- `fan+purifier+ac`: also permit one of the four AC units, at 25 °C.
- **"Also suggest windows and doors"** (default ON): only the five openings in `HARDWARE_OPENINGS` (doc 04 §3).

Budgets allow equipment; they do not require it to be on. New proposals disable the existing fixed fans, fixed purifiers and AC units, then consider the devices above. The user's exact current layout is always retained as a comparison candidate, even if it uses more devices than the selected budget. If it wins, the recommendation can be to keep it.

The score is computed from the final simulated room readings, with each room weighted by its JSON `area_m2`:

```text
A = sum(room.area_m2)
heat  = sum(area × max(0, room.feelsLike − 28)) / A
haze  = sum(area × room.pm25 / 35) / A
power = result.powerWatts / 1000
J = heat + haze + power
```

The API calls the power contribution `breakdown.energy`; it is **instantaneous illustrative power in kW**, not accumulated kWh. The weights on haze and power are both 1. The plan engine derives `feelsLike` from room temperature and airflow, with its fixed humidity comfort adjustment:

```text
feelsLike = T + max(0, T − 24) × max(0, humidity − 40) / 100 − min(3, 2.5 × speed)
```

This is an illustrative comfort proxy, not a recognised heat-index or health standard. Room means come from the plan grid; there is no 3D occupied-height zone in this fallback. Lower `J` is better. The percentage is `100 × (J_you − J_suggestion) / J_you`, or zero when `J_you = 0`. Nonfinite or invalid readings fail the comparison instead of producing a recommendation.

### Candidates and greedy search

- Fan: 5 slots × hardware angles **{45°, 90°, 135°}**, all at speed 2 = **15 candidates**. These correspond to yaw offsets {−45°, 0°, +45°} from the slot's base heading.
- Purifier: **6** slots, when allowed.
- AC: **4** units, when allowed; setpoint 25 °C.
- Openings: sequentially toggle each of the five mapped openings from the current greedy layout.
- Include the unchanged user layout and the same openings with all devices off.

```text
score the user's exact current layout first
layout = user's openings, devices off
if suggestOpenings:
    for each mapped opening:
        score layout with that opening toggled
        retain the toggle for later stages only if J improves by more than 2%
for device in [AC if allowed, purifier if allowed, fan]:
    score its candidates added to the current layout
    keep the best improvement, or leave this device off
return the three lowest-J distinct evaluated layouts, including the user's layout in the candidate pool
```

All evaluated candidates, including intermediate layouts, are eligible for the result. Repeated identical layouts reuse their score. There are **at most 32 evaluations**: 2 baselines + 5 openings + 4 AC + 6 purifier + 15 fan. With an initially empty layout the two baselines coincide, reducing the count by one. This is a bounded greedy search, not an exhaustive or globally optimal search. The first recommendation is never worse than the scored user layout; alternatives may be worse when fewer improvements exist.

### Evaluation and runtime budget

- Every candidate starts from the **same scenario's initial temperature and haze fields**, with that candidate's controls applied. It does not inherit the current live field or any previous candidate's field.
- Run the same `createSimulation` / `stepSimulation` implementation as the live app in a dedicated worker: **240 calls × 0.5 simulated seconds = 120 simulated seconds**. The solver takes its own stable substeps within those calls.
- Score the final 120-second reading. There is no final-window averaging and no WebGPU or coarse 3D LBM evaluation in this **layout search**; optional live-view GPU transport does not change the optimiser backend. The report identifies the engine as **`2d-plan`**.
- Physics and candidate order are deterministic. Every completed candidate gets the same simulated duration, including when the run is time-limited.
- The search stops starting new evaluations after a **25-second soft deadline**, returning already evaluated layouts with `partial: true`. Such a result can contain fewer than three layouts.
- The main thread terminates the worker after **29 seconds** if no result arrives, reports an error, and leaves the user's controls unchanged. Cancel, replacement runs and disposal also terminate the worker. Worker errors and message-decoding errors are caught; stale worker events are ignored.
- The live simulation continues independently. There is no LBM `stepsPerFrame` setting to change in this fallback.

[V] During implementation, actual Bun worker runs completed a 27-evaluation haze `fan+purifier` comparison in about 6.4 seconds and a 31-evaluation full-budget comparison in about 7.4 seconds. These are local runtime checks, not a Chrome frame-rate guarantee. Unit tests cover deterministic ranking, budgets, mapped openings, baseline retention, invalid results, cancellation, progress and worker lifecycle failures.

### Worker and app APIs

```ts
// App API (src/optimiser.ts)
createOptimiser({ onProgress, onResult, onError })
// returns { run(conditions, budget, suggestOpenings), cancel(), dispose() }

// main → worker
{ type: "run", conditions, budget, suggestOpenings }
// Cancellation terminates the worker; there is no cancel message.

// worker → main
{ type: "progress", progress: { done, total, bestJ } }
{ type: "result", report: {
  engine: "2d-plan",
  you: { conditions, result, J, breakdown: { heat, haze, energy }, improvementPct },
  layouts: [{ conditions, result, J, breakdown, improvementPct }],
  evaluations, durationMs, simulatedSeconds: 120, partial
} }
{ type: "error", message }
```

### Result UI and Apply

The result card displays the before/suggested score, combined-score improvement, heat/haze/power contributions, device positions, opening-change count, engine, evaluation count and comparison duration. A selector exposes the alternative layouts. Suggestions are text in the card; the model updates when applied.

**Apply** (`Enter`) replaces the controls with the selected layout, restarts the live simulation, and keeps the comparison card available for presentation. The app sends changed, mapped control commands through the existing hardware path. Only firmware-enabled actuators physically move: fan and purifier positions are logical settings, not motorised relocation. Actual servo movement requires a connected, calibrated board and is a separate hardware acceptance check.

Editing controls or changing scenario invalidates an old recommendation. Cancel and errors preserve the live setup. No result is automatically applied, and no improvement is fabricated from live readings after Apply.

## 5. Cooling Lab matched experiments

This is separate from the layout optimiser above. `src/thermal-comparison.ts` and `src/thermal-worker.ts` run two explicit configurations using the two-layer/surface model in [doc 02](02-simulation.md). They do not search layouts, use the current live temperature field or automatically apply an arrangement to the 3D apartment.

**Quick fan off / on** changes only `config.vent.on`. Weather, corridor boundary, openings, supply/exhaust direction, rating, envelope and other devices stay identical. The selected aperture has the same adapter in both arms; its passive fan passage can carry wind/buoyancy-driven flow with the motor off.

**Captured baseline / candidate** lets the user capture interventions, adjust the candidate, then compare. Captured interventions are windows, doors, fixed devices, portable fan, purifier, AC setpoint, high-level fan settings and envelope properties. The actual baseline is rebuilt from the **current candidate's** scenario, outdoor temperature/PM2.5, humidity, time of day, wind speed/direction, corridor boundary and duration; only the saved interventions are restored. Historical weather from the capture is not reused. Changing the fan location changes its adapter location deliberately; all varied settings are listed in the result.

Both cases clone **one current-scenario initial `ThermalState`**, including lower/upper air, particles, surfaces and counters. Neither inherits a previous trial's warmed fields. The horizon is `durationSeconds`: positive, at most **7200 seconds**, default **1200 seconds**. Both arms share initial/final sample times and retain at most **121 samples** each.

All differences are **candidate minus baseline**, equivalent to **fan ON minus fan OFF** in quick mode:

| Difference | Interpretation |
|---|---|
| All-air temperature, °C | Negative means the candidate ends cooler across both air layers; not an occupied-zone comfort score. |
| Upper-layer temperature, °C | Negative means the upper layer ends cooler. Per-room lower-layer readings describe the occupied zone. |
| PM2.5, µg/m³ | Negative means lower final model concentration; hotter/hazier replacement air can worsen a result. |
| Cumulative PM exposure, µg·h/m³ | Integral of whole-flat model concentration over time; not inhaled dose or measured personal exposure. |
| Actual fan flow, m³/h | Difference in flow signed relative to each case's chosen direction. If directions differ, read both configurations before interpreting the delta. |
| Boundary air changes, h⁻¹ | Difference in incoming boundary flow divided by volume, excluding internal-room recirculation. |
| Sensible heat removed, W / integrated J | Positive removal exports sensible heat; negative removal adds heat. The delta compares the candidate's removal with the baseline's. |
| Stored heat, J | Difference in state energy, separate from accumulated ventilation heat removal. |
| Electrical energy / vent-fan energy, Wh | Whole-flat consumption / the selected vent fan's consumption. Neither is heat removed or a COP. |

```ts
const runner = createThermalComparisonRunner();
runner.run(config, onProgress);                       // quick fan off / on
runner.compare(capturedBaseline, candidate, onProgress); // explicit interventions
runner.cancel();
runner.dispose();
```

The report contains `comparisonMode`, actual `baselineConfig` and `candidateConfig`, and `variedSettings`. For compatibility, `off` and `on` are the baseline and candidate result fields even in configuration mode; UI/CSV labels follow the mode. Cancellation/disposal terminate the worker and reject with `AbortError`. A **30-second wall-clock timeout** handles a missing result. Stale or cancelled results are discarded, and editing experiment settings clears the old result. No improvement is guaranteed.

CSV records the actual two configurations, shared current environment/corridor, shared initial state, matched traces, final room values, changed settings, units and sign convention. Instantaneous heat-budget rates in W, integrated heat in J and electricity in Wh remain separate. A mismatch in the report's environment or duration prevents export.

The ideal-expansion calculator is independent. It does not change either arm's temperatures or use the main scene's normalized pressure index.

## 6. Contractor Study: three supplied plan options

`src/contractor-comparison.ts` / `src/contractor-worker.ts` compare exactly **three validated plans**, using `createThermalModel(plan)` for each. This is neither the greedy main-apartment optimiser nor Cooling Lab's captured-baseline pair. The input carries a shared brief/weather, initial uniform air/surface temperature and PM2.5, total occupancy and horizon, plus each plan's explicit geometry/openings/devices. Plans need distinct IDs. The same geometry may be copied under separate IDs for configuration comparisons.

Each case has its own state arrays and heat capacities. The worker verifies shared initial numeric conditions and exact elapsed duration, preserves at most **121 trace samples per plan**, and uses the same partial final interval when necessary. The API permits a positive horizon up to **7200 s**; the UI offers 10/20/30 minutes. Cancellation, replacement, error handling and a **30-second timeout** prevent an unfinished run from becoming a completed report.

Recommendations identify the lowest final all-air temperature, lowest final mean PM2.5 and lowest total electricity independently. Ties use **0.1°C**, **1 µg/m³**, and **max(0.1 Wh, 1% of the lowest electricity)**. A shortlist retains options not matched/improved across all three metrics and meaningfully beaten on at least one by another tested option. There is no overall weighted winner or exhaustive optimisation. Different area/equipment counts are disclosed; total Wh and Wh/m² are both retained.

The scope is **one weather case**. Rankings are conditional, and no automated weather-stability analysis is claimed. The handoff preserves actual plan inputs/configurations, model outputs and manually recorded weather provenance. Read [the input, workflow and model guide](contractor-study.md) before presenting the result as a contractor option study. It is a noncommercial hackathon demonstration of a future pre-design workflow, not certified engineering advice or an implemented licensing business.

Written by gpt-6-astra in Codex on behalf of Edmund
