# 08 · Assets

## MVP amendment · assets actually used

**This amendment takes precedence over the original asset-use plan below.** The running app and the build pack use the canonical **`assets/hdb-3d/hdb_4room_boxes.json`**, imported through `src/domain.ts`. It is the geometry source for both the simulation mask and the refined procedural three.js scene. The legacy `src/data/model.json` is not the authoritative import.

The GLB and original viewer are retained as provenance/reference assets; the live scene is built from JSON and does not load that GLB. No large Sketchfab/unknown-license fallback asset was added. The layout remains an approximate educational HDB-inspired plan, not an official building drawing.

Generated public handoff files live in `public/build-pack/`: actual-size floor/wall/leaf SVGs, room/opening/device CSVs, exact dimensions JSON, a printable HTML pack and `heatsim-build-pack.zip`. Rebuild them with `python3 scripts/build-pack.py`; edit the generator instead of editing generated templates. [Physical-model instructions](physical-model.md) explain 3 mm wall joints and hardware-fit limits. The required footprint is 187.692 × 118.462 mm; all 13 wall panels fit one additional A4 sheet.

Installed three.js carries the MIT license (`node_modules/three/LICENSE`); the current package dependency is `three ^0.180.0`, resolved by `bun.lock`. TypeScript's installed license is Apache 2.0, and Vitest's installed core license is MIT. No external LBM demo code was copied. Keep the inherited source-model provenance notes below; this build does not establish new rights to unrelated reference assets.

No SimScale/OpenFOAM result images or measurement datasets were produced. Do not describe source previews, synthetic field images or planned validation screenshots as measured/reference-CFD evidence.

Written by gpt-6-astra in Codex on behalf of Edmund

<details>
<summary>Original roadmap / reference specification — not a statement of shipped functionality</summary>

## In this repo: `assets/hdb-3d/` (copied from `/workspace/hdb-3d/` on 15 Oct 2026)
| File | Size | What | Use |
|---|---|---|---|
| `hdb_4room.glb` | 84 KB | Low-poly 4-room flat, 129 named nodes, PBR colours, glTF extras `{role, sim_solid, state, exterior}` | **Visual only** (three.js) |
| `hdb_4room_boxes.json` | 36 KB | 141 axis-aligned boxes (64 wall, 20 furniture, 12 floor, 12 room, 12 device, 11 window, 9 door, 1 ceiling) plus `rooms`, `bounds`, `sim_metadata` | **The only geometry input to the sim** |
| `preview.png` | 64 KB | top view with room labels | docs, slides |
| `viewer_preview.png` | 104 KB | headless render of ben's viewer | docs |
| `viewer.html` | 6 KB | ben's standalone three.js viewer (three@0.169.0 from unpkg). Its slice is **DEMO DATA**. | Reference for the ceiling/slice render-order trick and the `Data3DTexture` hookup notes |
| `build.py` | 12 KB | Procedural generator (Python + trimesh) that rebuilds the GLB and JSON | Edit geometry here, not by hand |
| `README.md` | 5 KB | ben's README: naming, coordinates, JSON schema | Read it |

SHA-256 at copy time: `hdb_4room.glb` `bfa5667f…7a7086b36`, `hdb_4room_boxes.json` `69227b18…a8751ec`.

**Provenance / licence:** ben's README states that the model is "generated procedurally by `build.py` (trimesh) and is original work, with no downloaded assets", and is an "approximate layout, loosely based on a common Singapore HDB 4-room plan. It is not an official HDB plan." [V README]. **No explicit licence file. [U] Confirm with ben that it's OK to keep in this private team repo** (assumed yes because he is on the project). Do not describe it as an official HDB floor plan in the pitch.

### Key facts for agents [V, from the JSON]
- Units are metres, +Y up, x = east 0..12, z = south 0..7.5, floor y = 0, ceiling 2.6. Plan 12 × 7.5 m = 90 m².
- Rooms: master_bedroom, master_bath, common_bath, bedroom2, bedroom3, kitchen, service_yard, household_shelter, corridor, corridor_lobby, dining, living.
- Openable names (identical in the GLB and JSON):
  - Doors: `main_door` (exterior, S), `door_master_bedroom`, `door_master_bath`, `door_common_bath`, `door_bedroom2`, `door_bedroom3`, `door_kitchen`, `door_service_yard`, `door_shelter`
  - Windows (all exterior): `window_master_1` (N), `window_master_2` (W), `window_master_bath` (N), `window_bedroom2_1` (N), `window_bedroom3_1` (N), `window_bedroom3_2` (E), `window_kitchen` (W), `window_service_yard` (S), `window_living_1` (S), `window_living_2` (S), `window_living_3` (E)
- Devices: `fan_living/dining/master/bedroom2/bedroom3` (ceiling fans, blade centre 2.2 m), `ac_living/master/bedroom2/bedroom3` (wall units, base 2.15 m), `ac_condenser_yard`, `purifier_living`, `purifier_master`.
- Wall boxes are already split around openings (e.g. `wall_ext_north_1/2` sit below and above `window_master_1`), so the openings are real gaps in the walls.
- GLB pivots: doors and windows pivot at the hinge, so rotate about Y. Furniture origin is at base centre. Ceiling material: alpha BLEND, opacity 0.25 [V README].

## NOT in the repo (reference only)
| Path on Edmund's box | Size | Licence / provenance | Why not copied |
|---|---|---|---|
| `/workspace/hdb-3d/hdb_4_room_flat_tengah_woodlands.glb` (the **Sketchfab backup**) | **28 MB** | **CC-BY-4.0**, "HDB 4 Room Flat (Tengah/ Woodlands)" by **Farid** (https://sketchfab.com/farid1), source https://sketchfab.com/3d-models/hdb-4-room-flat-tengah-woodlands-a85c150742614a53bbcef8e5fb51d7be [V from the GLB's `asset.extras`; the Sketchfab page itself was not opened today] | Over the ~20 MB limit. The licence would allow redistribution **with attribution**. If it's ever used on screen or in slides, credit: *"HDB 4 Room Flat (Tengah/ Woodlands)" by Farid, CC BY 4.0, via Sketchfab.* It is visual only; the sim still uses the boxes JSON. |
| `/workspace/hdb-3d/keathong4rm.glb` (1.6 MB), `std4rm.glb` (384 KB), `4room.binz` (168 KB) | n/a | **Unknown**: gltfpack output with no author or licence metadata [V: no extras] | Licence unknown, so excluded. Don't use them in the pitch until the source is known. |
| `/workspace/hdb-3d/hdb_4room_sim.zip` | 180 KB | same as the files copied above | duplicate |

## Third-party code (to be added by the build)
- three.js (MIT) [U: licence well known, not re-checked today], from npm, pinned.
- No code from WebLBM, the MIT GPU-LBM demo or Hypercube-gpu is to be copied unless its licence has been checked and recorded here.

</details>
