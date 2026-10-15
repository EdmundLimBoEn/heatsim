# 06 · Planned reference validation (SimScale or OpenFOAM)

**Status: planned, not performed.** No SimScale/OpenFOAM runs, geometry exporter, reference images or external agreement results are included in this MVP. The live app uses a qualitative 2D plan-view solver; it does not implement 3D buoyancy or turbulence. This document preserves a future comparison plan, not evidence of validation.

**Purpose:** reference images for the slides that sanity-check the *qualitative* behaviour of the live toy sim (where air enters, where it stagnates, which configuration ventilates best). They are **not** used inside the app (stretch: show them in a "Reference CFD" tab).

## 1. The four cases [D]
Same geometry and settings in every case. Only the two openings change. **All internal doors are open in every case.**
| Case | `window_bedroom3_1` (north, 1.4 × 1.2 m) | `main_door` (south, 0.9 × 2.1 m) | Expected (hypothesis) |
|---|---|---|---|
| A · all closed | closed | closed | Buoyant plume above the heat source only; near-stagnant room; heat builds up |
| B · window only | open | closed | Single-sided exchange at the window; weak, shallow penetration |
| C · door only | closed | open | Single-sided exchange at the door; weak |
| D · both open | open | open | Cross-ventilation N→S through bedroom3 → corridor → living/dining; strongest flushing |

Proposed reference settings (share temperatures and heat-source strength with the `validation` scenario in doc 05; use a different 3D solver):
- Air, incompressible with Boussinesq buoyancy, gravity −Y.
- Outdoor air 33 °C. Indoor initial 28 °C.
- Heat source: **100 W** solid/volumetric block, 0.4 × 1.0 × 0.4 m, standing in bedroom3 at about (10.0, 0–1.0, 1.6) m ("one person").
- Window (when open): **pressure inlet, 0.5 Pa gauge** total pressure, T = 33 °C, passive scalar = 1 (haze tracer).
- Main door (when open): **pressure outlet, 0 Pa**, zero-gradient T/scalar (backflow at 33 °C / scalar 1).
- Walls, floor, ceiling and furniture: no-slip, adiabatic. Simplify: drop furniture except beds and wardrobes if meshing struggles.
- Turbulence: k-ω SST. Transient, 120 s of physical time (or steady if transient is too slow; note which in the slides).
- **0.5 Pa is a proposed boundary condition for the external reference only.** The current live solver does not use `ρ_out` or calibrated pressure in pascals. Its pressure view is a relative index normalized to −1…+1 for each configuration; it cannot establish absolute pressure or compare pressure magnitudes between configurations.

Outputs per case (same views every time):
1. Horizontal slice at **y = 1.2 m**: velocity magnitude (0–1.0 m/s) and temperature (26–36 °C), fixed colour ranges.
2. Vertical slice through bedroom3 at x = 10.4 m: temperature + vectors.
3. Streamlines seeded at the window.
4. Numbers: volume flow through the window (m³/s), and mean T and mean speed in bedroom3 at 0.2–1.8 m.
If these runs are completed, compare the live app under the same opening case using its horizontal plan view. Label any side-by-side images "Reference CFD | HeatSim live" and identify the different solvers. The MVP has no vertical slice or vertical velocity field, so reference-only vertical views cannot be presented as matched live results.

**Comparison hypothesis, not a result:** investigate whether case D has the strongest flushing and whether the main path passes through bedroom3 → corridor → living/dining. Single-opening exchange and buoyant plumes are not represented by the current steady 2D pressure-flow approximation, so B/C/A rankings may differ. Record disagreements as limits; do not claim matching air-exchange, pressure or temperature accuracy.

## 2. Geometry export (shared by SimScale and OpenFOAM)
**Not implemented.** A future `validation/export_geometry.ts` would run with Bun or Node, read `assets/hdb-3d/hdb_4room_boxes.json` and write:
- `validation/out/flat_fluid.stl`: the **air volume** (union of `room` boxes minus solids) as a closed surface, metres. For SimScale this is the flow region directly.
- Separate named ASCII STL solids for the patches: `window_bedroom3_1`, `main_door`, `walls`, `heat_source`. Some tools import multi-solid ASCII STL as separate faces [U for SimScale; if it merges them, select the faces manually in SimScale's face picker or export STEP from Onshape/FreeCAD instead].
- `validation/out/boxes_for_openfoam.txt`: `boxToCell` lines for `topoSet` (see §4).
Optional simplification if meshing is slow: crop the domain to x ∈ [2.8, 12], z ∈ [0, 7.5] (bedroom3 + bedroom2 + corridor + living/dining) and close the cut plane as a wall.

## 3. SimScale (planned reference option)
| Fact | Tag |
|---|---|
| Plan cost, run quota, core-hour allowance and project visibility | [U] verify current provider terms before using; not checked for this MVP |
| Analysis type for buoyant room airflow: "Convective Heat Transfer" with incompressible + Boussinesq option | [U] check names in the UI |
| Passive scalar / "passive species" for the haze tracer | [U] |
| Runs require an external reference workflow and are outside the localhost MVP | [D] |

Steps:
1. Verify the chosen plan and project visibility before uploading geometry. Keep personal data out of any public project. Suggested name: `HeatSim HDB 4-room ventilation (SST InnoScience 2026)`.
2. Upload `flat_fluid.stl` (or the cropped version). Check units = metres.
3. Create the simulation with the settings in §1. Mesh: standard/automatic, fineness about 5/10, with a refinement region around the window, the door and the heat source.
4. Do a mesh-only check, then run case D first, followed by B, C and A. Confirm that the chosen plan permits the four proposed runs before starting them.
5. Post-process with the outputs in §1 and save PNGs to `validation/simscale/<case>_<view>.png`. Record the project URL in `validation/README.md`.

## 4. OpenFOAM on the Mac (planned alternative, not installed or run here)
| Fact | Tag |
|---|---|
| OpenFOAM on macOS: officially via a **Multipass Ubuntu VM** (openfoam.org download page) | [V] openfoam.org/download/macos, per cfd-3d-options.md |
| Solver name depends on the distribution: **openfoam.org v9–v10: `buoyantFoam`**; **openfoam.org v11+: `foamRun -solver fluid`** (application solvers were replaced by solver modules); **openfoam.com (ESI, e.g. v2312+): `buoyantPimpleFoam`** | [V for v11+ `foamRun` modules and ESI not having foamRun, CFD-Online/openfoam.org release notes; U for exact flag spelling `-solver` vs `-module` in your installed version: run `foamRun -help`] |
| Start from a tutorial: the `hotRoom` case (exists under heatTransfer/buoyant* tutorials in most versions) | [U] path varies by version: `find $FOAM_TUTORIALS -name hotRoom` |

Steps:
1. `brew install --cask multipass` → `multipass launch 24.04 --name foam --cpus 6 --memory 8G --disk 30G` [U: check that the openfoam.org apt repo supports this Ubuntu release].
2. In the VM, install OpenFOAM from the openfoam.org Ubuntu instructions (apt repo `dl.openfoam.org`, package `openfoam<version>`) [U package name], then `source /opt/openfoam<ver>/etc/bashrc`.
3. `multipass mount ~/heatsim-foam foam:/home/ubuntu/case` so ParaView on macOS can open the results directly (install the native ParaView .dmg, open `case/<case>/case.foam`). No RDP needed.
4. Proposed voxel meshing (same source boxes, but a different resolution and a 3D domain from the live 2D grid): `blockMesh` a box over the flat bounds at 0.1 m (122 × 27 × 77) → `topoSet` with `boxToCell` sets from `boxes_for_openfoam.txt` (solids) → `subsetMesh -overwrite` keeps the fluid → `createPatch` names the window/door faces. Alternatively `snappyHexMesh` with the STLs from §2.
5. Copy `0/`, `constant/` and `system/` from `hotRoom`. Set gravity, the Boussinesq or perfect-gas thermophysics as in the tutorial, BCs per §1 (`totalPressure` / `prghTotalPressure` at the window, `prghPressure` / `fixedValue` 0 at the door [U: pick what the tutorial uses]), and a `fvModel`/`fvOption` `semiImplicitSource` for 100 W in the heat-source cellZone.
6. Run 4 cases (copy the case directory per case and only change the patch types). Use `foamPostProcess`/ParaView for the same slices as §1. Save PNGs to `validation/openfoam/`.
This is separate future work. Installation, compatible solver syntax, meshing and reference-run duration have not been checked for this MVP.

## 5. Slide text for the current MVP
> "HeatSim is a standalone, qualitative toy CFD with a 2D plan-view simulation and a 3D model for presentation. It illustrates how opening and device settings affect simulated airflow, heat and haze. The pressure colours show a relative index, not pascals. We have not yet validated these results against professional CFD or physical measurements. Optional cardboard controls can be connected when the board is available."

Only replace this wording with a validation claim after storing the actual cases, settings, outputs and comparison evidence.

Written by gpt-6-astra in Codex on behalf of Edmund
