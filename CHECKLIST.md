# MVP verification and handoff

**Launch handoff: 15 October 2026. My flat, Window fan test and Compare floor plans work without hardware. The supplied SSTuino's physical operation remains unverified.** Checked software does not imply checked physical hardware. The amended [simulation specification](docs/02-simulation.md) takes precedence over the original 3D roadmap.

## Multiple standing fans · follow-up scope

My flat now supports a Main fan plus up to seven added fans, with individual power/speed/world direction and valid-floor placement. Added fans stay fixed during Main fan preset optimisation; thermal captures include all fans. D4/D5 and physical cut geometry are unchanged.

- [x] Resumed verification: **287 tests across 23 files**, strict TypeScript/Vite production build, scene checks and diff checks passed. Collaborative browser with WebGL passed **13 standing-fan assertions** (including paused power/time updates, invalid input, room placement, capacity and workspace retention) and **31 homeowner assertions** (including real worker suggestions, Apply/Undo and stale-result handling).
- [x] Paused control edits refresh airflow and power without advancing fields/time; pausing flushes the displayed clock.
- [ ] Native multiple-fan drag rehearsal, five-minute presentation-machine FPS run and physical USB tests remain unverified. The earlier 265-test/254-browser launch record below predates this extension.

## Prior homeowner launch and Bedroom 3 inputs

The prior launch used D4 for both Bedroom 3 windows and D5 for its purifier. Its software gate was **265 tests across 20 files** plus **254 browser assertions**; the dated 250-test/162-browser checkpoint below predates these changes.

- [x] Host firmware checks passed in both default and legacy modes, including D4's 30 ms press latch (`WIN1` north + `WIN4` east), no repeated hold/release toggle, D5 hold-to-enable purification, owned-state startup/reconnect and 32-bit timer rollover. Serial/protocol focused tests: **25 passed**. Host checks use mocked Arduino functions, not the physical board.
- [x] Actual **SSTuino II Rev A** compilation passed with installed core **1.1.3**, FQBN `sstuino-ii:megaavr:4809` and Arduino IDE's bundled CLI: default **4226 program bytes / 259 RAM bytes**; legacy **4217 / 281**. This is a board-target build, not an upload or physical USB test.
- [x] The CPU frame cap is implemented and verified: each frame advances at most **one simulated second**, with elapsed time/energy matching the advance. In a warmed high-wind/all-open/fan Bun probe, 15-second calls took median **125.10 ms** versus **8.32 ms** for capped one-second calls (20 calls each; maxima **126.74 / 10.06 ms**). These are solver diagnostics, not browser FPS. Actual worker lifecycle probes passed with no worker handles left active.
- [x] Prior launch browser gate passed **254 assertions**: serial **40**, outdoor controls **17**, Cooling Lab **69**, three-plan study **63**, homeowner **31**, launch **34**. The launch checks cover five named dialogs/focus/shortcut protection, fallback-plan keyboard room selection, **106 actual solver arrows** retained across five overlay modes versus zero when still, advice startup-error retry, and standalone behavior with cancelled/denied/unavailable USB or missing WebGPU. Headless WebGL was unavailable and USB was mocked; these are browser-behavior results, not physical USB or native 3D/GPU proof.
- [x] Final combined gate at **13:25 SGT** passed **265 tests across 20 files**, strict TypeScript/Vite production build, `bun src/scene-check.ts` and `git diff --check`. Scene checks cover actual arrows in all five modes, reduced motion, hidden-texture skip/resume and disposal. After the final fallback-label/spacing correction, TypeScript/production build and diff checks passed again. Vite retains its **807.87 kB** main-chunk size warning; the build succeeds.
- [x] Final visual review passed at **390, 640 and 1280 px** in all three workspaces: no horizontal or interactive-control overflow, sampled visible DOM text contrast passed (including About), and the corrected 390 px fallback labels/caption are readable. Native keyboard Enter selected a fallback room; Escape restored dialog focus with a visible ring. Native 3D review remains separate from the headless assertions. At actual 200% zoom, the UI stays operable but 3D labels can be dense or overlap at intermediate widths; the room list/selector remain available.
- [ ] Actual board upload, D4 press/hold/release and D5 hold/release verified through USB.

## Prior Contractor Study and appliance placement checkpoint

This earlier application gate includes Contractor Study and placement. The separate physical measurement-guide review also passed; it changes instructions, not cutting geometry or material quantity.

- [x] `tests/contractor-plan.test.ts`: **26 focused validation tests passed**, including the three distinct 80/72/84 m² example inputs, unsupported/invalid geometry, permanent passages and minimum aperture dimensions.
- [x] Canonical/imported-model suite: **35 tests passed** across `tests/thermal-model.test.ts` (**18**) and `tests/thermal-factory.test.ts` (**17**). Geometry/state isolation, actual plan volumes/connectivity/orientation, device effects and opening/envelope checks are covered. Six canonical 600-second differential cases retained the earlier numerical behavior.
- [x] `tests/contractor-comparison.test.ts`: **13 focused tests passed** for exactly three actual model instances, shared weather/initial values/occupancy/horizon, bounded traces, metric ties/shortlist and worker cancellation/error handling.
- [x] The JSON snippet in [the Contractor Study guide](docs/contractor-study.md) passes the actual parser. Documentation distinguishes browser import's **500,000-byte** cap from the parser's **1 MiB** cap, permanent passages, full-input fingerprints and illustrative example provenance.
- [x] Contractor UI owner reports strict TypeScript passed with final controls, explicit official Windy reference-map loading, room selectors/dragging and HTML/JSON exports. This is not a browser-rendering result.
- [x] Final application gate at **11:35:52 SGT**: **250 tests across 18 files passed**; strict TypeScript/Vite build, `bun src/scene-check.ts` and `git diff --check` passed. This includes final comparison, placement and export tests. Canonical source geometry and the original 173-test baseline remain unchanged; the new physical reference-page guard is separate.
- [x] Actual three-example worker runs at **1200/7200 seconds per plan** completed in about **109/271 ms**, with at most 121 samples per plan. Cancellation/retry and parent heartbeat checks passed. These are local runtime timings, not browser FPS.
- [x] Browser regression at that checkpoint: **162 assertions passed**: **63 Contractor Study + 69 Cooling Lab + 17 outdoor controls + 13 mocked serial**. Contractor coverage includes validated geometry and orientation, invalid imports, provenance, actual worker/shared conditions/horizon, chart/report correspondence, downloads, cancellation/error/stale behavior, workspace isolation and placement pointer-event/room-selector behavior.
- [x] The browser's 1200-second three-plan run took about **63 ms**, retaining **121 samples per plan**, with a maximum **20 ms** parent-heartbeat gap. At **390 px**, document width stayed 390 without horizontal overflow; native Tab moved Project → Location. Study placement used dispatched pointer events; a trusted native study drag is not separately claimed.
- [x] Optional Windy integration behavior verified: no default map, explicit load only with valid coordinates, coordinate edits clear the old frame, and loading does not change shared weather. **Actual external map tiles/attribution were not visually verified** in the headless environment; the official full iframe and external-link/manual-input fallback remain separate from simulation data.
- [x] Native **Zen/WebGL** portable dragging: fan Bedroom 3 → Living (selector 3), purifier Living → Bedroom 2 (selector 4), invalid outside drop retained state and orbit resumed. Lab → Study → Flat retained positions and re-enabled portable dragging. Escape/pointer-cancel handlers were reviewed but not separately UI-triggered by the atomic-drag automation. Fixed AC does not move.

- [x] Final independent [measurement-guide](public/build-pack/measurement-guide.html) guard passed: all **7 existing cutting SVGs and JSON/CSV cut data are byte-identical** to the preceding release. Nine new **1:1 A4 paper reference diagrams** cover **20 openings, 40 absolute edge leaders and 60 table rows**. Measurements, named relative gaps, viewing directions and text bounds were checked, including the corrected right-hand datum labels on W01/W10/W12. These pages add instructions, not cardboard: **2 A4 sheets total, 3 mm thick, no roof** remains the material requirement. Physical printing/cutting is still unverified.

The original HDB geometry, hardware mapping and two-A4-sheet cut geometry remain outside imported-plan scope. The pack ZIP/index now include the new instruction pages. No site calibration, physical hardware result, compliance assessment or paid licensing implementation is claimed.

## Outdoor conditions and explicit comparisons

- [x] `bun run test`: **173 tests across 13 files passed** at **10:58:54 SGT**; strict TypeScript/Vite production build and `bun src/scene-check.ts` passed.
- [x] `tests/air-quality.test.ts`: **16 tests passed**, including breakpoint/truncation/beyond-scale handling and all 501 integer equivalent round trips. This verifies the scenario helper, not health or live-AQI accuracy.
- [x] Seven added planar wind tests cover cardinal FROM direction, conservation and flow-cache invalidation; GPU transport receives the same CPU-prepared flow.
- [x] Thermal model focused suite: **18 tests passed**, including main-door-only corridor temperature/PM2.5, wind direction, sheltered hydrostatic boundary, incoming-flow air-change accounting and signed heat-removal/energy metrics.
- [x] Generalized comparison focused suite: **13 tests passed**, including captured interventions with **current** weather/corridor/duration, identical cloned initial state, both actual configurations and candidate-minus-baseline deltas. Existing cancellation/error/sample bounds remain covered.
- [x] `scripts/browser-environment-check.js`: **17 browser assertions passed** for manual inputs, index equivalent and units, beyond-scale/invalid values, four wind-from choices, scenario/weather reset preserving controls, form-shortcut isolation and CSV. At **390 × 844**, document width stayed **390 px** with controls in bounds; native Tab moved PM input → index-equivalent input.
- [x] Actual generalized **Bun worker** pairs of **1200/7200 seconds** completed in about **223/1051 ms**, with at most **121 samples/progress reports**. A 10 ms parent heartbeat had maximum **13 ms** gap; current shared conditions, new CSV metrics, `AbortError` cancellation and immediate retry passed. Maximum observed energy/mass residuals were **4.30 × 10⁻⁷ J / 3.40 × 10⁻¹⁶ m³/s**. These are local runtime checks, not browser FPS.
- [x] Final `scripts/browser-cooling-check.js` regression: **69 assertions passed**, covering baseline/candidate actual configurations, current shared weather/corridor/horizon, CSV metrics, local weather/reset/scenario behavior, stale/cancel handling and retained GPU-fallback checks. The 1200-second worker pair took about **91 ms**, with 121 samples and a maximum **21 ms** parent-heartbeat gap over six ticks.
- [x] Final `scripts/browser-serial-check.js`: **13 mocked-serial assertions passed**, including same-scenario wind-override reset, no echo and duplicate messages preserving time/energy. At **390 × 844**, the lab had no horizontal overflow; native Tab moved experiment mode → Capture baseline. Headless WebGL was unavailable: these are application-behavior checks, not new real-device GPU/3D evidence.
- [x] Native **Zen** executed the new west-wind `gpu-check.html?case=west` case on an actual GPU. At **60.2 simulated seconds**, maximum CPU/GPU differences were **0.00001717°C / 0.0001221 µg/m³**. This extends planar numerical parity evidence; it is not physical validation or Chrome-specific verification.
- [x] Fresh direct-engine probe of the [haze walkthrough](docs/presentation-demo.md): only ten ordinary windows differed, with identical current weather/initial state and 1200-second horizon. Whole-flat PM2.5 was **146.48 → 34.21 µg/m³**, integrated concentration **35.41 → 12.11 µg·h/m³**, and electricity **13.33 Wh per arm**. The closed-window candidate's single passive exterior connection has approximately zero sustained flow in this model; leakage and single-sided turbulent exchange are omitted.
- [x] Final annotation guard passed: all **7 original A4 pages, 140 rectangle attributes and 97 original lines** retained. **40 opening-offset/gap labels and 20 table rows** match the schedules to **0.001 mm**. Dimensions, CSVs, floor/leaf plans and source geometry are byte-identical to the prior release. Material remains **2 A4 sheets, 3 mm, no roof**. Raster/glyph checks found no clipping/collisions; printer/cutter validation remains pending.
- [x] Final generator and strict TypeScript/production build passed after the annotation freeze at **11:05 SGT**; production output contains the updated SVGs and ZIP. Nine changed application/specification documents passed relative-link/authorship checks; `git diff --check` passed.

These new checks are distinct from the prior Cooling Lab/WebGPU checkpoint below. Test counts and browser assertions are separate measurements, not interchangeable acceptance totals.

## Prior integration gate · 10:45 SGT

- [x] `bun run test`: **137 tests across 12 files passed** after the final envelope model and GPU additions.
- [x] `bun run build`: strict TypeScript and Vite production build passed; build and `bun src/scene-check.ts` were rerun after the final scene-label polish at **10:45 SGT**.
- [x] `python3 scripts/build-pack.py` assertions passed. The generated physical pack, its generator/guide and canonical geometry remain unchanged from the released two-A4-sheet handoff. `git diff --check` passed.
- [x] Final Cooling Lab browser regression passed **40 persistent assertions**, plus the separate backflow fixture below. Native-device GPU checks passed in Zen; Chrome GPU execution was not verified.

## Prior Cooling Lab extension acceptance · 10:45 SGT

- [x] `tests/thermal-model.test.ts`: **10 tests passed**, including JSON-derived volumes, equilibrium, isolated energy/particle conservation, genuine make-up routes, blocked flow with motor heat, warm-below mixing, hotter-inlet warming and the final exterior-face/envelope balance.
- [x] `tests/thermal-comparison.test.ts`: **10 tests passed** for cloned identical initial fields, only `vent.on` changing, exact final partial intervals, signed differences, bounded samples, cancellation/replacement, stale events, errors and timeout handling.
- [x] Core tests and direct paired probes cover blocked make-up paths and supply/exhaust operation; the presentation probe shows cooler evening air, blocked motor heating and the haze trade-off. These are numerical examples, not measured outcomes.
- [x] Motor heat is a positive model input. Browser calculator checks changed hypothetical pressure without invalidating the completed pair; its pressure is separate from the plan index and its static-temperature drop is not a room source.
- [x] `bun run test -- tests/thermal-stress.test.ts`: **1 test passed**. A two-hour extreme-input run with open/blocked/reopened topology stayed finite; checkpoints met energy residual **<0.01 J**, mass residual **<10⁻⁹ m³/s** and blocked flow **<10⁻⁶ m³/h**.
- [x] Post-envelope **actual Bun worker** pairs of **1200/1800/7200 seconds** completed in about **202/273/817 ms**, retaining **121/91/121 samples**. A 10 ms parent heartbeat had a maximum **12 ms** gap; cancellation rejected with `AbortError`, and an immediate 10-second retry passed. These are local timing examples, not browser guarantees.
- [x] Thermal, calculator, export, comparison-worker and GPU tests are included in the final **137-test** suite; strict production build passed.
- [x] `scripts/browser-cooling-check.js` via gstack: **40 browser assertions passed** at 1280 × 720, using the actual worker. Covers shared initial state, exact horizon, chart/CSV correspondence, settings invalidation, cancellation/re-run, startup-error retry, workspace isolation and clock/3D-panel restoration. Final additions cover stale-capture/explicit-refresh behavior, blocked-flow rendering, and real-app CPU continuation with rejected or pending GPU-adapter requests.
- [x] The tested 1200-second browser pair completed in about **93 ms**, with 121 samples; six parent-heartbeat ticks had a maximum **25 ms** gap. This is one headless behavior run, not a full-GPU FPS benchmark.
- [x] At **390 × 844**, document width remained 390 with no horizontal overflow. Native Tab moved Room → Opening; ArrowRight changed the calculator from 30 to 35 Pa and the ideal drop from 0.0256 to 0.0299°C while retaining the completed comparison.
- [x] Final integrated browser workflow rerun after the GPU/app wiring freeze. A separate focused backflow fixture used the real lab component/worker with a core-valid 10 m/s opposing wind: **−10.0 m³/h** produced an inward arrow and an explicit backflow description. This is **40 script assertions plus one fixture**, not 41 assertions in the script.
- [x] The earlier Cooling Lab walkthrough was checked against direct engine probes for 300 m³/h, 20-minute bedroom 3 evening open/blocked-route comparisons. The [current walkthrough](docs/presentation-demo.md) adds explicit baseline/candidate outdoor-condition experiments; its new evidence is recorded above. Spoken rehearsal remains separate.

The prior extension evidence above is separate from the earlier baseline record below. Physical cardboard dimensions and electronics status remain unchanged.

## Optional WebGPU transport verification

- [x] **29 focused plan/preparation/GPU/lifecycle tests passed**, including eight mocked lifecycle tests for cleanup/failure paths. Strict TypeScript also passed at this checkpoint.
- [x] `gpu-check.html` passed on **native Zen / Firefox 157** with a real GPU device, WGSL compilation, scalar dispatch and readback. Over seeded **60.2-second** runs, worst CPU/GPU differences were **0.00002098°C** and **0.00007629 µg/m³**; sealed and open/wind/fan/purifier cases passed. Control snapshots, zero-time opening changes, reset, disposal and device recreation also passed. This is numerical backend agreement, not physical validation.
- [x] GPU lifecycle and app integration reviewed for stale readbacks, reset, workspace switching and CPU fallback. The separate final browser regression above covers actual CPU fallback for rejected/pending adapters; the direct GPU page verifies compute behavior. **Chrome GPU launch timed out**, so Chrome GPU execution is not claimed.

This path runs planar heat/haze transport only. Geometry and airflow stay on the CPU; Cooling Lab stays in its separate CPU worker. It does not satisfy the original 3D-LBM CPU/GPU acceptance test.

## Baseline automated checks (10:09 SGT, retained for traceability)

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

## Baseline browser checks and remaining rehearsal

- [x] Native Zen browser with actual GPU/WebGL: 3D apartment, floor-plan camera, dimensions, air-quality view, relative-pressure labels/colors and airflow colors/arrows observed.
- [x] Model PNG downloaded and opened; labels and the separate legend footer display correctly.
- [x] `scripts/browser-check.js`: **9 browser assertions passed**, covering standalone keyboard/no-USB use, scenarios, dialog shortcut protection, CSV settings, the actual optimiser worker and retained Apply state.
- [x] The tested browser optimiser run evaluated **27 arrangements in about 1.45 seconds**, comparing a combined score of **4.97 → 4.86**. This is one measured scenario/run, not a guarantee for every setup or a percent-haze reduction.
- [x] `scripts/browser-serial-check.js`: **9 mocked browser assertions passed**, covering baud/handshake, scenario messages preserving a closed physical door, one-time echo handling, invalid input rejection, disconnect and continued standalone controls.
- [x] [Presentation walkthrough](docs/presentation-demo.md) is written, with reproducible engine probes and the validation-door setup. The earlier button was labelled **Apply layout**; the current homeowner UI uses **Apply these changes**. Click it explicitly to avoid activating another focused button.
- [x] Production preview at localhost:4173: native WebGL renders, keyboard loads haze, actual worker compares 27 layouts in 1.1 seconds, Apply updates fan/purifier and keeps the report. Build-pack index, ZIP and both cutting-plan SVGs serve successfully.
- [x] Responsive controls at 390 px: all five overlay tabs remain reachable, with no horizontal page overflow. This checks layout, not mobile GPU performance.
- [ ] Formal five-minute full-browser FPS/reset record on the presentation machine.
- [ ] Full spoken demo rehearsal and backup screen recording saved.

Headless Chromium's 3D rendering was blocked by its SwiftShader/driver environment. That is not a WebGL pass: actual 3D visual evidence comes from native Zen. Headless/browser scripts verify application behavior separately. Mock serial streams are not a real board; no physical USB or servo result is implied.

## Remaining physical setup and checks

- [ ] Verify the printed 50 mm bar, cardboard thickness and 187.692 × 118.462 mm outer footprint; dry-fit walls and hinges.
- [ ] Confirm the supplied SSTuino version/board package and the guide's D4 compatibility note. Wire the D4 button to GND and the D5 passive switch COM→GND, NO→D5, leaving NC unconnected.
- [ ] Upload the board-target-compiled sketch to the actual SSTuino. The default `SINGLE_PURIFIER_SWITCH = 1` enables the D4 window button and D5 purifier switch, with `ENABLE_SERVOS = 0`. Flag `0` restores the alternative WIN1/D5 and DOOR1/D6 inputs.
- [ ] Check D4 press toggles both Bedroom 3 windows; holding/releasing does not repeat. Check D5 held→corner purifier ON and release→OFF, 30 ms debounce and physical-state authority. Confirm startup/reconnect reports these owned states without changing the fan, weather or other openings.
- [ ] USB connect, `HELLO` / `GET:ALL`, one press → one app update, unplug/reconnect and keyboard-only fallback on actual hardware.
- [ ] Only if servos will be used: identify supply/current needs, verify common ground, calibrate horns detached, check linkage travel, then enable and test one servo.

The host C++ check exercises the sketch with mocked Arduino functions; the SSTuino II board-target compile is recorded above. No board upload, live USB integration, physical switch operation or servo motion is claimed as verified. See [hardware instructions](docs/hardware.md).

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
| AT-9 protocol | Automated parsing, mocked lifecycle and browser serial-mock checks PASS; actual board sync remains unverified. |
| AT-10 hardware loop / servo | Pending hardware; servos disabled by default. |
| AT-11 disconnect | Mocked lifecycle/browser disconnect covered; physical unplug/reconnect pending. |
| AT-12 optimiser | Automated scoring/search checks and actual browser worker/Apply PASS; physical servo application remains pending hardware. |
| AT-13 fallback | Both live paths use the 2D plan: optional WebGPU transports scalars, and CPU continues when it is unavailable/fails. New app-level fallback checks are recorded separately above. |
| AT-14 honesty | Mode/relative-pressure honesty labels observed in native WebGL and export checks. No sensor or reference-CFD validation claims are authorized. |

Written by gpt-6-astra in Codex on behalf of Edmund
