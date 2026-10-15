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

Playback starts at **30×**, with 1× and 60× alternatives. Keyboard controls do not fire while typing into form fields or operating a dialog. Every hardware control used in the default demo has an on-screen/keyboard equivalent. The main workflow works with no SSTuino attached.

In the main apartment, the master-bath window is above the field slice and therefore changes only visually. There is no vertical slice or resolved 3D buoyant plume. The engine badge distinguishes **CPU · 2D** from **WebGPU heat + haze · CPU airflow · 2D**. Physical USB, switches and servo movement remain pending hardware; an on-screen animation must not be presented as a confirmed servo action.

## Cooling Lab workspace

The **Flat simulation / Cooling Lab** workspace buttons switch views; the apartment clock pauses in the lab. The same 3D panel becomes a **position preview**, with planar overlays hidden; lab values stay in its chart and schematic. Returning to the flat restores its field selection and paused/resumed state.

Cooling Lab opens a separate experiment using a **copy of the flat's controls**, not its current temperature/particle field. **Refresh from the flat** recaptures controls. A stale-capture notice identifies later changes to the apartment; those changes are not silently imported. Changing the lab's scenario/openings does not edit the apartment setup; both trials restart from the scenario's initial air and surface temperatures.

The settings are **Room**, **Exterior fan opening**, **Fan direction** (high-level exhaust/supply), **Rated fan flow**, and **Simulated duration** (10/20/30 minutes, default 20). Weather choices are the six scenarios or the captured setup. **Openings for both trials** offers captured openings, **Open windows + internal doors**, or **Close all other openings**. The open route keeps the exterior main door closed. The selected window always contains the same fan adapter, regardless of its ordinary window state.

**Envelope conductance**, **Solar absorptance** and **External shading** describe illustrative full-size-flat properties. They are identical in each fan-off/on pair. Changing an envelope value invalidates the old pair; comparing shading itself requires two otherwise identical completed experiments. Nothing changes the locked cardboard thickness or cutting plan.

**Compare fan off / on** starts a worker with progress and a **Cancel** control. A completed result shows selected-room occupied/upper-layer changes, whole-flat PM2.5 change and electrical-use change, all **ON minus OFF**. The temperature chart traces the selected room's **lower layer**, while the schematic shows its final fan-on lower/upper/surface states. The schematic is not a computed 3D plume or pressure field.

The results distinguish rated flow from **actual** flow in each arm, including possible backflow, and show final whole-flat heat-budget rates in **W**. Positive heat-budget rates add heat; negative rates remove it. Envelope rates are net inward contributions after the massless exterior-face/envelope balance, not gross incident radiation. Surface-to-air convection redistributes heat internally and is not counted again in the net external/source budget. Stored-energy difference in **kJ** and electricity in **Wh** are different quantities. **Export comparison CSV** includes both traces, initial conditions, configuration, room results and the sign convention.

**Can pressure expansion make a room colder?** is an independent educational calculator. Its hypothetical pressure drop and overall fan efficiency change only that calculation. The assumptions are dry air at **303 K**, **101325 Pa absolute** and **180 m³/h**. The static-temperature drop is not applied to either simulation; its pascals have no conversion from the apartment's relative pressure colors.

Written by gpt-6-astra in Codex on behalf of Edmund
