# MVP verification and handoff

**Status recorded 15 October 2026, final software checkpoint at 10:09 SGT. The presentation runs standalone. The SSTuino has not arrived.** Checked software does not imply checked physical hardware. The amended [simulation specification](docs/02-simulation.md) takes precedence over the original 3D roadmap.

## Automated checks with recorded evidence

- [x] `bun run test`: **79 tests across 5 files passed**, including the final pressure-view additions. Covers protocol parsing, mocked USB lifecycle, room fallback, 2D geometry/transport and optimiser logic.
- [x] Strict TypeScript and Vite production build passed after the final additions. The scene self-check passed, including pressure masking/room means and direction arrows. Generated build-pack assertions and the host C++ firmware mock also passed.
- [x] 2D mask: **64 × 48**, y = **1.2 m**, **1948 closed FLUID cells**, **429 SOLID cells**, no accidental indoor/outdoor face contact with openings closed.
- [x] Openings span host-wall thickness; the bedroom 3 window adds seven cells and its door adds four. New fluid cells receive finite initial fields.
- [x] Closed baseline remains still, preserves uniform temperature and conserves pollutant mass. Nonuniform sealed transport conserves pollutant mass within the tested tolerance.
- [x] Documented validation route carries haze from the north window; fans move air without cooling uniform room air, AC cools locally, purifiers remove haze and assumed power integrates into kWh.
- [x] Numeric guards recover nonfinite fields/settings; deterministic step probes remain finite over 300 simulated seconds.
- [x] Solver-only Node/V8 probe: heavy open-window/device setup averaged **1.44 ms per simulated second** over 300 calls. This is not a full-browser FPS benchmark.
- [x] One 60-second step versus sixty 1-second steps differed by less than **0.003 °C** and **0.011 µg/m³**, with equal elapsed time and energy to floating-point tolerance.
- [x] TypeScript checks passed, including the production-build check.
- [x] Final suite/build/scene checks after the pressure and flow-direction additions.

## Browser checks and rehearsal

- [x] Native Zen browser with actual GPU/WebGL: 3D apartment, floor-plan camera, dimensions, air-quality view, relative-pressure labels/colors and airflow colors/arrows observed.
- [x] Model PNG downloaded and opened; labels and the separate legend footer display correctly.
- [x] `scripts/browser-check.js`: **9 browser assertions passed**, covering standalone keyboard/no-USB use, scenarios, dialog shortcut protection, CSV settings, the actual optimiser worker and retained Apply state.
- [x] The tested browser optimiser run evaluated **27 arrangements in about 1.45 seconds**, comparing a combined score of **4.97 → 4.86**. This is one measured scenario/run, not a guarantee for every setup or a percent-haze reduction.
- [x] `scripts/browser-serial-check.js`: **9 mocked browser assertions passed**, covering baud/handshake, scenario messages preserving a closed physical door, one-time echo handling, invalid input rejection, disconnect and continued standalone controls.
- [x] [Presentation walkthrough](docs/presentation-demo.md) is written, with reproducible engine probes and the validation-door setup. Use **click Apply layout** to avoid Enter activating a focused Compare button.
- [x] Production preview at localhost:4173: native WebGL renders, keyboard loads haze, actual worker compares 27 layouts in 1.1 seconds, Apply updates fan/purifier and keeps the report. Build-pack index, ZIP and both cutting-plan SVGs serve successfully.
- [x] Responsive controls at 390 px: all five overlay tabs remain reachable, with no horizontal page overflow. This checks layout, not mobile GPU performance.
- [ ] Formal five-minute full-browser FPS/reset record on the presentation machine.
- [ ] Full spoken demo rehearsal and backup screen recording saved.

Headless Chromium's 3D rendering was blocked by its SwiftShader/driver environment. That is not a WebGL pass: actual 3D visual evidence comes from native Zen. Headless/browser scripts verify application behavior separately. Mock serial streams are not a real board; no physical USB or servo result is implied.

## Physical work when parts arrive

- [ ] Verify the printed 50 mm bar, cardboard thickness and 187.692 × 118.462 mm outer footprint; dry-fit walls and hinges.
- [ ] Obtain and identify the SSTuino model; confirm the board package and actual D5/D6 pin assignments.
- [ ] Compile/upload the actual board sketch. The default has two input channels and `ENABLE_SERVOS = 0`.
- [ ] Check buttons/limit switches individually, including debounce and the limit switch's physical-state authority.
- [ ] USB connect, `HELLO` / `GET:ALL`, one press → one app update, unplug/reconnect and keyboard-only fallback on actual hardware.
- [ ] Only if servos will be used: identify supply/current needs, verify common ground, calibrate horns detached, check linkage travel, then enable and test one servo.

The host C++ check exercises the sketch with mocked Arduino functions. No AVR upload, live USB integration, physical switch operation or servo motion is claimed as verified. See [hardware instructions](docs/hardware.md).

## Original acceptance tests: current disposition

| Original test | MVP disposition |
|---|---|
| AT-1 automated suite | PASS for implemented modules; no CPU LBM/source-buffer suite exists. |
| AT-2 3D voxeliser | N/A, intentionally replaced by the verified 2D mask above. The 23,713-cell 3D target is not claimed. |
| AT-3 stationary closed baseline | PASS for the 2D scalar/flow checks; no 3D LBM population test. |
| AT-4 GPU versus CPU | N/A, neither 3D LBM backend was shipped. |
| AT-5 vertical buoyancy | N/A, the plan view has no vertical dimension. |
| AT-6 cross-ventilation | Automated 2D route check PASS; validation/browser opening path observed. Full demo rehearsal remains pending. |
| AT-7 purifier | Automated local haze removal PASS. |
| AT-8 five-minute browser performance | Pending full-browser run; solver timing alone is not acceptance. |
| AT-9 protocol | Automated parsing, mocked lifecycle and browser serial-mock checks PASS; actual board sync pending arrival. |
| AT-10 hardware loop / servo | Pending hardware; servos disabled by default. |
| AT-11 disconnect | Mocked lifecycle/browser disconnect covered; physical unplug/reconnect pending. |
| AT-12 optimiser | Automated scoring/search checks and actual browser worker/Apply PASS; physical servo application remains pending hardware. |
| AT-13 fallback | The 2D plan engine is the only live backend; no WebGPU feature flag is required. |
| AT-14 honesty | Mode/relative-pressure honesty labels observed in native WebGL and export checks. No sensor or reference-CFD validation claims are authorized. |

Written by gpt-6-astra in Codex on behalf of Edmund
