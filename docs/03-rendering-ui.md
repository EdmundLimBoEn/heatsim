# 03 · Rendering and UI

## Implemented presentation

**The main apartment remains a 2D toy-CFD presentation inside a 3D scene. Cooling Lab is a separate two-layer/surface experiment. The original GLB/3D-LBM plan was not implemented; optional WebGPU runs only planar heat/haze transport.** See [standalone demo instructions](../README.md), [the presentation walkthrough](presentation-demo.md), [solver limits](02-simulation.md) and [current QA status](../CHECKLIST.md).

`src/scene.ts` constructs the apartment in **three.js WebGL from the shared JSON boxes**, with refined materials, furniture, sliding window sashes, door pivots and portable-device markers. The original GLB is retained as an asset/reference; the live scene does not need to load it. Room labels, cutaway and dimension annotations are visual only. The initial view is roofless; the physical model also has no roof.

The toolbar offers a plain model view plus temperature, airflow, air-quality and qualitative pressure fields. The field is a masked **2D texture at y = 1.2 m**, not a 3D texture or volumetric solver. Fixed legend ranges are temperature **24–40 °C**, PM2.5 **0–250 µg/m³**, airflow **0–1.5 m/s**, and normalized pressure **−1 to +1**. Pressure is not in Pa and is not a measured or calibrated prediction. Pressure is normalized separately for each arrangement: compare colors within the current layout, not as absolute pressure differences between layouts. Flow-direction arrows supplement the planar velocity view. Pressure labels, colors and directional arrows were observed in the native Zen WebGL browser; the checklist records that separately from headless checks.

The field renderer uses **900 display tracers** in airflow/air-quality modes. They respawn if they leave valid fluid cells; they illustrate direction and local scalar color. Do not infer physical travel time from their screen animation. Isometric and top-down camera buttons, zoom/orbit, screenshots, room readings, CSV export and printable build-pack links support the presentation.

### Controls that work without a board

- Six scenario buttons and **Q W E R T Y**. Scenario changes reset fields and keep devices/openings; validation selected from the UI/keyboard additionally opens internal doors for its prescribed route. Hardware scenario messages preserve the reported physical door states.
- **1 / 2 / 3**: bedroom 3 north / living south / living east windows. **Shift+1 / Shift+2**: main door / bedroom 3 internal door. Other mapped openings are available on screen; unmapped number keys do nothing.
- **F / A / P**: portable fan / selected AC / purifier. **[ / ]** adjusts fan angle, **, / .** fan slot, **− / =** fan speed, and **Shift+P** purifier slot.
- **O / Enter**: compare layouts / apply the reviewed suggestion when focus is outside a button or form control. For the demo, explicitly click **Apply layout**; Enter on the still-focused Compare button starts another comparison. **Space / Backspace**: pause/resume / reset fields. **H** opens help; **C** opens optional USB connection.
- **Tab keeps normal keyboard focus navigation.** The original Tab-to-cycle-fields, slice-height shortcuts and inside-room camera presets are not implemented.

The original Flat view supports dragging the **portable fan and purifier** to the nearest existing valid slot: **five fan / six purifier positions**. Markers preview the destination while camera orbit is suspended. Escape, a cancelled pointer or an invalid outside/wall drop retains the prior position. This does not create continuous free placement, and fixed ceiling devices/AC cannot be dragged. Device position selectors and the existing fan-slot/purifier-slot keyboard controls remain alternatives. Dragging is disabled in the Cooling Lab preview and Contractor Study uses its separate room-assignment controls.

Playback starts at **30×**, with 1× and 60× alternatives. Keyboard controls do not fire while typing into form fields or operating a dialog. Every hardware control used in the default demo has an on-screen/keyboard equivalent. The main workflow works with no SSTuino attached.

In the main apartment, the master-bath window is above the field slice and therefore changes only visually. There is no vertical slice or resolved 3D buoyant plume. The engine badge distinguishes **CPU · 2D** from **WebGPU heat + haze · CPU airflow · 2D**. Physical USB, switches and servo movement remain pending hardware; an on-screen animation must not be presented as a confirmed servo action.

### Outdoor conditions

**Environment → Outside the home** provides synchronized sliders and numeric inputs for temperature **10–60°C**, wind **0–10 m/s** and PM2.5 **0–1000 µg/m³**. **Wind from** offers Scenario direction, North → south, East → west, South → north and West → east. The direction names where wind comes from, not where it goes. Weather edits retain live fields and devices/openings; selecting another scenario resets the fields and its weather overrides. **Reset outdoor conditions to scenario** restores weather without resetting fields.

The **US EPA PM2.5 index equivalent (24-hour scale)** field accepts integers **0–500** and selects a representative PM2.5 concentration. The solver still uses µg/m³. Beyond the supported equivalent range, the index is unavailable while the raw concentration remains intact. The UI labels it a scenario equivalent, not Singapore PSI, live AQI or a health forecast; no time average or live feed is inferred. Invalid index input is rejected. These controls use normal form focus and suppress global shortcuts while editing.

## Cooling Lab workspace

The **Flat simulation / Cooling Lab** workspace buttons switch views; the apartment clock pauses in the lab. The same 3D panel becomes a **position preview**, with planar overlays hidden; lab values stay in its chart and schematic. Returning to the flat restores its field selection and paused/resumed state.

Cooling Lab opens a separate experiment using a **copy of the flat's controls**, not its current temperature/particle field. **Refresh from the flat** recaptures candidate controls; it does not replace a saved baseline. A stale-capture notice identifies later changes to the apartment; those changes are not silently imported. Changing the lab's scenario/openings does not edit the apartment setup; both trials restart from the scenario's initial air and surface temperatures.

The settings include **Room**, **Exterior fan opening**, **Fan direction** (high-level exhaust/supply), **Rated fan flow** (20–600 m³/h), and **Simulated duration** (10/20/30 minutes, default 20). Shared outdoor controls select a scenario, temperature, PM2.5, wind speed and wind-from direction; scenario changes clear manual weather overrides. The lab displays the same PM2.5 index-equivalent convention as the main view.

**Optional shared corridor boundary → Separate conditions at the main door** enables prescribed corridor temperature and PM2.5. This fixed sheltered reservoir applies only to the exterior main entrance into dining, not the internal corridor rooms. It does not warm or become polluted in response to the home, and windows still use outdoor conditions. Disabling it returns the main door to the outdoor boundary.

**Opening arrangement** offers captured openings, **Open windows + internal doors**, **Close all other openings**, or **Custom openings below**. Individual window/door controls, portable-purifier power/position and fixed-purifier controls allow explicit treatments. The open preset leaves the exterior main door closed. The selected fan opening contains a passively open adapter even when its ordinary window flag is closed; it cannot be sealed by that checkbox. Other openings provide make-up/relief routes.

The **Experiment** selector distinguishes two workflows:

- **Quick fan off / on:** only the vent motor changes. Openings, purification, fan location/mode/rating and envelope settings stay equal.
- **Captured baseline / candidate:** choose the baseline's interventions, click **Capture baseline**, change the candidate, then click **Compare baseline / candidate**. The saved openings, devices, fan and envelope are compared under the **current shared weather, corridor conditions, scenario initial state and duration**. Changing shared weather updates both arms; it does not compare new weather against old captured weather. The capture button can replace the baseline explicitly.

**Envelope conductance**, **Solar absorptance** and **External shading** describe the full-size flat. Configuration mode can compare their changes in one matched pair. They do not change cardboard thickness or the cutting plan. Both modes run in a cancellable worker and clear old results when experiment settings change; they do not apply changes to the main apartment.

Results label the two arms according to the mode. All differences are **candidate minus baseline**, or **fan ON minus OFF** in quick mode. Summary cards show whole-flat all-air temperature, whole-flat PM2.5, integrated model PM exposure and total electricity differences. The chart traces the selected room's **occupied/lower layer**, while the schematic shows its final candidate lower/upper/surface states. Keep those scopes separate. The schematic is not a computed 3D plume or pressure field.

**Compared inputs** lists changed interventions and shared conditions. The exchange table reports both cases' actual versus rated flow, boundary air changes, vent-fan power/electricity, total electricity and sensible heat removal. Boundary air changes count incoming outdoor/corridor air once; they are not purifier clean-air delivery. Positive heat removed exports sensible heat; negative values import it. Cumulative ventilation heat is displayed in **Wh of heat** while CSV stores it in **J**; it is separate from **Wh of electricity**, not a cooling-efficiency rating.

Final heat-budget rates are **W**, positive inward and negative outward. Envelope rates follow the exterior-face balance, not gross incident radiation. Surface-to-air convection redistributes heat internally and is not counted again in the external/source budget. Stored-energy difference in **kJ** is distinct from integrated ventilation heat. **Export comparison CSV** records both actual configurations, shared initial/environment conditions, changed settings, traces, final rooms, units and signs.

**Can pressure expansion make a room colder?** is an independent educational calculator. Its hypothetical pressure drop and overall fan efficiency change only that calculation. The assumptions are dry air at **303 K**, **101325 Pa absolute** and **180 m³/h**. The static-temperature drop is not applied to either simulation; its pascals have no conversion from the apartment's relative pressure colors.

## Contractor Study workspace

**Contractor Study** has three independent plan cards **A/B/C**. The original apartment clock pauses while this workspace is active; its keyboard shortcuts do not change the hidden flat. **Load 3 example plans** uses the bundled 80/72/84 m² layouts; each **Import plan …** control accepts supported JSON up to **500,000 bytes**. Geometry consistency checks run before replacing a plan. The preview shows its own rooms, dimensions, openings and north orientation, not the canonical HDB scene. Examples are illustrative, not surveyed properties. **Download JSON schema** and **Download this plan JSON** support manual input preparation.

The shared brief includes project/location, optional coordinates, manually entered weather, provenance, initial indoor temperature/PM2.5, people per plan and duration. Coordinates locate an external weather reference; they do not auto-import conditions. Wind directions are geographic FROM directions, with each plan's `northDegrees` controlling orientation. The [study guide](contractor-study.md) explains the official reference-map and provenance scope.

**Openings, equipment & room placement** changes each plan's option. Appliance markers snap to a destination room; the room selectors provide the same assignment without dragging. Within-room pointer coordinates are visual only and are not stored as model placement. Permanent passages remain open. **Compare three plans** requires three valid inputs and runs all three under the same brief. Changes clear stale results; cancellation stops the worker without deleting the brief/plans. Results separate metric-specific advantages, areas, equipment counts and room readings; their flow arrows are signed lower/upper opening flows from the reduced-order network (solid lower, dashed upper), not resolved CFD streamlines.

**Download handoff report** produces an HTML report for local viewing/printing; **Study JSON** preserves the captured data. This is distinct from Cooling Lab's two-arm CSV and the main apartment's optimiser Apply workflow. The study does not apply a winning geometry to the HDB scene or generate a new cardboard pack. There is no saved cloud account or billing feature.

Written by gpt-6-astra in Codex on behalf of Edmund
