# Compare floor plans: homeowner option comparisons

This **noncommercial hackathon demo** helps a homeowner compare three floor plans or configurations under shared assumptions before renovating or moving. The workspace is labelled **Compare floor plans**; its internal modules retain the Contractor Study name. Its intended place is between an informal placement idea and a site-specific professional assessment: a repeatable way to inspect options and record what still needs measurement or specialist design.

This is an **uncalibrated reduced-order thermal/ventilation model**, not professional CFD, a compliance assessment, an equipment-sizing certificate or a guarantee of comfort, safe air or energy savings. The useful output is a transparent comparison under stated assumptions. A model-valid plan is not a professionally verified plan.

## Scope boundary

The user authorized imported plans for **this workspace only**. The original **My flat**, **Window fan test** (Cooling Lab), hardware mapping and two-A4-sheet cardboard pack continue to use the canonical HDB geometry. A new study must actually derive room volumes, opening connections and envelope areas from its validated input. It must not silently run the HDB flat while displaying a different plan.

Input is structured JSON in **metres**, with axis-aligned rectangular rooms and explicit openings. A person must measure or transcribe a plan and check its scale and connections. There is **no automatic PDF/image interpretation**, CAD recognition or reconstruction of an arbitrary scanned floor plan. The validator checks the supported geometric contract; it cannot establish that the dimensions match a building.

## Run a three-plan study

1. Start the app with `bun run dev`, then open **Compare floor plans**. Under **Weather source & details**, fill in the project/study name and a location label. Coordinates locate the weather reference; they do not fetch model inputs.
2. Click **Try the 3 example plans**, or import a supported JSON into each of **A**, **B** and **C**. Inspect the actual room preview, dimensions, geographic north and connection states. Use **Download JSON schema** when preparing an input, and **Download this plan JSON** to retain a configured option.
3. Set one shared outdoor temperature, PM2.5, reference wind speed/FROM direction, humidity and local hour. Record whether each set of input values is an illustrative assumption, copied forecast or manually entered observation, together with source/model, valid time/time zone and wind reference height. A forecast at 10 m is not a measurement at a window.
4. Set shared initial indoor air/surface temperature and PM2.5, total people per plan, and **10/20/30 minutes** (default 20). Review each plan's opening/equipment states. Device markers can be moved between rooms; use the room selector for the same change without dragging. All three plans need distinct plan IDs; to study configuration variants of the same geometry, copy its JSON with different plan IDs and change only the intended interventions.
5. Click **Compare three plans**. The worker uses each plan's own geometry/state and the same requested conditions/horizon. Editing inputs invalidates old results; **Cancel** keeps the inputs and stops the worker. This is a comparison of three supplied options, not an automated layout search.
6. Review per-metric advantages, room results, floor area and enabled equipment. Click **Download comparison** for the HTML report and **Save comparison JSON** for the captured data. Open the HTML report locally and use the browser's Print command to save a PDF if needed; the application does not read that PDF back as geometry.

The session stays in the browser. Download inputs/results before refreshing or closing it; no account or cloud project store is implemented. **Save comparison JSON** is an archival export; the current import controls accept individual plan JSON, not a whole saved study report.

### Read the comparison correctly

Weather, initial temperature/concentration, total occupancy and duration are matched; plan area, shape, orientation, openings and declared devices can differ. The report identifies those differences. It compares final **all-air mean temperature**, final **mean PM2.5**, and **total electricity** separately, rather than manufacturing a single overall winner. Per-room and upper/lower readings, PM concentration integral, boundary exchange and **Wh/m²** provide context.

The metric tie tolerances are **0.1°C**, **1 µg/m³ PM2.5**, and the larger of **0.1 Wh or 1% of the lowest electricity**. The shortlist retains options that another tested option does not match or improve on every ranking metric while meaningfully improving at least one. This is a shortlist of the three tested configurations under **one weather case**, not an exhaustive optimum or a ranking-stability result. Try a second explicitly recorded weather case separately to examine sensitivity; the app does not claim a robust ranking across weather.

## Prepare a floor-plan JSON file

Use the supported contract in `src/contractor-plan.ts`. Start from one of the three bundled examples and replace the dimensions and connections with your own measured inputs:

| Example | JSON file | What to inspect |
|---|---|---|
| Cross-ventilation apartment · 80 m² | [cross-ventilation.json](../public/study-examples/cross-ventilation.json) | Connected rooms and openings on opposing exterior sides. |
| One-sided apartment · 72 m² | [one-sided.json](../public/study-examples/one-sided.json) | The limits of a layout with exterior openings concentrated on one side. |
| Open-plan apartment · 84 m² | [open-plan.json](../public/study-examples/open-plan.json) | A different room/volume arrangement, rather than a relabeled HDB model. |

These are illustrative inputs, not surveyed construction drawings. Importing a real plan means supplying its checked dimensions in this format; an image or PDF alone is not supported.

1. Choose a local origin. **`x` increases right/east and `z` down/south** on the plan. All lengths are metres, including opening dimensions. Describe each room by its northwest corner `x,z`, `widthM` along x, and `depthM` along z.
2. Rooms are nonoverlapping axis-aligned rectangles with a common `heightM`. Shared walls must align exactly. Represent an irregular room as rectangles only if that is an intentional model simplification, with explicit connecting passages; the app does not infer a connection because rectangles touch.
3. Add each door, window or passage **once**. `roomA` owns the selected wall; `roomB` names the room on its other side, or is JSON **`null`** for outdoors. `side` is `N/E/S/W` relative to `roomA` in plan coordinates.
4. Measure `offsetM` from the **west end on N/S walls**, or the **north end on E/W walls**, to the opening's near edge. `widthM` runs along that wall. `sillM` is the height above the floor; `heightM` is the aperture height. The full opening must fit its wall and ceiling.
5. Set `northDegrees` to the clockwise bearing of the plan's local north (`−z`) from geographic north. **0** means plan north is geographic north; **90** means the plan's north-facing edge faces geographic east. Wind directions are geographic FROM directions, so check this orientation before comparing.
6. Add optional room devices (`fan`, `purifier`, `ac`) to the required `devices` array, or use an empty array. Save valid UTF-8 JSON with unique IDs and no comments/trailing commas. Review the preview and opening connections before running a study.

A complete small input demonstrates the fields:

```json
{
  "version": 1,
  "id": "two_room_example",
  "name": "Two-room input example",
  "heightM": 2.6,
  "northDegrees": 0,
  "rooms": [
    { "id": "living", "label": "Living", "x": 0, "z": 0, "widthM": 4, "depthM": 3 },
    { "id": "bedroom", "label": "Bedroom", "x": 4, "z": 0, "widthM": 3, "depthM": 3 }
  ],
  "openings": [
    { "id": "west_window", "kind": "window", "roomA": "living", "roomB": null, "side": "W", "offsetM": 0.8, "widthM": 1.4, "sillM": 0.9, "heightM": 1.2, "open": true },
    { "id": "connecting_door", "kind": "door", "roomA": "living", "roomB": "bedroom", "side": "E", "offsetM": 1, "widthM": 0.8, "sillM": 0, "heightM": 2, "open": true },
    { "id": "east_window", "kind": "window", "roomA": "bedroom", "roomB": null, "side": "E", "offsetM": 0.8, "widthM": 1.4, "sillM": 0.9, "heightM": 1.2, "open": true }
  ],
  "devices": [
    { "id": "bedroom_purifier", "kind": "purifier", "roomId": "bedroom", "on": false }
  ]
}
```

### Accepted limits and useful errors

| Item | Supported contract |
|---|---|
| Input | Version **1**; the parser accepts up to **1 MiB**, while browser file import is capped at **500,000 bytes**. Plain JSON objects with known fields only. |
| Rooms | **1–24**; origins x/z **−100 to 100 m**, width/depth **0.5–50 m**, common height **1.5–10 m**. |
| Openings | **0–64**; width/height at least **0.01 m**, nonnegative sill/offset, entirely inside a valid wall/ceiling. `open` defaults to **true** for doors/windows; `passage` with `open: false` is rejected because passages are permanent. |
| Devices | **0–48**; known room and kind, `on` defaults to **false**. |
| IDs | Globally unique across plan, rooms, openings and devices; start with a letter, then at most 63 letters/digits/underscores/hyphens. Reserved object-property names are rejected. |
| Orientation | `northDegrees` is **0 ≤ angle < 360**, default **0**. |

An “opening must fit entirely on the shared wall” error means the neighbour, side, offset or width does not describe the same physical wall segment. An “outside opening faces occupied neighbour” error means `roomB: null` was used on a wall backed by another room. Overlapping rooms/apertures, duplicate IDs, unknown references/fields and nonfinite values are rejected rather than guessed. A valid file can still contain disconnected rooms or no useful ventilation route: those are design inputs to inspect, not something the app repairs silently.

## What the plan-aware model computes

`createThermalModel(plan)` creates a separate model instance from the validated plan. Room volumes, shared walls, exposed façade areas and opening connections come from that plan; the HDB room dimensions and portable-device slots are not substituted. Each room has two equal-height air layers and one surface-temperature state. Initial air/surface temperature and PM2.5 are shared numeric conditions across plans, but each plan has its own correctly sized state and heat capacity.

The imported-plan default has **no high-level ventilation-fan adapter**. Ordinary `fan` devices circulate/mix their room's air and add **50 W** each. Each `purifier` assumes **250 m³/h CADR** and **40 W**. Each `ac` has an illustrative **2500 W sensible cooling cap** and **COP 3.2**; no equipment model or moisture removal is specified. Multiple declared devices are additive. Device placement is by room, not an exact resolved jet position.

Appliance relocation changes its `roomId`; it does not add an installation coordinate or resolve within-room jets. The shared people count defaults to **4 per plan**, at **100 W per person**, distributed by room area. Equal total people means different occupancy density in different-sized plans. Compare floor area, equipment and total/per-area energy together; a smaller or differently equipped plan is not a controlled single-intervention experiment merely because weather matches.

Orientation rotates the local façades relative to geographic wind and scenario sunlight. The network uses illustrative pressure/exchange and envelope coefficients; it does not resolve neighbouring buildings, sheltering, turbulence, three-dimensional jets or a site-specific wind profile. Touching rooms connect only through declared openings, and `passage` connections remain open. Closed openings do not include hidden leakage.

Opening-flow arrows report signed **lower/upper-layer advective flow** (solid lower, dashed upper), positive from `roomA` towards `roomB` or outdoors. Gross opening flow is the sum of the absolute layer flows; opposite flows can cancel in the net. Background internal mixing is not included in those arrows. These are room-network results, not a continuous CFD field or a measured air path. Boundary air changes count incoming exterior air once; purifier CADR and internal recirculation are different quantities. Heat removed, stored heat and electricity retain the separate units/signs described in [the simulation guide](02-simulation.md).

## Weather reference and provenance

For this noncommercial hackathon demonstration, enter latitude/longitude, open **Optional Windy weather reference**, then click **Show Windy at these coordinates**. The official map can support a discussion of outdoor wind; **Open this location in Windy** is the external-link fallback. It is a **separate reference display**, not a simulation data feed. Enter the study's outdoor values manually and record where and when they were obtained. The map does not automatically set the model's temperature, wind, humidity or PM2.5, and forecast values do not establish airflow at a particular building façade.

The [official Windy embed generator](https://embed.windy.com/config/map) produces a key-free map iframe. This is different from a Point Forecast API integration. Preserve the map's attribution and links, and provide an external reference link if the embed is unavailable. No scraping, forecast extraction or automatic import is part of this study. The future commercial product pitch does not assert a commercial Windy license; an actual commercial integration would need its own review against [Windy's applicable terms](https://account.windy.com/agreements/windy-general-terms-of-use).

## Scope of the current launch

The current interface serves homeowners and stays local, without accounts or payment. The earlier B2B pitch remains only a future hypothesis. That hypothesis is a repeatable pre-design workflow for contractors: save the plan and assumptions, compare options under the same conditions, and give the client a reviewable report. Its value would be clearer discussions about openings, air-cleaning devices, ventilation and envelope choices, with a record of what changed and what was held constant.

Per-contractor or team licensing is a **future pitch hypothesis**, not a commercial launch, a feature already built or evidence of willingness to pay. This local MVP has no accounts, billing, subscriptions, shared cloud projects or entitlement enforcement. A pilot should test whether contractors can prepare valid inputs and whether the comparison/report improves a real client conversation before committing to a commercial product.

The report should accompany, not replace, checks of actual site conditions and any required professional design. Model outputs do not establish statutory compliance, equipment performance, measured pollutant exposure or an energy-bill saving.

Written by gpt-6-astra in Codex on behalf of Edmund
