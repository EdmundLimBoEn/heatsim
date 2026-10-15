# 03 · Rendering and UI

## Implemented presentation

**This document describes the working 2D MVP. The original GLB/WebGPU presentation plan was not implemented.** See [standalone demo instructions](../README.md), [the presentation walkthrough](presentation-demo.md), [solver limits](02-simulation.md) and [current QA status](../CHECKLIST.md).

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

The master-bath window is above the field slice and therefore changes only visually. There is no vertical slice, 3D buoyant plume or WebGPU backend. Physical USB, switches and servo movement remain pending hardware; an on-screen animation must not be presented as a confirmed servo action.

Written by gpt-6-astra in Codex on behalf of Edmund
