# 03 · Rendering and UI

## Renderer choice [D]
- **three.js `WebGLRenderer`** (pin `three@0.169.0` or newer; ben's viewer uses 0.169.0 [V]) for drawing. **WebGPU is used only for the sim compute**, on its own `GPUDevice`.
- Data path: sim → `copyBufferToBuffer` into a `MAP_READ` staging buffer → `mapAsync` (never awaited inside the frame) → `Float32Array` → `THREE.Data3DTexture` (`RedFormat`/`FloatType`, `LinearFilter`) per displayed field, plus a CPU copy of `u` for the particles.
- Why not `WebGPURenderer` with shared storage textures: it would avoid the readback, but device sharing with three's WebGPU backend is less documented [U] and riskier for a one-day build. Readback is about 1 MB per snapshot, which is cheap on unified memory. Revisit only after the MVP works.

## Scene
- Load `assets/hdb-3d/hdb_4room.glb` with `GLTFLoader` (129 named nodes, metres, +Y up [V README]). Node `userData` carries `{role, sim_solid}` from glTF extras [V].
- **Ceiling:** node `ceiling` (material alpha BLEND, opacity 0.25). Default opacity 0.15, adjustable. Ceiling `depthWrite=false, renderOrder=1`, slices `renderOrder=2`, particles `renderOrder=3`. This is the same trick as ben's viewer, so fields stay visible through the roof [V viewer.html].
- **Cutaway:** optional horizontal clipping plane (`renderer.localClippingEnabled = true`) applied to walls only, height slider default 1.8 m.
- **Doors and windows** animate to match `AppState.openings`. Doors rotate −90° about Y and windows −0.6 rad, about the hinge pivot already baked into the node [V README]. Tween over 300 ms. Some leaves swing through walls (known issue, cosmetic [V README]).
- **Movable devices** (portable fan, purifier) are simple three.js meshes created in code (cylinder plus arrow for the fan, box for the purifier), placed at slot positions with the fan yawed by `angleDeg`. Hide the GLB's `purifier_living`/`purifier_master` nodes or use them as the purifier meshes. The AC on/off state is shown by tinting `ac_*` blue and drawing a small cold-jet arrow.
- Camera: `OrbitControls` with three preset views on keys `V1/V2/V3` (top-down plan, isometric from SE, inside living room). Default isometric.
- Outdoor ground plane plus a sun direction arrow for the sunny façade in the active scenario.

## Field display
1. **Slice planes** (MVP: one horizontal plane at `sliceH` = 1.2 m; stretch: an additional vertical plane on x or z). A `ShaderMaterial` samples `uField` (sampler3D) at the world position mapped to grid UVW: `uvw = (pWorld − gridOrigin) / (gridSize·dx)`. Discard where the cell is SOLID or OUTSIDE (upload `cellType` as a second R8 3D texture, sampled `NEAREST`).
2. **Colour maps** (`render/colormaps.ts`, 256-entry LUT texture):
   - T: blue→white→red, fixed range **24–40 °C** (fixed, so scenarios are comparable; show the legend).
   - C (PM2.5): white→yellow→brown→purple, **0–250 µg/m³**, with legend ticks at 12/35/55/150 [U: these resemble common PM2.5 band edges but are not NEA bands; label them as "guide"].
   - Speed: viridis, 0–1.5 m/s.
3. **Particles** (MVP: 4,000; stretch 10,000): `THREE.Points` with a small round sprite. CPU advection with trilinear `u` from the latest snapshot: `p += u_phys·dtVisual` with `dtVisual = 1/60 s × speed-up factor`. Respawn when a particle enters a SOLID/OUTSIDE cell, or after a lifetime of 4–8 s (random). Seed uniformly in FLUID cells, plus extra seeds at open exterior openings in haze scenarios. Colour by local C (haze mode) or T (heat mode). Optional short trails (stretch).
4. **Vectors** (stretch): arrow glyphs on a 1 m lattice on the slice plane.

## HUD and panel layout (1440×900 MacBook screen, mirrored to the projector)
```
┌──────────────────────────────────────────────────────────┬──────────────────┐
│                                                          │ SCENARIO ▼       │
│                     3D view                              │ [Hot afternoon]  │
│                                                          │ OPENINGS         │
│                                                          │  ☐ WIN1 bed3 win │
│                                                          │  ☐ DOOR1 main    │
│                                                          │  ...             │
│                                                          │ DEVICES          │
│                                                          │  Fan ON  ◀slot▶  │
│                                                          │  angle ━━●━━ 45° │
│                                                          │  AC ☐ unit ▼ 25° │
│                                                          │  Purifier ☐ slot │
├──────────────────────────────────────────────────────────┤ VIEW T | C | |u| │
│ Room table: living 31.2°C 88µg │ master ... │ SIMULATED  │ [OPTIMISE]       │
│ Sim time 02:31 (×4.8) · 60 fps · WebGPU · Model: ● USB   │ You 0.82 vs 0.55 │
└──────────────────────────────────────────────────────────┴──────────────────┘
```
- The link indicator is green for "Model connected (Web Serial)", amber for "WS bridge" and grey for "keyboard only". The last 5 received lines appear in a collapsible log.
- **Connect model** button (Web Serial requires a user gesture to call `requestPort`).
- Toasts for "Sim reset (unstable)", "Model disconnected" and "Optimiser done (−34%)".
- About box with the honesty text from doc 02 §8.
- The fonts must be readable from the back of the auditorium: room table at ≥18 px, legend at ≥16 px.

## Keyboard map (mirrors every hardware input) [D]
| Key | Action | Equivalent line |
|---|---|---|
| `1`–`9` | toggle window WIN1..WIN9 | `WIN<n>:0/1` |
| `Shift+1`–`Shift+9` | toggle door DOOR1..DOOR9 | `DOOR<n>:0/1` |
| `F` | fan on/off | `FAN:ON/OFF` |
| `[` / `]` | fan angle −15° / +15° (clamp 0–180) | `FANANG:<deg>` |
| `,` / `.` | fan slot prev / next | `FANPOS:<n>` |
| `-` / `=` | fan speed down / up (0–3) | `FANSPD:<n>` |
| `A` | AC on/off | `AC:ON/OFF` |
| `P` | purifier on/off | `PUR:ON/OFF` |
| `Shift+P` | purifier slot next | `PURPOS:<n>` |
| `Q` `W` `E` `R` `T` `Y` | scenario presets 1–6 (doc 05) | `SCN:<n>` |
| `O` | run optimiser | n/a |
| `Enter` | apply the optimiser's best layout | n/a |
| `Space` | pause/resume | n/a |
| `Backspace` | reset the scenario (re-initialise fields) | n/a |
| `Tab` | cycle view field T → C → speed | n/a |
| `↑` / `↓` | slice height ±0.2 m | n/a |
| `C` | connect model (opens the Web Serial picker) | n/a |
| `H` | toggle help overlay listing these keys | n/a |
Keys must not fire while focus is in a text input.
