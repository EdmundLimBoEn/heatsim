# 07 · Build plan: Thu 15 Oct 2026 (all times SGT)

## MVP amendment · handoff status

**The original schedule and 3D milestones below are historical planning, not a completion report.** The authoritative acceptance record is [CHECKLIST.md](../CHECKLIST.md). Run and rehearse from the [README](../README.md).

The presentation is deliberately **standalone first**: a refined 3D view, documented 2D plan solver, all six scenarios, keyboard/on-screen controls, device placement, background layout comparison and A4 construction files. The Cooling Lab extension separately adds a two-layer/surface thermal balance and matched fan/opening/purification/envelope experiments with shared manual weather; it does not complete the deferred 3D solver. **The SSTuino has not arrived.** Hardware integration is prepared but is not a prerequisite for demonstrating the software.

The new [Contractor Study](contractor-study.md) adds three validated plan inputs, independent model instances, shared manual weather/provenance, report export and room-level appliance placement. The original Flat adds portable fan/purifier slot dragging. Its current application gate passed **250 tests across 18 files** and **162 browser assertions**, plus strict TypeScript/build/scene checks; native Zen verified Flat dragging. The separate physical measurement-guide review passed: nine new paper reference pages explain absolute edges and adjacent gaps while retaining the existing cutting SVGs, cut data and two-A4-sheet material requirement. [CHECKLIST.md](../CHECKLIST.md) distinguishes actual checks from unverified external Windy tiles, physical hardware and rehearsal.

The prior outdoor-controls extension passed **173 tests across 13 files**, strict TypeScript/Vite build and scene checks. Browser regression passed **69 Cooling Lab assertions, 17 outdoor-control assertions and 13 mocked-serial assertions**. The earlier native Zen / Firefox 157 run executed the actual WebGPU kernel and CPU-parity checks; Chrome GPU startup timed out, so Chrome GPU execution is not claimed. Cardboard quantities and geometry remain unchanged; the opening-offset/gap annotation review passed, with all final evidence recorded in [CHECKLIST.md](../CHECKLIST.md), alongside the remaining spoken rehearsal, formal FPS record and physical hardware checks.

### Finish the presentation

1. Keep the verified local build and its recorded checks. Before presenting, open it on the presentation machine and confirm the engine badge, Cooling Lab entry and saved comparison export.
2. Rehearse the standalone README sequence on the presentation machine with no board connected. Record a backup video; keep the built app and local assets available.
3. Give the crew the [build pack](../public/build-pack/index.html). Verify actual-size printing and cardboard thickness before cutting. Assemble the 187.692 × 118.462 mm roofless shell before fitting unspecified components.
4. When the SSTuino arrives, identify its version, upload the correct sketch, and test the two default physical inputs individually. Only enable servos after checking their power and calibrating their travel.

### Explicitly deferred

- 3D D3Q19 LBM, 3D GPU/CPU equivalence and resolved vertical buoyancy. Optional WebGPU is limited to scalar transport on the existing 2D plan; its verification is separate. Cooling Lab uses an explicitly simplified two-layer balance instead.
- SimScale/OpenFOAM runs or reference-validation claims.
- Physical USB round-trip acceptance, board-specific compile/upload, limit-switch installation and servo actuation until the real hardware is available.
- Optional WebSocket bridge, vertical slices, high-resolution solver, advanced turbulence and physical device-position actuators.

The old acceptance tests remain below for traceability. Mark 3D-only items **N/A for this deliberate fallback**, not passed. Do not convert mocked tests or solver-only benchmarks into claims of physical operation or full-browser FPS.

Written by gpt-6-astra in Codex on behalf of Edmund

<details>
<summary>Original roadmap / reference specification — not a statement of shipped functionality</summary>

## Fixed points
| Time | Event | Tag |
|---|---|---|
| 08:40 | Assembly | [V] school programme sheet |
| 09:00–09:40 | Session 1 | [V] |
| 09:40–10:20 | Break | [V] |
| 10:20–14:00 | Session 2 @ Auditorium (3M / teacher consultations happen on Day 2; exact mentor slot unknown) | [V] times / [U] mentor slot |
| 14:00 | School dismissal (the build continues after) | [V] |
| **13:30** | **WebGPU go/no-go** (see fallbacks) | [D] |
| **16:00** | **Code + hardware freeze** | [D] |
| Fri 16 Oct | Pitch (about 10 min per group, 08:00–12:30 block) | [V] date / [U] slot |

## Roles (team S2-05 / 5A: Jaron, Edmund, Paul, Wayne; who takes which role is TBD)
| Role | Owner | Today |
|---|---|---|
| A · Leader + Marketer | TBD | Design Journal, pitch script, timekeeping, SimScale screenshots into slides |
| B · Designer | TBD | Cardboard model (bedroom3 + corridor + living, windows/doors as flaps, fan on a servo), UI labels and look |
| C · Maker | TBD | Wiring, servos, firmware upload, pin map in doc 04 |
| D · Coder | **Edmund** + coding agents (Astra) | The app (this repo), firmware sketch, bridge, SimScale setup |

## Timeline
| Time | Coder + agents (app) | Maker | Designer | Leader | SimScale |
|---|---|---|---|---|---|
| 09:15–10:30 | **M0** scaffold, geometry voxeliser + tests · **M1** GLB view, AppState, keyboard, panel, voxel-mask slice | Board package > v1.1.1, blink, `Servo` compile test, 1 button → `WIN1:1` | Cut base and walls, mark flap positions | Journal: issues, data, persona | **Export STL, set up case D, launch** |
| 10:30–12:00 | **M2** WebGPU LBM + scalars, CPU reference matches · protocol parser + Web Serial (parallel agent) | All buttons + 2 servos, separate 5 V supply, full protocol | Flaps + fan mount | HMW, ideate, evaluate | Launch B, C, A |
| 12:00–13:30 | **M3** sources, scenarios, particles, HUD metrics · **M5** serial wired into AppState | Integrate with the app on the Mac | Labels, polish | Mentor feedback into the journal | Post-process D |
| **13:30** | **GO/NO-GO**: WebGPU AT-3/AT-4 passing? If not → `fallback2d` | n/a | n/a | n/a | n/a |
| 13:30–14:45 | **M6** optimiser worker + "you vs optimiser" + Apply → servos | Cable tidy, strain relief | n/a | Test step: before/after numbers | Images for all 4 cases |
| 14:45–15:30 | **M7** polish: About/honesty text, legends, fonts, help overlay, NaN watchdog | Hardware freeze 15:30 | Record the backup video (screen + model) | Pitch script | Side-by-side slide |
| 15:30–16:00 | Bug fixes only; tag `v1.0-demo`; **freeze 16:00** | n/a | n/a | Rehearse ×2 | n/a |
| Evening | Stretch only on a branch; `main` stays the demo build | n/a | n/a | Final journal | n/a |

## MVP vs stretch
**MVP (must work at 16:00):**
1. 3D WebGPU LBM sim of the flat from the JSON, with T (buoyancy) and C, ≥30 fps (or the 2D fallback).
2. three.js view: GLB, transparent ceiling, one horizontal slice (T/C/speed), particles, legends.
3. All six scenario presets. Openings toggle live. Portable fan (slot, angle, on/off), one purifier, one AC.
4. Keyboard + on-screen controls for everything.
5. Web Serial link with protocol v1: buttons on the model change the sim, and the sim can move at least one servo.
6. Greedy optimiser in a worker with "you vs optimiser" and Apply.
7. Honesty text, "SIMULATED" labels, NaN watchdog.

**Stretch (in order):** vertical slice plane · ceiling fans · Bun bridge · `LED:` command · reference-CFD tab with SimScale images · `high` grid preset · particle trails · velocity glyphs · Smagorinsky · purifier-on-wheels (hardware).

## Acceptance tests (run them; tick them in `CHECKLIST.md`)
| # | Test | Pass criterion |
|---|---|---|
| AT-1 | `npm test` | voxeliser, protocol parser, source builder and CPU LBM tests pass |
| AT-2 | Voxeliser | default grid is 64×16×48; `door_bedroom3` = 4 cells wide × 11 tall; `window_master_bath` = 3×3; all openings closed: ≈23,700 FLUID cells (23,713 in a Python prototype of the rule) and no FLUID cell is face-adjacent to an OUTSIDE cell |
| AT-3 | Closed flat, `baseline`, no sources, 2,000 steps | max \|u\| < 1e-4 lattice; total mass drift < 1e-4 relative; no NaN |
| AT-4 | GPU vs CPU | 50 steps from the same state on the `coarse` grid: max \|Δf\| < 1e-4 |
| AT-5 | Buoyancy | warm block (+5 °C) in a closed room → upward velocity above it within 300 steps |
| AT-6 | Cross-ventilation | `validation` scenario, open `window_bedroom3_1` + `main_door` → flow enters at the window and leaves at the door; bedroom3 mean C rises toward C_out within 60 s of sim time |
| AT-7 | Purifier | `haze_outside`, all closed, C_in0 = 100, purifier on in bedroom3 → bedroom3 mean C falls faster than with it off |
| AT-8 | Performance | default grid ≥ 30 fps with particles on the M4 Pro in Chrome, 5-minute run with no NaN reset |
| AT-9 | Protocol | Serial Monitor / mock: every line in doc 04 parses; unknown lines don't crash; `GET:ALL` sync works on connect |
| AT-10 | Hardware loop | Press WIN1 on the model → sim window opens < 0.5 s later; press `1` on the keyboard → servo moves and is echoed |
| AT-11 | Disconnect | unplug USB mid-run → banner, the sim keeps running, reconnect works |
| AT-12 | Optimiser | `haze_outside` budget `fan+purifier` finishes ≤ 30 s, returns 3 layouts, improvement ≥ 0 vs the user layout, Apply moves the servos |
| AT-13 | Fallback | with `?backend=2d` (or WebGPU forced off) the whole app works in 2D mode |
| AT-14 | Honesty | About box text present; every metric has a "SIMULATED" tag; no PSI/PM sensor wording anywhere |

## Fallbacks
| Problem | Trigger | Fallback |
|---|---|---|
| WebGPU sim unstable or slow | AT-3/4/8 not passing at **13:30** | Switch the default to `fallback2d` (doc 02 §7). Keep the 3D view with one slice. |
| Web Serial misbehaving | AT-10 failing at 14:30 | Bun/Node bridge (doc 04 §6); else keyboard only: a teammate presses keys in sync with the model |
| Servos resetting the board | brown-outs | separate 5 V supply, detach after a move, add a capacitor; else drive one servo only |
| Board won't upload | n/a | spare Uno/Nano with the same sketch; else keyboard-only demo |
| SimScale queue too slow or out of runs | no results by 13:00 | OpenFOAM in Multipass (doc 06 §4); else present the expected behaviour with the live sim screenshots only, labelled clearly |
| Optimiser too slow | > 30 s | coarse CPU engine, fewer steps, fewer candidates (fan yaw offsets {−45, 0, 45}) |
| Anything breaks on stage | n/a | backup screen recording (made by 15:30) |

</details>
