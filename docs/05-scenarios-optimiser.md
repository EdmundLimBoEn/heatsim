# 05 · Scenarios and placement optimiser

## 1. Scenario presets (`src/config/scenarios.ts`) [D, all numbers illustrative]
Heat and haze come **only** from these presets (no sensors, no live API). Each scenario sets the OUTSIDE reservoir and initial indoor fields, then the user or hardware toggles openings and devices.

Façade naming follows the JSON plan: **N = z<0 side** (master, bedroom2, bedroom3 windows), **S = z>7.5** (living windows, service yard window, main door), **W = x<0** (master window 2, kitchen window), **E = x>12** (bedroom3 window 2, living window 3).

| # / key | id | Label | T_out °C | C_out µg/m³ | T_in0 °C | C_in0 | Sunny façades | Windward (ρ=1.003) | People | Default open |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 `Q` | `baseline` | Normal day | 30 | 20 | 30 | 15 | none | S (ρ 1.002) | no | none |
| 2 `W` | `hot_afternoon` | Hot afternoon (west sun) | 34 | 25 | 31 | 20 | **W** | S | yes | none |
| 3 `E` | `haze_outside` | Haze outside | 31 | **200** | 30 | 40 | none | S | yes | none |
| 4 `R` | `hot_haze` | Hot + hazy | 34 | 150 | 31 | 40 | W | S | yes | none |
| 5 `T` | `night_cool` | Evening cool-down | 27 | 20 | 31 | 15 | none | N (ρ 1.002) | yes | none |
| 6 `Y` | `validation` | Validation case (matches doc 06) | 33 | 100 | 28 | 0 | none | N (ρ 1.003) | 100 W heat block in bedroom3 | per the 4 validation sub-cases |

- The haze value 200 is anchored to the real NEA reading of **203 µg/m³ 1-h PM2.5 (west), 14 Oct 2026 9 PM** [V, from heat-haze-plan.md]. The UI labels it "scenario value inspired by NEA 14 Oct 2026", not live data.
- Leeward and other façades: ρ = 1.000. TOP: 1.000.
- Changing scenario: rewrite the OUTSIDE cells, reset the fields to the initial values, warm up 300 steps (doc 02 §5.7), and keep the openings and devices as they are unless the scenario has "Default open".
- The UI shows the scenario's one-line story, e.g. "Haze outside: PM2.5 200 outside. Should Mdm Tan open the window?"

## 2. Demo storyline using the presets
1. `haze_outside`, all closed → indoor C stays low but T creeps up (people).
2. Open WIN1 (bedroom3) and DOOR1 (main door) on the model → cross-flow; haze floods in along the corridor (particles turn brown).
3. Close the windows, turn the purifier on at a bad slot → small effect. Press **Optimise** → it moves the purifier and fan and shows "−xx% haze in occupied rooms".
4. Switch to `hot_afternoon` → the west rooms heat. Optimise with AC allowed vs fan-only → shows the energy trade-off (SDG 13).

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

## 4. Optimiser (`src/optimiser/`, runs in a dedicated Web Worker) [D]
### Problem
Given the scenario and the user's current openings, choose a layout from a **budget** preset (UI dropdown):
- `fan` = 1 portable fan
- `fan+purifier` (default)
- `fan+purifier+ac`
- Option checkbox **"also suggest windows/doors"** (default ON): mapped openings only (doc 04 §3), so the result can be actuated on the model.

Minimise the score `J` from doc 02 §6 (occupied-zone heat excess + haze + energy). Lower is better.

### Candidates
- Fan: 5 slots × yaw offsets {−90, −45, 0, +45, +90} × speed 2 = **25**
- Purifier: **6** slots
- AC: **4** units, `setC = 25 °C`
- Openings: each mapped opening toggled from the current state (**≤5**)

### Greedy search
```
layout = user's current openings, no devices
if suggestOpenings: for each mapped opening (in order): try toggle; keep if J improves by >2%
for device in budget order [ac?, purifier, fan]:     # big effects first
    best = argmin over candidates(device) of evaluate(layout + candidate)
    layout += best
return top 3: final layout, plus the final layout with 2nd/3rd best choice for the last device
also: J_you = evaluate(user's current layout)       # for "you vs optimiser"
```
About 40 evaluations in total.

### evaluate(layout)
- A fresh sim from the scenario's initial state with the layout applied: run **1,200 steps** (12 s sim time at dt = 0.01 s) and average J over the last 300 steps (sample every 50 steps).
- **Engine:** the same TS sim engine. It prefers **WebGPU inside the worker** at the `default` grid (Chrome supports `navigator.gpu` in dedicated workers [U, verify with a 5-line test first]). Otherwise it uses the **CPU reference at the `coarse` grid** (dx = 0.4, dt = 0.02 s, 600 steps). The UI shows which engine it used.
- Deterministic: no randomness in the physics, so the same input always gives the same J.
- Budget: the whole optimiser run should take **≤ 30 s** [U, not benchmarked]. If the first evaluation takes > 1 s, automatically halve the steps and show "fast mode".
- While it runs, reduce the main sim's `stepsPerFrame` to 4 so the live view stays smooth.

### Worker message API
```ts
// main → worker
{ type: "run", gridPreset, scenario, openings, mappedOpenings, budget, suggestOpenings, params }
{ type: "cancel" }
// worker → main
{ type: "progress", done: number, total: number, bestJ: number }
{ type: "result", engine: "webgpu"|"cpu-coarse",
  you: { J, breakdown: { heat, haze, energy } },
  layouts: Array<{ openings, fan?, purifier?, ac?, J, breakdown, improvementPct }> }   // 3 entries, best first
{ type: "error", message: string }
```

### Result UI
- Ghost markers (semi-transparent) in 3D for the suggested positions, with an arrow for the fan direction.
- Card: "Your layout J = 0.82 · Suggested J = 0.55 → **33% better** (simulated)", with heat/haze/energy bars.
- **Apply** (`Enter`) sets AppState to the best layout. This sends commands to the model (`WIN1:1`, `FANPOS:2`, `FANANG:45`, `FAN:ON`), so the servos move. That is the demo's "the sim talks back" moment.
