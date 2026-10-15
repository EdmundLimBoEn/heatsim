# HeatSim

A live, interactive **toy CFD** of heat and haze moving through a 4-room HDB flat. It runs in Chrome, and a cardboard model with buttons and servos drives it. Built for the **SST-3M InnoScience Challenge 2026** (theme: Urban Heat Mitigation, SDG 13) by team S2-05 / 5A.

> Status: **spec only**. No app code has been written yet. Build day is Thu 15 Oct 2026 (code freeze 16:00 SGT), and we pitch on Fri 16 Oct.

## Cardboard build crew

Use the [builder handoff](docs/physical-model.md) and [download the complete build pack](public/build-pack/heatsim-build-pack.zip). The model uses **two A4 sheets of 3 mm cardboard total**, with no roof. Its footprint is **187.692 × 118.462 mm** and every wall is **40 mm tall**.

Print the [floor plan](public/build-pack/floor-plan.svg) and [all 13 walls on one A4 sheet](public/build-pack/all-walls-stock.svg) at **100% / Actual size**. Verify the printed 50 mm calibration bar before cutting. The remaining sheet is the base.

## Start here
- **Coding agents (Astra etc.): read [`AGENTS.md`](AGENTS.md) first**, then `docs/` in order.
- [`docs/00-overview.md`](docs/00-overview.md): problem, users, persona, HMW, rubric
- [`docs/01-architecture.md`](docs/01-architecture.md): modules and data flow
- [`docs/02-simulation.md`](docs/02-simulation.md): 3D lattice Boltzmann (D3Q19), Boussinesq heat, PM2.5 scalar
- [`docs/03-rendering-ui.md`](docs/03-rendering-ui.md): three.js view, slices, particles, controls
- [`docs/04-hardware-protocol.md`](docs/04-hardware-protocol.md): SSTuino II, serial protocol, Web Serial, Bun bridge
- [`docs/05-scenarios-optimiser.md`](docs/05-scenarios-optimiser.md): presets and greedy placement optimiser
- [`docs/06-validation-simscale-openfoam.md`](docs/06-validation-simscale-openfoam.md): reference runs for the slides
- [`docs/07-build-plan.md`](docs/07-build-plan.md): timeline, roles, MVP vs stretch, acceptance tests, fallbacks
- [`docs/08-assets.md`](docs/08-assets.md): geometry files and licences

## Honesty statement (use it in the pitch too)
The live sim is a **qualitative toy CFD**. The grid is coarse (~20 cm cells), viscosity is artificially high, and the inputs are scenario presets, not measurements. **There are no PSI or PM sensors.** It shows *trends* (where air goes, where heat and haze collect, what a fan, window or purifier changes). It does not give accurate temperatures or concentrations. The SimScale/OpenFOAM runs in `docs/06` are the more realistic reference.

## Tags used in the docs
- **[V]** = verified by a source or by inspecting the file
- **[U]** = unverified; check before relying on it
- **[D]** = a team decision (fixed for today; change only with the Coder's OK)
