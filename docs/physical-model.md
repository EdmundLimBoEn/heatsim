# HeatSim physical model — builder handoff

**Start here: 1:65 scale; 187.692 × 118.462 mm outside building footprint; 40 mm walls.**

The 12.2 × 7.7 m source apartment fits inside a 200 × 150 mm work area on an A4 210 × 297 mm cardboard base. This is an approximate teaching layout, not an official HDB plan. A4 is larger than 150 × 200 mm; both constraints are met without stretching the plan.

## Download / print first

- [Floor plan, A4 actual size](../public/build-pack/floor-plan.svg)
- [All 13 walls on one A4 of 3 mm card — no roof](../public/build-pack/all-walls-stock.svg)
- [Movable leaf templates](../public/build-pack/door-window-leaves.svg)
- [Complete printable build pack](../public/build-pack/index.html)
- [All wall dimensions CSV](../public/build-pack/cut-list.csv)
- [Door and window cutouts CSV](../public/build-pack/openings.csv)
- [Exact dimensions JSON](../public/build-pack/dimensions.json)

Print **100% / Actual size**, disable “Fit to page” and browser headers/footers, and measure the **50 mm calibration bar**. All measurements below are millimetres. Coordinates start at the outside northwest corner, x to the east and z to the south. Dimensions use the outer faces, with 3 mm cardboard for every wall kept inside those footprints. Actual material thickness must be measured before fitting.

## Wall cut list

Every panel is **40 mm tall**. Exact values are the fabrication geometry; the practical column rounds to 0.1 mm for marking. Dry-fit and trim. Horizontal panels run west to east; vertical panels run north to south. Cut doors and windows before assembly.

| ID | Wall | Exact length | Mark length | Thickness | Direction | Start → end | Centre line |
|---|---|---:|---:|---:|---|---:|---:|
| W01 | ext north | 187.6923 | 187.7 | 3 | x | 0.0000 → 187.6923 | 1.5000 |
| W02 | ext south | 187.6923 | 187.7 | 3 | x | 0.0000 → 187.6923 | 116.9615 |
| W03 | ext west | 112.4615 | 112.5 | 3 | z | 3.0000 → 115.4615 | 1.5000 |
| W04 | ext east | 112.4615 | 112.5 | 3 | z | 3.0000 → 115.4615 | 186.1923 |
| W05 | north corridor | 181.6923 | 181.7 | 3 | x | 3.0000 → 184.6923 | 53.8462 |
| W06 | master masterbath | 49.3462 | 49.3 | 3 | z | 3.0000 → 52.3462 | 60.0000 |
| W07 | bath bedroom2 | 49.3462 | 49.3 | 3 | z | 3.0000 → 52.3462 | 87.6923 |
| W08 | bedroom2 bedroom3 | 49.3462 | 49.3 | 3 | z | 3.0000 → 52.3462 | 136.9231 |
| W09 | masterbath commonbath | 24.6923 | 24.7 | 3 | x | 61.5000 → 86.1923 | 32.3077 |
| W10 | kitchen corridor | 60.1154 | 60.1 | 3 | z | 55.3462 → 115.4615 | 44.6154 |
| W11 | kitchen yard | 40.1154 | 40.1 | 3 | x | 3.0000 → 43.1154 | 87.6923 |
| W12 | shelter north | 24.6154 | 24.6 | 3 | x | 46.1154 → 70.7308 | 92.3077 |
| W13 | shelter east | 21.6538 | 21.7 | 3 | z | 93.8077 → 115.4615 | 69.2308 |

## Joints and materials

- W01/W02 north/south exterior panels pass across the full building width. W03/W04 east/west panels butt between them. Do not add their thickness a second time.
- W05 corridor runs between the exterior inner faces. W06–W08 north partitions butt between W01 and W05. W09 bath divider fits between W06 and W07.
- W10 kitchen/corridor partition butts from W05 to W02. W11 kitchen/yard divider fits between W03 and W10.
- W12 shelter north reaches the east outer face of W13; W13 butts under W12 and against W02. W12 starts at W10's east face.
- The thicker master/bath partition would overlap D02: its physical opening is shortened by 0.7308 mm at the east end to **11.5769 mm clear width** (source width 12.3077 mm). The printed cutout and leaf already include this change. Bedroom 2/3 and kitchen door-side junctions have only 0.0385 mm theoretical clearance; treat them as flush corners and reinforce with tape. Do not attempt tiny separate jamb strips.
- **No roof.** The model remains open for visibility and mechanism access, as requested.
- **Exactly 2 A4 cardboard sheets total, both 3 mm thick**: the existing base + **1 extra A4 sheet for all 13 walls**. The supplied six-row nesting uses 10 mm outer margins, 2 mm horizontal gaps and 5 mm between rows. The furthest cut is x=199.423 mm, y=275 mm. Reuse the door/window cutouts as leaves, trimmed for clearance; no second wall stock thickness or additional cardboard is required. Tape and hardware are separate. Printed template pages are paper, not extra cardboard sheets.

## Doors, windows and electronics

The model has **9 doors and 11 windows**. All openings and leaf clearances are in `openings.csv`. Offsets are from each panel's west/north cut end, not its centre. Sill is height above the floor. Cutout width/height are exact; reuse the 3 mm wall cutout scraps as leaves and trim 1.5 mm from door width (0.75 mm per side) and 0.5 mm from door height. Window lift-out inserts subtract 0.5 mm from both width and height. D09 (shelter) hinges on its east/right edge; other doors hinge on the west/left or north/start edge as listed in the schedule. Window inserts lift out using tape pull-tabs; sliding rails are optional and require clearance checks with the real servo. Use face-mounted tape hinges on the inside of the wall, so the 3 mm door leaves sit proud of the wall face when closed and swing inward. Check the actual thickness and travel before gluing. Clear scrap plastic may replace window leaves, but is optional.

The confirmed controller is **SSTuino**, with **servos, limit switches and buttons** for basic door/window interaction with the web app. Reserve **190 × 65 mm** on the unused A4 base for a removable control panel. This is a planning area, not a guarantee that unspecified components fit. Mounting holes, servo brackets, travel clearances, power and pin assignments remain pending actual parts and measurements. Do not cut hardware holes yet. Use **lift-out window inserts with tape tabs** for the fastest build, or slide panels along the inner wall face after checking real mechanism clearance. Do not swing windows outward: west/east leaves would exceed the 11.15 mm A4 side margin. The digital scene uses sliding sashes. Mount door tape hinges on the inner wall face, not the centre line of thick card. Keep all hardware and leaf motion inside the A4 sheet; servo bodies and linkages need measured clearance, especially at the narrow kitchen/bedroom corners. App fan, AC and purifier toggles are separate software controls; they do not require 11 additional physical switches.

## Fast assembly order

1. Print and verify the 50 mm bar, then glue the floor template to the A4 base without stretching it.
2. Measure stock thickness. Mark and cut wall rectangles, then the door and window holes. Label each panel W01–W13 on its underside.
3. Dry-fit the exterior rectangle; confirm 187.7 × 118.5 mm overall before gluing. Place all remaining walls over their printed footprints using the butt joints above.
4. Reinforce narrow door junctions with tape. Add tape-hinged door leaves and lift-out window inserts, checking full travel with furniture and walls in place.
5. Make the removable control panel after measuring the actual SSTuino, buttons and servo assemblies. Route cables away from hinge travel; keep the model roofless.
6. Add optional paper furniture and labels only after the model and controls work. Demonstrate each physical input against the matching web-app state.


## Primary hardware channel labels

| Channel | Opening | App object |
|---|---|---|
| WIN1 | G04 | `window_bedroom3_1` |
| DOOR1 | D01 | `main_door` |
| WIN2 | G06 | `window_living_1` |
| WIN3 | G11 | `window_living_3` |
| DOOR2 | D05 | `door_bedroom3` |

These five channel names match `docs/04-hardware-protocol.md`. Other openings can stay manual for the MVP; no pin numbers or actual servo counts are assumed.

## Supplementary schedules

`control-map.csv` maps all 20 openings to exact application object names, and lists 11 separate app device toggles. `devices.csv` gives scale device envelopes/positions, not real hardware clearances. `optional-furniture.csv` gives 20 simplified furniture blocks; omit them until the mechanisms work. `rooms.csv` gives source room rectangles before the physical wall-thickness adjustment, not clear finished room sizes.

Written by gpt-6-astra in Codex on behalf of Edmund
