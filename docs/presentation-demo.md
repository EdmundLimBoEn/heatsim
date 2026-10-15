# Three-minute cooling demonstration

The entire presentation works without an SSTuino. Describe HeatSim as an **illustrative teaching model**: the apartment view is planar toy CFD, and Cooling Lab is a separate two-layer/surface heat balance. Neither is calibrated against a real flat.

## Set up once

1. Run `bun run dev` and open the printed localhost address. Keep the terminal running. Refresh for a clean setup and leave the ordinary portable fan, purifier and AC **off**.
2. Open **Cooling Lab**. Select **Bedroom 3**, its **north window**, **High-level exhaust**, **300 m³/h**, and **20 minutes** (raise the default 120 m³/h rating for this example).
3. Choose **Evening cool-down** and **Open windows + internal doors**. Leave envelope conductance **1.5 W/m²K**, absorptance **0.6** and shading **0%**.
4. Keep the browser wide enough to show the chart and selected-room section. The worker runs simulated time in the background; the result states the completed duration.

## Present

| Time | Do | Explain |
|---|---|---|
| 0:00–0:25 | Point to the lower air, upper air and surface representation. | “A hot home stores heat in its surfaces as well as its air. Warm air can rise, while fans can mix or exhaust it. We simplify each room into two air layers and one surface temperature; these arrows are a diagram, not a measured plume.” |
| 0:25–1:15 | Click **Compare fan off / on**. Show the matching starting points, then the occupied-layer chart, actual fan flow and electricity. | “Both trials start identically. We change only this ventilation fan. Here the outside air is cooler, so exchange can export heat. The temperature change is on minus off; a negative value means cooler. This modest result depends on our model assumptions.” |
| 1:15–2:00 | Select **Close all other openings** and rerun. Point to **Actual flow, fan on** and the temperature change. | “The fan needs replacement air. With the other routes closed, sustained exchange is blocked. The motor still adds heat; spinning a fan is not refrigeration.” |
| 2:00–2:35 | Expand **Can pressure expansion make a room colder?** Keep **30 Pa** and **50%**. | “An ideal expansion gives about a 0.026°C static-temperature drop in this separate example. Fan work and mixing matter, so that is not room cooling. We never subtract this number from the home temperatures.” |
| 2:35–3:00 | Show the CSV export and the physical build pack. | “The results include the settings and both trials, so the comparison is reviewable. Our cardboard version uses two A4 sheets, all 3 mm, with no roof. It is a display and future controller, not thermal validation equipment.” |

## Values observed in the model

A direct engine probe on 15 October 2026 used the exact setup above, all other devices off, and **1200 simulated seconds**. These values help rehearsal; show the actual displayed result and do not present them as measured fan/building performance.

| Bedroom 3, exhaust rated 300 m³/h | Routes open | All other openings closed |
|---|---|---|
| Occupied air, off → on | about **31.22 → 30.49°C** | about **31.52 → 31.58°C** |
| Upper air, off → on | about **31.60 → 30.67°C** | about **31.84 → 32.02°C** |
| Actual fan-on exchange | about **289 m³/h** | approximately **0 m³/h** |
| Assumed fan input / extra electricity | **14 W / 4.67 Wh** | **14 W / 4.67 Wh** |

The chart change is specific to **bedroom 3's occupied layer**, not the whole-flat mean. Keep the scopes distinct. Software checks support the calculation's implementation, not its calibration. See [CHECKLIST.md](../CHECKLIST.md) for browser verification separately.

## Optional follow-up questions

- **What if outside is hot or hazy?** Restore **Open windows + internal doors**, select **Haze outside**, and rerun. In the direct probe, bedroom 3 PM2.5 rose from about **119 to 158 µg/m³** with the fan on and the whole-flat increase was about **8.8 µg/m³**. Read the actual displayed temperature and PM2.5; ventilation is not guaranteed to improve either. Humidity is shown but latent heat and dehumidification are not calculated.
- **Could we stop heat arriving first?** Select **Hot afternoon (west sun)**, run at **0% shading**, then rerun at **80%** with everything else unchanged. Compare the two experiments' solar-gain rows and matching fan-off results. Each individual pair still changes only fan on/off. Shading reduces solar input; it does not manufacture cold air.
- **What does insulation do?** Change **Envelope conductance** under identical conditions. It slows heat transfer in both directions. This connects an exterior-face balance to the interior surface, not a certified material U-value and not the cardboard thickness.
- **Where does air travel?** Return to the main apartment, close exterior openings, select **Validation case**, then open the bedroom 3 north window and main door. **Airflow** shows the connected planar route; **Pressure** shows a relative index, not Pa. The lab's thermal results do not repaint this field.

## Recovery and honesty

**Cancel** stops a comparison; changing lab controls clears old results. **Refresh from the flat** captures its current controls but still starts from scenario initial temperatures. Reloading the page is the simplest clean reset. Do not claim a professional-CFD comparison, real USB operation, servo movement, measured pressure or energy-bill saving. Use [cooling science](cooling-science.md) and [fan thermodynamics](fan-thermodynamics.md) for the mechanisms behind the demonstration.

Written by gpt-6-astra in Codex on behalf of Edmund
