# 06 · Validation runs (SimScale primary, OpenFOAM fallback)

**Purpose:** realistic reference images for the slides that sanity-check the *qualitative* behaviour of the live toy sim (where air enters, where it stagnates, which configuration ventilates best). They are **not** used inside the app (stretch: show them in a "Reference CFD" tab).

## 1. The four cases [D]
Same geometry and settings in every case. Only the two openings change. **All internal doors are open in every case.**
| Case | `window_bedroom3_1` (north, 1.4 × 1.2 m) | `main_door` (south, 0.9 × 2.1 m) | Expected (hypothesis) |
|---|---|---|---|
| A · all closed | closed | closed | Buoyant plume above the heat source only; near-stagnant room; heat builds up |
| B · window only | open | closed | Single-sided exchange at the window; weak, shallow penetration |
| C · door only | closed | open | Single-sided exchange at the door; weak |
| D · both open | open | open | Cross-ventilation N→S through bedroom3 → corridor → living/dining; strongest flushing |

Common settings (mirror the `validation` scenario in doc 05):
- Air, incompressible with Boussinesq buoyancy, gravity −Y.
- Outdoor air 33 °C. Indoor initial 28 °C.
- Heat source: **100 W** solid/volumetric block, 0.4 × 1.0 × 0.4 m, standing in bedroom3 at about (10.0, 0–1.0, 1.6) m ("one person").
- Window (when open): **pressure inlet, 0.5 Pa gauge** total pressure, T = 33 °C, passive scalar = 1 (haze tracer).
- Main door (when open): **pressure outlet, 0 Pa**, zero-gradient T/scalar (backflow at 33 °C / scalar 1).
- Walls, floor, ceiling and furniture: no-slip, adiabatic. Simplify: drop furniture except beds and wardrobes if meshing struggles.
- Turbulence: k-ω SST. Transient, 120 s of physical time (or steady if transient is too slow; note which in the slides).
- The 0.5 Pa driving pressure equals the live sim's `ρ_out = 1.003` windward setting (doc 02 §4), so the two are comparable in kind.

Outputs per case (same views every time):
1. Horizontal slice at **y = 1.2 m**: velocity magnitude (0–1.0 m/s) and temperature (26–36 °C), fixed colour ranges.
2. Vertical slice through bedroom3 at x = 10.4 m: temperature + vectors.
3. Streamlines seeded at the window.
4. Numbers: volume flow through the window (m³/s), and mean T and mean speed in bedroom3 at 0.2–1.8 m.
Then screenshot the live sim under the **same** case and views, and put them side by side ("Reference CFD | HeatSim live").

**Agreement criterion (honest):** the *ranking* of the cases by bedroom3 mean speed and air-exchange (D > B ≈ C > A expected) and the main flow path should match. Absolute numbers will not match, and we say so.

## 2. Geometry export (shared by SimScale and OpenFOAM)
Build `validation/export_geometry.ts` (run with Bun or Node). It reads `assets/hdb-3d/hdb_4room_boxes.json` and writes:
- `validation/out/flat_fluid.stl`: the **air volume** (union of `room` boxes minus solids) as a closed surface, metres. For SimScale this is the flow region directly.
- Separate named ASCII STL solids for the patches: `window_bedroom3_1`, `main_door`, `walls`, `heat_source`. Some tools import multi-solid ASCII STL as separate faces [U for SimScale; if it merges them, select the faces manually in SimScale's face picker or export STEP from Onshape/FreeCAD instead].
- `validation/out/boxes_for_openfoam.txt`: `boxToCell` lines for `topoSet` (see §4).
Optional simplification if meshing is slow: crop the domain to x ∈ [2.8, 12], z ∈ [0, 7.5] (bedroom3 + bedroom2 + corridor + living/dining) and close the cut plane as a wall.

## 3. SimScale (primary)
| Fact | Tag |
|---|---|
| Free **Community** plan: **public projects only**, **10 simulations per year**, core-hour allowance stated as "up to 2000" on the pricing page (a forum reply and an older page say 3000) | [V] simscale.com/product/pricing, per cfd-3d-options.md |
| Analysis type for buoyant room airflow: "Convective Heat Transfer" with incompressible + Boussinesq option | [U] check names in the UI |
| Passive scalar / "passive species" for the haze tracer | [U] |
| Runs are batch in the cloud (queue + run time), so **start them first** | [V] |

Steps:
1. Sign up (school email OK?). The project is **public**, so put nothing personal in it. Name: `HeatSim HDB 4-room ventilation (SST InnoScience 2026)`.
2. Upload `flat_fluid.stl` (or the cropped version). Check units = metres.
3. Create the simulation with the settings in §1. Mesh: standard/automatic, fineness about 5/10, with a refinement region around the window, the door and the heat source.
4. Run case D first (the most interesting), then B, C and A. **That's 4 of the 10 yearly runs. Do not burn runs on experiments.** Do a mesh-only check before each run.
5. Post-process with the outputs in §1 and save PNGs to `validation/simscale/<case>_<view>.png`. Record the project URL in `validation/README.md`.

## 4. OpenFOAM on the Mac (fallback, on-prem)
| Fact | Tag |
|---|---|
| OpenFOAM on macOS: officially via a **Multipass Ubuntu VM** (openfoam.org download page) | [V] openfoam.org/download/macos, per cfd-3d-options.md |
| Solver name depends on the distribution: **openfoam.org v9–v10: `buoyantFoam`**; **openfoam.org v11+: `foamRun -solver fluid`** (application solvers were replaced by solver modules); **openfoam.com (ESI, e.g. v2312+): `buoyantPimpleFoam`** | [V for v11+ `foamRun` modules and ESI not having foamRun, CFD-Online/openfoam.org release notes; U for exact flag spelling `-solver` vs `-module` in your installed version: run `foamRun -help`] |
| Start from a tutorial: the `hotRoom` case (exists under heatTransfer/buoyant* tutorials in most versions) | [U] path varies by version: `find $FOAM_TUTORIALS -name hotRoom` |

Steps:
1. `brew install --cask multipass` → `multipass launch 24.04 --name foam --cpus 6 --memory 8G --disk 30G` [U: check that the openfoam.org apt repo supports this Ubuntu release].
2. In the VM, install OpenFOAM from the openfoam.org Ubuntu instructions (apt repo `dl.openfoam.org`, package `openfoam<version>`) [U package name], then `source /opt/openfoam<ver>/etc/bashrc`.
3. `multipass mount ~/heatsim-foam foam:/home/ubuntu/case` so ParaView on macOS can open the results directly (install the native ParaView .dmg, open `case/<case>/case.foam`). No RDP needed.
4. Mesh, the voxel way (fastest and identical to the live sim's geometry): `blockMesh` a box over the flat bounds at 0.1 m (122 × 27 × 77) → `topoSet` with `boxToCell` sets from `boxes_for_openfoam.txt` (solids) → `subsetMesh -overwrite` keeps the fluid → `createPatch` names the window/door faces. Alternatively `snappyHexMesh` with the STLs from §2.
5. Copy `0/`, `constant/` and `system/` from `hotRoom`. Set gravity, the Boussinesq or perfect-gas thermophysics as in the tutorial, BCs per §1 (`totalPressure` / `prghTotalPressure` at the window, `prghPressure` / `fixedValue` 0 at the door [U: pick what the tutorial uses]), and a `fvModel`/`fvOption` `semiImplicitSource` for 100 W in the heat-source cellZone.
6. Run 4 cases (copy the case directory per case and only change the patch types). Use `foamPostProcess`/ParaView for the same slices as §1. Save PNGs to `validation/openfoam/`.
Time warning: expect **≥ 3 h** before a first good result [V estimate from cfd-3d-options.md]. Only start this if SimScale is blocked or failing by 12:00.

## 5. Slide text (draft)
> "Our live model is a fast, simplified 'toy CFD' so that it reacts instantly to the cardboard model. To check it, we ran a professional-grade CFD simulation (SimScale / OpenFOAM) of the same flat for 4 cases. The two agree on *which* option ventilates best and on the airflow path, but not on exact numbers, which is expected for a simplified model."
