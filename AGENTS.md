# AGENTS.md: instructions for coding agents (Astra etc.)

You are building **HeatSim**: a live 3D toy-CFD of heat and haze in a 4-room HDB flat, driven by a cardboard model over Web Serial. **Read `docs/00`–`docs/08` before writing code.** The docs are the spec. If the code and the docs disagree, the docs win, unless you find a real bug in them; then fix the doc in the same commit and say so.

Hard deadline: **code freeze Thu 15 Oct 2026, 16:00 SGT.** Prefer working and simple over complete and clever.

## Non-negotiables
1. **No sensors.** No PSI, PM2.5 or temperature hardware and no live NEA API. Heat and haze come from scenario presets or explicit manual conditions (doc 05). Contractor Study may show an attributed official Windy reference-map embed for this noncommercial hackathon demo, with an external-link fallback. User-authorized demo exception: My flat may explicitly load regional temperature, humidity and wind from the free noncommercial Open-Meteo API with attribution, timestamps and a manual/offline fallback. No polling, sensors, live NEA or automatic map scraping. Regional forecast wind is not measured window airflow; haze remains manual.
2. **The original Flat simulation, Cooling Lab and cardboard pack read only `assets/hdb-3d/hdb_4room_boxes.json` for geometry.** The GLB is visual only. **User-authorized Contractor Study exception:** the separate Contractor Study may use validated metre-based JSON containing axis-aligned rooms and explicit openings, including its three bundled examples. Its model must derive geometry from that validated plan, not substitute the canonical HDB geometry. Imported plans must not modify the original workspaces, hardware mapping or physical pack. No automatic PDF/image interpretation is authorized or implemented; see `docs/contractor-study.md` for the supported contract.
3. Call it a **qualitative "toy CFD"** in the UI (About box, the "SIMULATED" tags). Never claim accuracy.
4. Every hardware input is also reachable by keyboard and on-screen controls (doc 03 keyboard map).
5. The live demo must never freeze: NaN watchdog, serial disconnect handling, worker errors caught.
6. Don't change the protocol (doc 04) without updating the doc and the firmware outline.
7. Don't add a backend, accounts, analytics or deployment. It runs on `localhost`.

## Stack [D]
- **Vite + TypeScript (strict)**, `npm` (Bun is fine for scripts).
- **three.js** (`three` ≥ 0.169, `WebGLRenderer`, `GLTFLoader`, `OrbitControls`). Optional: `lil-gui` for the panel.
- **WebGPU** (WGSL compute) for the sim, with its own `GPUDevice`. Types: `@webgpu/types`.
- **Vitest** for tests. **No UI framework required** (plain DOM is fine).
- Target: **Chrome (latest) on an M4 Pro MacBook**, served from `http://localhost:5173`.

## Folder layout
```
heatsim/
  index.html
  package.json  tsconfig.json  vite.config.ts
  public/assets/hdb-3d/            -> copy of assets/hdb-3d (served statically; or point Vite publicDir at assets/)
  src/
    main.ts                         bootstrap: load JSON+GLB, pick backend, start loop
    state/store.ts                  AppState + actions (setOpening, setFan, setScenario, applyLayout...)
    config/params.ts                SimParams defaults (doc 02 §3), grid presets (doc 02 §1.2)
    config/scenarios.ts             doc 05 §1
    config/slots.ts                 doc 05 §3
    config/mapping.ts               hardware id → JSON name (doc 04 §3)
    geometry/boxes.ts               types + loader for hdb_4room_boxes.json
    geometry/voxelize.ts            doc 02 §1.3–1.5 → VoxelGrid
    sim/types.ts                    VoxelGrid, SimParams, FieldSnapshot, SimEngine interface
    sim/d3q19.ts                    c, w, opp tables (single source for CPU and for WGSL string generation)
    sim/sources.ts                  buildSources(grid, state, scenario) → Float32Array(8N)
    sim/lbm3d-cpu.ts                reference engine
    sim/lbm3d-webgpu.ts             GPU engine (buffers, pipelines, step, readback)
    sim/shaders/lbm.wgsl            lbmStep
    sim/shaders/scalar.wgsl         scalarStep
    sim/metrics.ts                  room means, J score
    sim/fallback2d/engine.ts        2D fallback (doc 02 §7)
    render/scene.ts                 renderer, camera, controls, GLB, opening animation
    render/slices.ts                slice ShaderMaterial + Data3DTexture upload
    render/particles.ts
    render/colormaps.ts
    io/protocol.ts                  parseLine / formatLine (pure, tested)
    io/webserial.ts
    io/wsclient.ts                  for the optional bridge
    io/keyboard.ts
    ui/panel.ts  ui/hud.ts  ui/about.ts  ui/toast.ts
    optimiser/worker.ts  optimiser/greedy.ts  optimiser/api.ts
  tests/                            *.test.ts (voxelize, protocol, sources, lbm-cpu, greedy)
  firmware/heatsim_board/heatsim_board.ino   (doc 04 §7)
  tools/bridge/bridge.ts            optional Bun/Node serial⇄WS bridge
  validation/export_geometry.ts     doc 06 §2
  CHECKLIST.md                      acceptance tests (doc 07), ticked as you go
```

## Engine interface (both GPU and CPU engines implement it; the 2D fallback too)
```ts
interface SimEngine {
  init(grid: VoxelGrid, params: SimParams, scenario: Scenario): Promise<void>;
  setCellTypes(changed: Uint32Array /* cell indices */, types: Uint32Array): void;  // opening toggles
  setSources(src: Float32Array /* 8N */): void;
  setScenario(s: Scenario, resetFields: boolean): void;
  step(n: number): void;                       // enqueue n steps
  requestSnapshot(): void;                     // async readback; non-blocking
  latestSnapshot(): FieldSnapshot | null;      // ux,uy,uz,T,C (physical units), step, simTime
  saveCheckpoint(): void; restoreCheckpoint(): void;  // NaN watchdog
  dispose(): void;
}
```
The engine must not touch the DOM, so it can run inside the optimiser worker.

## Milestones (merge to `main` only when green)
| M | Deliverable | Done when |
|---|---|---|
| M0 | Vite+TS scaffold, `voxelize.ts`, `protocol.ts` with tests | AT-1, AT-2, protocol tests pass |
| M1 | three.js scene with GLB, ceiling opacity, opening animation, AppState, keyboard, panel; slice shows the **voxel mask** | toggling `1` animates `window_bedroom3_1` and its cells flip in the mask view |
| M2 | CPU reference LBM + WebGPU LBM + scalars | AT-3, AT-4, AT-5 |
| M3 | Sources (fan/AC/purifier/sun/people), scenarios, particles, legends, HUD metrics, NaN watchdog | AT-6, AT-7, AT-8 |
| M4 | **13:30 go/no-go.** If M2/M3 aren't solid, ship `fallback2d` as the default | AT-13 |
| M5 | Web Serial + mapping + echo semantics (can be built in parallel from M0) | AT-9, AT-10, AT-11 |
| M6 | Optimiser worker + result card + Apply | AT-12 |
| M7 | Polish: About/honesty, help overlay, fonts, "SIMULATED" tags; tag `v1.0-demo` | AT-14; a full demo run per doc 05 §2 without touching code |

Parallel tracks that don't block each other: **(1) sim core** (M2–M3), **(2) render/UI** (M1, using a fake `FieldSnapshot` with analytic data until M2 lands), **(3) io/protocol/firmware/bridge** (M5), **(4) optimiser** (M6, against the CPU engine first).

## Definition of done (whole project)
- `npm install && npm run dev` → open Chrome → the app runs with no console errors. `npm test` passes. `npm run build` succeeds.
- All MVP items in doc 07 work; AT-1…AT-14 ticked in `CHECKLIST.md` (or marked N/A with the reason).
- Works with **no board connected** (keyboard only) and with the board connected.
- README "Run it" section updated with exact commands. Any parameter tuned away from the doc defaults is updated in doc 02 §3.
- No secrets, no personal data, no large binaries (>20 MB) committed.

## Coding rules
- TypeScript strict, no `any` in sim/geometry/io. Pure functions for voxelize, sources, protocol and greedy, so they can be tested.
- Generate the D3Q19 tables in WGSL from `d3q19.ts` (string template) so CPU and GPU can't drift apart.
- Don't `await` GPU readbacks inside `requestAnimationFrame`.
- Clamp and guard everything that comes from serial (ranges in doc 04).
- Small commits with clear messages. Keep `main` runnable after 15:00. Put stretch work on branches.
- If something in the docs is marked **[U]**, verify it (a tiny test) before depending on it, and update the tag to **[V]** with a note.

Written by gpt-6-astra in Codex on behalf of Edmund
