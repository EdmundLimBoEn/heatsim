# 00 · Overview

## Event facts
| Item | Value | Tag |
|---|---|---|
| Event | 2026 SST-3M InnoScience Challenge (Sec 2), Wed 14 to Fri 16 Oct 2026 | [V] site + school programme sheet |
| Theme | "Action for the Urban Space: Innovating a Sustainable Future" (UN SDG 13 Climate Action) | [V] |
| Sub-theme we picked | **Urban Heat Mitigation** | [D] |
| Team | S2-05 group 5A, 4 members (Jaron Chia, Edmund Lim, Paul Narag, Wayne Tay) | [V] pitch-grouping sheet |
| Build | **Thu 15 Oct 2026. Code and hardware freeze at 16:00 SGT** | [D] |
| Pitch | Fri 16 Oct 2026, about 10 min per group (8:00–12:30 block; our slot time is unconfirmed) | [V] date / [U] exact slot |
| Prototype | Can be physical or digital; ours is both (cardboard model plus browser sim) | [V] brief |

## Problem
Singapore homes deal with **urban heat** (heat island, hot afternoons, west-facing flats) and with periodic **transboundary haze**. On hazy days households close the windows, the flat heats up, and they turn to AC, which costs money and energy (SDG 13 link). People rarely know:
- whether opening a window or a door helps or hurts,
- where to put a fan, AC or air purifier so it actually reaches the rooms they use,
- which room becomes a hot or hazy "dead zone".

Data point for the pitch: on 14 Oct 2026 at 9 PM SGT, NEA 1-h PM2.5 read west **203 µg/m³** (north 72, south 88, east 97, central 125) via data.gov.sg [V, from heat-haze-plan.md]. Quote it with that date. **The app does not fetch live NEA data or read any sensor.** Haze levels come from scenario presets [D].

## Users
- **Primary:** HDB households, especially older residents who manage heat and haze themselves.
- **Secondary:** Town councils and HDB (guidance on ventilation, fan and purifier placement), plus students learning how airflow works.
- **Demo audience:** teachers and 3M judges. They need to *see* cause and effect within seconds.

## Persona: Mdm Tan
> **Mdm Tan, 68**, lives in a west-facing **4-room HDB flat** in Jurong West. On haze days she shuts every window and the flat gets hot. She runs one fan and can't afford the AC all day. She has a purifier in the living room but doesn't know whether it helps her bedroom.

Empathy map: *Says* "Close the window or open it?" · *Thinks* "AC is expensive" · *Does* moves the fan from room to room · *Feels* stuffy and worried about her lungs.

(The persona is illustrative, not a real person.)

## How Might We
> **How might we help HDB households decide where to place fans, ACs and air purifiers, and when to open windows and doors, so that homes stay cooler and cleaner during heat and haze while using less energy?**

## What we're building (one paragraph)
**HeatSim** is a browser app (Chrome, M4 Pro MacBook) that runs a coarse **3D lattice Boltzmann airflow sim** of a 4-room HDB flat, with **buoyant heat** and a **PM2.5 haze scalar**, and draws it in 3D with three.js (coloured slice planes plus drifting particles). A **cardboard model** of the flat has buttons and SG90 servo-driven window/door flaps and a fan. Pressing a button on the model opens the matching window in the sim, and the airflow changes within seconds. The sim can also move the servos. An **Optimise** button runs a greedy search in a Web Worker to suggest where a fan, AC or purifier works best, and shows "your layout vs suggested layout". Scenario presets ("hot afternoon", "haze outside", ...) set the outdoor conditions. A few **SimScale** (or OpenFOAM) runs give realistic reference images for the slides.

## Non-goals (today)
- No sensors (no PSI, PM2.5, temperature or humidity hardware) and no live NEA API calls. [D]
- No claims of quantitative accuracy. No energy-bill numbers beyond clearly labelled illustrative estimates.
- No mobile or Safari support. Only Chrome on the Mac matters.
- No accounts, backend or deployment. It runs on `localhost`.

## Rubric (brief §F, verbatim levels in /workspace/innoscience/audit.md) [V]
Each criterion is scored Beginning / Developing / Competent / Accomplished (the tracker uses 1–4; no weights are stated).
| Criterion | What earns marks for us |
|---|---|
| **Innovation** | A physical model that *drives* a live 3D airflow sim, plus an optimiser that gives household-level advice. Most teams will show static posters or 2D apps. |
| **Design of Prototype** | Reliable live demo: press a button, the window opens, the flow changes, Optimise gives a better layout with a measurable % improvement. The fallbacks must work too. |
| **Quality of Pitch** | Mdm Tan story, the NEA haze number, a live demo, SimScale validation images, honest limits ("toy CFD"), and the SDG 13 energy angle. |

Prize categories also include Best MVP, Best Pitching and Most Promising Design [V brief]. A robust live demo is our best lever.
