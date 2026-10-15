# HDB 4-room flat – sim-ready low-poly model

**Approximate layout, loosely based on a common Singapore HDB 4-room plan. It is not an official HDB plan.** Everything here is generated procedurally by `build.py` (trimesh) and is original work, with no downloaded assets.

## Files
- `hdb_4room.glb`: glTF binary, 129 named nodes, PBR colour materials
- `hdb_4room_boxes.json`: axis-aligned boxes for a voxel grid, plus `rooms` and `bounds`
- `preview.png`: top view with room labels
- `viewer.html`: standalone three.js viewer (three@0.169.0 from unpkg)
- `viewer_preview.png`: headless Chrome render, ceiling at 0.2 opacity, DEMO slice at 1.2 m
- `build.py`: rebuild with `.venv/bin/python build.py`

## Coordinates and units
- Units are **metres**. **+Y is up** (glTF/three.js default). The floor top is at y=0 and the ceiling at y=2.6.
- Plan is 12 m (x, east) × 7.5 m (z, south) = **90.0 m²** of internal room area. Exterior walls are 0.2 m thick and internal walls 0.1 m. Overall bounds are [-0.1,-0.05,-0.1] to [12.1,2.65,7.6].
- Rooms (m²): living 14.88, dining 8.68, kitchen 6.16, service_yard 5.32, master_bedroom 12.92, master_bath 3.6, common_bath 2.52, bedroom2 10.88, bedroom3 10.88, household_shelter 2.56, corridor 9.2 + corridor_lobby 2.4.

## Naming
- Floors: `floor_<room>`. Ceiling: `ceiling`. Walls: `wall_<id>_<n>`. These are solid pieces with the door and window openings left as gaps.
- Doors (pivot at the hinge, bottom of the frame; rotate about Y): `main_door`, `door_master_bedroom`, `door_master_bath`, `door_common_bath`, `door_bedroom2`, `door_bedroom3`, `door_kitchen`, `door_service_yard`, `door_shelter`
- Windows (pivot at the frame side edge, at sill height; rotate about Y): `window_master_1/2`, `window_master_bath`, `window_bedroom2_1`, `window_bedroom3_1/2`, `window_kitchen`, `window_service_yard`, `window_living_1/2/3`
- Furniture (origin at base centre): `sofa`, `coffee_table`, `tv_console`, `dining_table`, `dining_chair_1..4`, `bed_master_queen`, `bed_bedroom2_single`, `bed_bedroom3_single`, `wardrobe_master/bedroom2/bedroom3`, `study_desk_bedroom2/3`, `kitchen_counter_1/2`, `fridge`, `washing_machine`
- Devices: `fan_living`, `fan_dining`, `fan_master`, `fan_bedroom2`, `fan_bedroom3`. Fan origin is at the blade centre, 2.2 m up. `ac_living`, `ac_master`, `ac_bedroom2`, `ac_bedroom3` are wall units with their base at 2.15 m. Also `ac_condenser_yard`, `purifier_living`, `purifier_master`.

## JSON
`boxes[]` entries are `{name, type: wall|floor|ceiling|door|window|furniture|device|room, min, max}`. Each door and window box also has `openable: true`, `hinge_point`, `hinge_axis: "y"`, `wall_axis`, `wall`, `exterior`, `boundary_closed: "wall"` and `boundary_when_open` (`opening_to_outside` for exterior openings, `internal_opening` otherwise). The `ceiling` box is typed `ceiling` with `boundary: "wall"`, `thermal: "adiabatic"`.

Every box has `sim_solid` (true for walls, floor, ceiling, closed doors and windows, furniture, devices; false for `room` air volumes) and `boundary` (`wall` or `fluid`). The top-level `sim_metadata` states the decoupling rule.

## Decoupling guarantee
The simulation reads **only `hdb_4room_boxes.json`**. Ceiling or wall opacity, x-ray, cutaway clipping and visibility in the GLB or viewer have **no effect** on the physics. The ceiling stays a solid no-slip adiabatic wall in the sim even when it is fully transparent on screen.

## GLB structure
- Every mesh node has glTF `extras` (three.js `userData`): `{role, sim_solid}`. Doors and windows also have `state`/`exterior`, and exterior walls have `exterior: true`.
- `ceiling` uses its own `ceiling_material`: alphaMode BLEND, opacity 0.25, doubleSided. It sits under the parent node `ceiling_group`.
- Exterior walls use `exterior_wall_material` (opaque) and sit under `exterior_walls_group`.

## Viewer
Run `python -m http.server` in this folder, then open `http://localhost:8000/viewer.html`. It needs internet access for the CDN.
Controls: ceiling opacity slider, X-ray walls, cutaway (horizontal clipping plane, adjustable height), open/close all doors and all windows, and a field slice (adjustable height).
**The slice shows DEMO DATA**, a placeholder analytic field. The comment block in `viewer.html` explains how to feed a real `Data3DTexture` from the WebGPU sim.
The ceiling is drawn with `depthWrite=false` and `renderOrder=1`, and the slice with `renderOrder=2`, so the field stays visible through the roof.
URL params preset the UI, e.g. `viewer.html?ceil=0.2&xray=1&cut=1&cutH=1.0&doors=1&wins=1&slice=1&sliceH=1.2`.
Door and window swing signs are fixed (doors -90°, windows -0.6 rad), so some leaves may swing the "wrong" way through a wall.

## three.js
```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
new GLTFLoader().load('hdb_4room.glb', (gltf) => {
  scene.add(gltf.scene);
  const door = gltf.scene.getObjectByName('door_bedroom2');
  door.rotation.y = -Math.PI / 2;          // open 90° (sign picks the swing direction)
  gltf.scene.getObjectByName('window_living_1').rotation.y = 0.6;
  const p = gltf.scene.getObjectByName('purifier_living');
  p.position.set(10.5, 0, 6.8);            // move: y=0 keeps it on the floor
});
```
