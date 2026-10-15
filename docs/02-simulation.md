# 02 · Simulation spec (the core)

## MVP amendment · authoritative running solver

**The shipped solver is `src/plan-simulation.ts`, the deliberate 2D fallback from original §7. It is not the 3D LBM/WebGPU engine described below.** The browser renders a 3D scene around a horizontal simulation slice. [CHECKLIST](../CHECKLIST.md) records actual checks; [doc 05](05-scenarios-optimiser.md) defines the six scenarios and comparison workflow.

### Geometry and fields

- Canonical input: `assets/hdb-3d/hdb_4room_boxes.json`, through `src/domain.ts`. Visual clipping, opacity, cutaway and physical-model scale never change the solver geometry.
- **64 × 48 cells, dx = 0.20 m, origin (x,z) = (−0.3,−0.3), slice y = 1.2 m.** `PlanField` carries temperature, PM2.5, planar velocity and cell type; the pressure overlay is a normalized qualitative index, **−1 to +1, not Pa**.
- Rooms become fluid; walls/furniture and intersecting fixed devices become solid. Openings traverse the full host-wall thickness. At this slice, all closed gives **1948 fluid / 429 solid cells** with no accidental fluid-to-outside face contact, verified by tests.
- The master-bath window starts above this slice: its visual sash can move, but it does **not** open a 2D path. Ceiling fans and AC outlets are projected into the plan; no vertical plume or downwash is solved.

### Flow, transport and device assumptions

A graph pressure solve projects local fan/AC drives onto conservative face flows through the fluid mask. Outdoor reservoir differences depend on the selected scenario's windward side and the wind-speed setting. This is a steady pressure-flow approximation, not Navier–Stokes/LBM, measured pressure or turbulence modelling. Flow is recomputed after relevant control changes. Pressure is normalized separately for each arrangement: compare colors within the current layout, not as absolute pressure differences between layouts.

Temperature and PM2.5 use conservative upwind face transport and diffusion. The illustrative coefficients in the implementation are **0.025 m²/s for temperature** and **0.012 m²/s for haze**. Walls block transport. Exterior reservoirs retain the scenario/user outdoor values. New opening cells use adjacent valid fields; finite-value guards and bounds keep temperature in **10–60 °C** and PM2.5 in **0–1000 µg/m³**.

| Source | Implemented assumption |
|---|---|
| Portable fan | Five slots, hardware angle 0–180° about each slot's base yaw, three nonzero speed levels; drives local flow, never directly reduces temperature. |
| Ceiling fan | Optional planar circulation approximation. |
| AC | Local 0.65 m outlet neighborhood, relaxation toward the selected setpoint at coefficient 0.8/s; projected planar jet. UI allows one active AC. |
| Purifier | Six slots; local 0.65 m neighborhood, PM2.5 removal coefficient 0.2/s. No humidity treatment. |
| West sun | West-adjacent cells receive an illustrative source up to 0.04 K/s, weighted by `max(0, sin((hour−6)π/12))` in sunny scenarios. |
| People | Small localized heat sources in scenarios marked occupied. |
| Validation | 100 W illustrative heat block in bedroom 3, distributed over the local slice cells using the flat's height. |

These are **MVP fallback coefficients**, replacing the original lattice-unit constants for this implementation. Device powers are **fan 50 W, purifier 40 W, active AC 1000 W**; the power estimate is not thermostat cycling or an electricity-bill prediction. Energy integrates watts × actual simulated seconds / 3,600,000. Room means use fluid cells, with floor-area weighting for whole-home summaries.

Humidity is a shared scenario setting used only in an illustrative comfort adjustment; it is not a transported field. Comfort is `T + max(T−24,0)·max(RH−40,0)/100 − min(3,2.5·speed)`, not a medical heat index or validated comfort standard. The UI follows scenario time/sun exposure. Pressure colors and flow arrows are qualitative visual aids, not pressure measurements.

### Time, stability and evidence

Each call advances at most **60 simulated seconds**, with substeps no larger than **0.25 s** and a tighter outgoing-flow/diffusion stability bound when needed. Longer offline runs must use multiple calls. The live UI's maximum 0.25 real-second frame delta at 60× requests at most 15 simulated seconds per call. It pauses advancement in hidden tabs.

Tests cover sealed geometry, stationary baseline, pollutant conservation, correct opening updates, cross-ventilation, fans, purifiers, AC, nonfinite recovery and scenario behavior. A solver-only V8 stress probe remained finite for 300 simulated seconds; this is not the five-minute full-browser acceptance test. See [the checklist](../CHECKLIST.md) for the latest build and browser status.

The well-mixed functions in `src/simulation.ts` are retained as an emergency/reference implementation and are tested separately. They are not the engine used by the app or optimiser. No CPU/GPU LBM equivalence, 3D buoyancy result, calibration, measured pressure or SimScale/OpenFOAM validation is claimed.

### Honesty text for this build

> HeatSim is a qualitative toy CFD demonstration in 2D plan-view mode. It uses a coarse 20 cm floor-plan grid and scenario conditions to illustrate how airflow, heat and haze may change. It has no vertical buoyancy or turbulence. Temperatures, comfort, pressure colors and energy are illustrative, not calibrated predictions. No sensors or live data are used, and no professional-CFD validation has been completed.

Written by gpt-6-astra in Codex on behalf of Edmund

<details>
<summary>Original roadmap / reference specification — not a statement of shipped functionality</summary>

**What it is:** a coarse, single-relaxation-time (BGK) **3D lattice Boltzmann method, D3Q19**, for weakly compressible (effectively incompressible, low-Mach) airflow. On top of it: **Boussinesq buoyancy** driven by a temperature field `T`, and a **passive PM2.5 scalar** `C`. Both scalars are advected by the LBM velocity. It runs on **WebGPU compute (WGSL)** in Chrome on an M4 Pro MacBook.

**What it is not:** a validated CFD solver. It is a **qualitative toy CFD**. The UI, the README and the pitch must say so (see "Honesty" at the end).

---
## 1. Grid and voxelisation (from `assets/hdb-3d/hdb_4room_boxes.json` ONLY)

### 1.1 Coordinates [V from the JSON]
- Units are metres, **+Y up**, x = east (0..12), z = south (0..7.5), floor top at y = 0, ceiling underside at y = 2.6.
- Bounds are `min [-0.1,-0.05,-0.1]`, `max [12.1,2.65,7.6]`. Exterior walls are 0.2 m thick (centred on x=0, x=12, z=0, z=7.5). Internal walls are 0.1 m.
- `boxes[]` hold `{name,type,min,max,...}` with `type ∈ wall|floor|ceiling|door|window|furniture|device|room`. Openable doors and windows carry `openable, wall, wall_axis, exterior, opening_min_max_along_wall, boundary_when_open (opening_to_outside|internal_opening)`.

### 1.2 Grid parameters [D]
Cells **must be cubes** in LBM. The plan said "~64×32×48", but with cubic cells the flat is only 2.7 m tall, so the vertical count is set by `dx`:

| Preset | dx | nx × ny × nz | cells | origin (m) | Use |
|---|---|---|---|---|---|
| **default** | **0.20 m** | **64 × 16 × 48** | 49,152 | (-0.3, -0.2, -0.3) | Live demo |
| high | 0.10 m | 128 × 32 × 96 | 393,216 | (-0.2, -0.1, -0.2) | Try only if the default runs at >60 fps with headroom |
| coarse | 0.40 m | 32 × 8 × 24 | 6,144 | (-0.5, -0.4, -0.5) | Optimiser scoring and CPU tests (openings get very blocky) |

With the default origin, y = 0 and x = -0.1/0.1/11.9/12.1 fall exactly on cell faces. The floor is row j=0, air is rows j=1..13 (13 cells = 2.6 m), the ceiling is j=14, and j=15 is pad. Spare cells (e.g. z beyond the south wall) are OUTSIDE reservoir cells. That is harmless and keeps the workgroups aligned.
Index layout: `cell = x + nx*(y + ny*z)`, `N = nx*ny*nz`.

### 1.3 Box → cell rule [D]
For each axis: `lo = floor((min - o)/dx + 0.5 + 1e-6)`, `hi = floor((max - o)/dx + 0.5 + 1e-6)`. If `hi <= lo`, use the single cell containing the box centre. This guarantees that 0.1 m internal walls and the 0.05 m floor/ceiling slabs become **at least one cell**, and that 0.6–0.9 m openings become 3–4 cells at dx = 0.2 (checked by hand for `door_bedroom3` = 4 cells and `window_master_bath` = 3×3 cells).

### 1.4 Cell types (`cellType: Uint32Array`, low 8 bits = type, high bits = tags)
| Value | Type | Meaning |
|---|---|---|
| 0 | `FLUID` | indoor air, collides and streams |
| 1 | `SOLID` | no-slip wall (halfway bounce-back), adiabatic for T, zero-flux for C |
| 2 | `OUTSIDE` | reservoir: fixed equilibrium at the façade's (ρ_out, u=0), T_out, C_out. It never collides. |

Tags (bits 8–15): `facade` for OUTSIDE cells (N=1,S=2,E=3,W=4,TOP=5) and `extWall` facade for SOLID cells that came from `wall_ext_*`. Bits 16–23 hold `glazing` (opening id+1) for SOLID cells of closed exterior windows. A separate `roomOf: Uint8Array` stores the index into `rooms[]` (255 = none).

### 1.5 Rasterisation order [D]
1. Fill everything with `OUTSIDE` and tag the façade by position: x<0 → W, x>12 → E, z<0 → N, z>7.5 → S, y>2.65 → TOP. At corners, pick the axis with the larger overshoot.
2. `room` boxes → `FLUID` (and fill `roomOf`).
3. `wall`, `floor`, `ceiling`, `furniture` → `SOLID`. `device` boxes → `SOLID` **except** `fan_*` (ceiling fans, treated as thin, so `FLUID`) and `purifier_*` (movable, placed dynamically).
4. Openings (`door`/`window` boxes): build the opening cell set = the opening's along-wall and vertical extent × **all cells of the host wall's thickness** (use the `wall` field to find the host wall cells along `wall_axis`'s normal). **Closed → SOLID, open → FLUID.** Store `openings: Map<name, Uint32Array>` so toggling just rewrites those cells.
5. Validate: with all openings closed, the default grid must give ≈23,700 FLUID cells (a Python prototype of exactly these rules gave 23,713 [V]) and zero FLUID↔OUTSIDE face contacts (no leaks). Fail loudly in dev.

Toggling an opening at runtime: rewrite those cells' type in the CPU mirror and upload the `cellType` buffer (≈200 KB, cheap). For a cell that turns SOLID→FLUID, initialise `f = feq(ρ=1, u=0)`, `T` = mean of its fluid neighbours (or T_out if none), and `C` likewise. Write both ping-pong buffers.

---
## 2. Lattice Boltzmann core

### 2.1 D3Q19 velocity set (cs² = 1/3)
Order fixed as below (all code, CPU and GPU, must use this order; `opp[i]` is the reverse direction):
```
i : c_i            w_i
0 : ( 0, 0, 0)     1/3
1 : ( 1, 0, 0)     1/18   2 : (-1, 0, 0)   3 : ( 0, 1, 0)   4 : ( 0,-1, 0)   5 : ( 0, 0, 1)   6 : ( 0, 0,-1)
7 : ( 1, 1, 0)     1/36   8 : (-1,-1, 0)   9 : ( 1,-1, 0)  10 : (-1, 1, 0)
11: ( 1, 0, 1)     1/36  12 : (-1, 0,-1)  13 : ( 1, 0,-1)  14 : (-1, 0, 1)
15: ( 0, 1, 1)     1/36  16 : ( 0,-1,-1)  17 : ( 0, 1,-1)  18 : ( 0,-1, 1)
opp = [0,2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15,18,17]
```

### 2.2 Equilibrium
`feq_i(ρ,u) = w_i ρ [1 + 3(c_i·u) + 4.5(c_i·u)² − 1.5|u|²]`

### 2.3 One step per FLUID cell (fused pull-stream → collide, ping-pong `fA → fB`)
1. **Pull stream:** for each i, `src = x − c_i`.
   - If `src` is FLUID or OUTSIDE: `f_i = fA[i][src]`. OUTSIDE cells permanently hold `feq(ρ_out(facade), 0)` in **both** buffers. Rewrite them when the scenario changes.
   - If `src` is SOLID: halfway bounce-back, `f_i = fA[opp[i]][x]`.
   - If `src` is outside the array (should not happen; the pad is OUTSIDE): treat it as SOLID.
2. **Total force** `F = F_src(x) + F_buoy`, with `F_buoy = (0, ρ·α·(T(x) − T_ref), 0)` (Boussinesq; positive is up because +Y is up and warmer air rises).
3. **Macroscopics (Guo):** `ρ = Σ f_i`, `u = (Σ f_i c_i + F/2) / ρ`. **Clamp `|u| ≤ uMax` (0.12)** by rescaling, and count clamps for the HUD.
4. **Collide (BGK + Guo forcing):**
   `f_i* = f_i − (f_i − feq_i(ρ,u))/τ + (1 − 1/(2τ)) w_i [3(c_i − u) + 9(c_i·u) c_i] · F`
5. Write `fB[i][x] = f_i*`. Write `macro[x] = (ux, uy, uz, ρ)`.
SOLID cells are skipped. OUTSIDE cells are skipped (they are constant).

### 2.4 Scalars T and C (second kernel, after the LBM step, using the new `u`)
Explicit first-order **upwind advection + 6-neighbour diffusion + sources**, ping-pong `TA→TB`, `CA→CB`:
```
φ' = φ − Σ_{d∈x,y,z} [ max(u_d,0)(φ − φ_{−d}) + min(u_d,0)(φ_{+d} − φ) ]
       + κ Σ_{6 nbrs n} (φ_n − φ)  + S_φ(x)
```
Neighbour values: SOLID → use `φ` itself (zero flux / adiabatic), OUTSIDE → `T_out` / `C_out` (Dirichlet). The exception is sun-heated walls, which are handled as a source term (§3). **Stability:** `Σ_d |u_d| + 6κ ≤ 1`. With uMax = 0.12 and κ ≤ 0.1 this holds. Defaults: `κ_T = 0.02`, `κ_C = 0.01`. After the update, clamp `T ∈ [10, 60] °C` and `C ∈ [0, 1000] µg/m³`.
(Alternative if time allows: a D3Q7 LBM for each scalar. Do not switch mid-day.)

### 2.5 Buffers (WGSL storage, SoA)
| Buffer | Type / size | Notes |
|---|---|---|
| `fA`, `fB` | `array<f32>`, 19·N | index `i*N + cell` |
| `cellType` | `array<u32>`, N | §1.4 |
| `src` | `array<vec4<f32>>`, 2·N | `[0] = (Fx, Fy, Fz, qT)`, `[1] = (Tset, kRelaxT, kSinkC, qC)`. Built on the CPU from AppState (§3); upload only on change. |
| `TA`,`TB`,`CA`,`CB` | `array<f32>`, N each | °C and µg/m³, physical units stored directly |
| `macro` | `array<vec4<f32>>`, N | (ux,uy,uz,ρ) |
| `params` | uniform struct | nx,ny,nz,N, τ, α, T_ref, κ_T, κ_C, uMax, T_out, C_out, ρ_out[6] (by facade id) |
| `snapshot` + staging | 5·N f32 | packed `ux,uy,uz,T,C` for readback (`MAP_READ` staging, ≥2 staging buffers in rotation) |

Kernels: `lbmStep` and `scalarStep`, both `@workgroup_size(64)` in 1D over N with an early return for `idx ≥ N`. Optional `packSnapshot`, or plain `copyBufferToBuffer`. The default limit of 8 storage buffers per stage is enough. Avoid `shader-f16` (not needed).

### 2.6 CPU reference (`sim/lbm3d-cpu.ts`)
The identical algorithm in TypeScript on Float32Arrays. It is used for unit tests (tiny grids), as the optimiser engine at `coarse` if WebGPU-in-worker fails, and as the oracle when the GPU looks wrong: run 50 steps on both from the same state and require max |Δf| < 1e-4.

---
## 3. Boundary conditions and sources per object [D]
All magnitudes are in **lattice units** unless stated, are tunable in `config/params.ts`, and are **illustrative** values chosen to look right, not measured.

| Object (JSON name pattern) | Closed / off | Open / on |
|---|---|---|
| Exterior window `window_*` (`opening_to_outside`) | SOLID (bounce-back). Fluid cells touching its cells get `qT += q_glass` if its façade is sunny. | FLUID. It connects to OUTSIDE reservoir cells with ρ_out(facade), T_out, C_out, so air, heat and haze exchange naturally. |
| `main_door` (exterior, south, to the common corridor) | SOLID | FLUID → OUTSIDE S reservoir |
| Internal doors `door_*` (`internal_opening`) | SOLID | FLUID between rooms |
| Walls, floor, ceiling, furniture, fixed devices | SOLID, no-slip, adiabatic | n/a |
| Sun-heated exterior wall (`wall_ext_<facade>`, facade ∈ scenario.sunFacades) | Fluid cells face-adjacent to these SOLID cells get `qT += q_sun` per step | n/a |
| **Portable fan** (hardware-controlled; slot + yaw) | Nothing (fluid) | A disc of FLUID cells: radius 2 cells, centred 1.0 m above the floor at the slot, 1 cell thick, normal `d = (sin yaw, 0, cos yaw)`. Each disc cell gets `F = F_fan·speedFactor·d`. **No temperature change** (fans move air; they don't cool it). |
| Ceiling fans `fan_living` etc. (stretch) | FLUID, no force | Cells in the box: `F = (0, −F_cfan, 0)` |
| **AC** (one of `ac_living/master/bedroom2/bedroom3`) | SOLID box | Outlet zone = the 2×2×2 fluid cells in front of the unit's room-facing face, at its height: `Tset = ac.setC`, `kRelaxT = k_ac` (each step `T += k_ac(Tset − T)`), and `F = F_ac` along the outward normal tilted 30° down. The heat rejected outside is counted only in the energy metric (no outdoor feedback). |
| **Purifier** (movable slot) | Nothing (fluid) | Intake sphere of radius 3 cells around the slot centre at 0.3 m height: `kSinkC = k_pur` (each step `C *= (1 − k_pur)`). Outlet: 1 cell at 0.6 m, `F = (0, F_pur, 0)`. |
| People (scenario option) | n/a | `qT += q_person` in 1×4×1 cell columns at preset spots (sofa, beds) |
| Indoor haze source (stretch: cooking) | n/a | `qC` in the kitchen |

Default constants (start here, then tune; see §5):
```
tau = 0.60   uMax = 0.12   alpha = 1.6e-5 (per K; buoyancyBoost ×2 default → 3.2e-5)
F_fan = 4e-4  F_ac = 2e-4   F_pur = 1e-4  F_cfan = 2e-4
k_ac = 0.15   k_pur = 0.02
q_sun = 0.004 K/step  q_glass = 0.006 K/step  q_person = 0.002 K/step
rho_out windward = 1.003, leeward = 1.000 (sets cross-ventilation), TOP = 1.000
```

**Source buffer build (CPU):** `buildSources(grid, state, scenario) → Float32Array(8N)`. It must be a pure function with tests, and it runs again whenever `AppState` changes (debounced to ≤20 Hz while a fan angle is sweeping).

---
## 4. Units and scaling (honest numbers) [D]
Choose `dx = 0.2 m` and a velocity scale `u_lat = 0.05 ↔ 1.0 m/s`, which gives **`dt = u_lat·dx/u_phys = 0.01 s` per step**.
| Quantity | Lattice | Physical |
|---|---|---|
| Velocity | 0.05 | 1.0 m/s (uMax 0.12 ↔ 2.4 m/s) |
| Viscosity at τ = 0.6 | ν = (τ−0.5)/3 = 0.0333 | ν·dx²/dt = **0.13 m²/s, about 9,000× real air (1.5e-5)**. The sim behaves like a "very thick" eddy-viscosity air: smooth, laminar-looking flows. |
| Pressure | Δp_lat = Δρ/3 = 0.001 | Δp = ρ_air·Δp_lat·(dx/dt)² ≈ 1.2·0.001·400 ≈ **0.5 Pa** (light wind on a façade, plausible order of magnitude [U]) |
| Buoyancy | α = gβ·dt²/dx = 0.0324·1e-4/0.2 ≈ **1.6e-5 /K** | gβ = 9.81/303 K |
| Time | 1 step | 0.01 s. At 8 steps/frame × 60 fps, the sim runs **≈4.8× real time**. Show "sim time" and the speed-up factor in the HUD. |
| T, C | stored directly in °C and µg/m³ | n/a |

Reynolds number at room scale in the sim is about 20, against about 10⁵ in reality, so turbulence is absent by construction. This is the main reason to call it "toy CFD".

---
## 5. Stability and tuning tips
1. Keep **τ ≥ 0.55** (default 0.6). Below that, BGK on a coarse grid blows up. Smagorinsky LES (`τ_eff = τ + ...`) is a stretch item, not for today.
2. Keep **|u| < 0.1** in normal running. The `uMax` clamp is a safety net; if the HUD clamp counter rises, lower the forces or Δρ instead.
3. **Ramp** forces and Δρ over about 200 steps when a device switches on or a window opens (multiply by `min(1, stepsSinceChange/200)`), so the field doesn't get shocked.
4. The fan disc must be at least 1 cell away from SOLID cells. When building sources, snap slot positions to the nearest valid FLUID region.
5. Reservoir ρ differences should stay ≤ 0.005.
6. **NaN watchdog:** on every snapshot, check a strided sample (every 97th cell) with `Number.isFinite`. On failure, reload the last good f-state (keep a GPU copy every 5 s), halve the forces, and show a toast "Sim reset (unstable)". Never let the demo freeze on NaNs.
7. Start every scenario from `feq(1, 0)`, T = T_in0 and C = C_in0, then warm up 300 steps before revealing (hidden behind a 1 s "settling…" overlay).
8. Expect **odd-even checkerboarding** at openings 1–2 cells wide. That is acceptable at this resolution. Smooth it for display with LinearFilter.
9. When the GPU result disagrees with the CPU reference, suspect `opp[]`, the SoA index math, or the ping-pong swap first.

---
## 6. Metrics (computed on the CPU from each snapshot)
- Per room: mean T, mean C, mean |u| (m/s) over FLUID cells with 0.2 m ≤ y ≤ 1.8 m (the "occupied zone").
- **Score** (also used by the optimiser, doc 05): `J = mean_occ(T_eff − T_comfort)_+ + w_C·mean_occ(C)/35 + w_E·energy`, where `T_eff = T − coolingFromAirSpeed(|u|)` and `coolingFromAirSpeed(v) = min(3, 2.5·v_phys)` °C. **That cooling curve is an illustrative assumption [U]** (it is loosely inspired by elevated-air-speed comfort models; do not cite it as a standard). `T_comfort = 28 °C`, `w_C = 1`, `w_E` uses device power (fan 50 W, purifier 40 W, AC 1000 W) [U, illustrative].
- The HUD puts a small "SIMULATED" tag next to every number.

## 7. Fallback: 2D JS grid sim (if WebGPU isn't working by 13:30)
- A 2D floor-plan raster of the same JSON at y = 1.2 m (dx = 0.2 → 64×48, `ny = 1`). Same cell types, openings, sources and AppState.
- Solver: Jos Stam style stable fluids (semi-Lagrangian advect, Jacobi pressure projection, 20 iterations) or the simpler "fixed flow field" from `/workspace/hackathon/heat-haze-plan.md` §2, plus T/C advection-diffusion. CPU on Float32Arrays at 60 fps.
- It outputs the same `FieldSnapshot` with `ny = 1`, so the renderer shows one slice plane and particles in 2D. The optimiser and protocol are unchanged.
- No buoyancy in 2D (it's a plan view). Label it "2D plan-view mode".

## 8. Honesty (must appear in the UI's "About" box and the pitch)
> "HeatSim is a qualitative toy CFD: a coarse 20 cm lattice-Boltzmann model with artificially high viscosity and scenario-preset outdoor conditions. It shows how air, heat and haze tend to move, not exact temperatures or concentrations. No sensors are used. Reference CFD would require future SimScale/OpenFOAM runs; none were completed for this MVP."

## References (to read, not copy blindly)
- MIT GPU-LatticeBoltzmann 3D demo: https://amiraa.pages.cba.mit.edu/GPU-LatticeBoltzmann/_Code/indexDynamic.html [V link opened, per cfd-3d-options.md; licence not checked]
- WebLBM (2D WebGPU LBM, needs shader-f16): https://github.com/LennartPaduch/WebLBM [V link; licence not checked, so do not copy code without checking]
- Guo, Zheng & Shi (2002), forcing scheme for LBM [U: standard reference, not re-checked today]
- Krüger et al., *The Lattice Boltzmann Method: Principles and Practice* (2017) [U]

</details>
