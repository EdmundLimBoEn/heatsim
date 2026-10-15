# Outdoor air, haze and cooling: presentation walkthrough

Run `bun run dev` and open the localhost address. No SSTuino is needed. Describe the apartment as **planar toy CFD** and Cooling Lab as a **separate two-layer/surface teaching model**. Neither is calibrated.

## 1. Show the outdoor inputs

1. Open **Flat simulation → Environment → Outside the home**. Enter **31°C**, **200 µg/m³ PM2.5** and **2 m/s** wind, then choose **Wind from South**. This means air arriving from the south towards the north.
2. Show **US EPA PM2.5 index equivalent (24-hour scale)**. Say: “This is a scenario equivalent, not Singapore PSI, live AQI or a health forecast.” Raw PM2.5 remains the model input; no API is used.
3. **Reset outdoor conditions to scenario** restores weather while keeping controls/readings. Selecting another scenario also resets indoor fields.

## 2. Compare open windows with closed ordinary windows during haze

1. Refresh for a clean setup, leave AC and ordinary fans off, and open **Cooling Lab**. Choose **Captured baseline / candidate**, **Bedroom 3**, its **north window** fan adapter, and **20 minutes**.
2. Select **Haze outside**. Set shared outdoor conditions to **31°C**, **200 µg/m³**, **2 m/s from South**. Leave the optional corridor boundary **off**. Uncheck **Candidate vent fan powered**; keep its rating at **120 m³/h**. The adapter's passive opening remains present in both trials.
3. Select **Open windows + internal doors**. Enable **Portable purifier powered** at **Bedroom 3**; leave fixed purifiers off. Keep envelope conductance **1.5 W/m²K**, absorptance **0.6**, shading **0%**. Click **Capture baseline**.
4. Expand **Individual windows and doors**. Close every ordinary exterior window that can be changed, leaving the selected fan-adapter opening and **all internal-door states unchanged**. Leave the main entrance closed. Keep the purifier on in the same room.
5. Click **Compare baseline / candidate**. Check **Compared inputs**: only ordinary window states should differ. Confirm shared weather, initial state and 20-minute duration. Read whole-flat PM2.5, PM exposure, air changes and electricity; export CSV.

Explain: “The purifier removes particles in both trials. Openings change the incoming haze. Closing ordinary windows does not establish safe air: leakage and many real-building effects are omitted, and the fan adapter remains passively open.”

Differences are **candidate minus baseline**. Negative PM2.5/exposure means lower model concentration/integrated concentration, not a measured inhaled dose. Fewer air changes are not automatically better for every indoor-air need.

A fresh `two-layer-surface-v2` engine probe of this exact pair gave whole-flat final PM2.5 **146.48 → 34.21 µg/m³**, integrated concentration **35.41 → 12.11 µg·h/m³**, and **13.33 Wh electricity in each arm**. Ten ordinary windows differed. The candidate has only one passive exterior connection, so this steady network predicts approximately zero sustained boundary flow. It omits leakage and single-sided turbulent exchange; this is not real airtightness or a safe-air claim. Read the actual displayed result during rehearsal.

Optional purifier test: capture the current closed-window setup with purifier **off**, then turn it **on** and compare. Only purifier power should differ.

## 3. Test a high-level exhaust with cooler outdoor air

1. Choose **Quick fan off / on**, **Evening cool-down**, **Bedroom 3 → north window**, **High-level exhaust**, **300 m³/h**, and **20 minutes**. Turn purifiers off. Set **27°C**, **20 µg/m³**, and **1.2 m/s from North**; keep the corridor option off and the same envelope settings.
2. Choose **Open windows + internal doors** and click **Compare fan off / on**. Show the matching initial conditions, occupied-layer chart, final upper-layer temperature, actual fan flow and fan electricity.
3. Choose **Close all other openings** and rerun. Sustained flow can be blocked while motor heat remains. Each pair isolates fan power; the two pairs have different opening arrangements.
4. Explain: “Cooler replacement air can carry sensible heat away. The rating is not the actual flow. Positive heat removed means heat exported; negative means heat imported. The fan also uses electricity and adds heat.” The model assumes **14 W** for a 300 m³/h fan, so an on trial lasting 20 minutes uses **4.67 Wh** for that fan. This is an illustrative input, not a product specification.

The chart is **bedroom 3's occupied layer**; the headline temperature is the **whole-flat all-air mean**. Heat moved and electricity used are separate energies, not an AC efficiency rating.

## 4. Optional corridor, envelope and pressure questions

- **Different air outside the main door:** enable **Optional shared corridor boundary → Separate conditions at the main door**, set its temperature/PM2.5, and open **Main entrance door** under individual openings. It is a fixed sheltered reservoir only at that exterior door; it does not respond to the flat or replace internal corridor rooms. Windows still use outdoors. Current corridor values apply to both arms, including an older baseline.
- **Stop heat arriving first:** in configuration mode, choose a hot sunny scenario, capture a baseline at **0% shading**, change to **80%**, and compare. Only shading should differ. Conductance slows transfer in both directions; it is not certified wall performance or cardboard thickness.
- **Can pressure expansion cool the room?** Open the separate calculator at **30 Pa / 50%**. It gives about **0.0256°C** ideal static-temperature drop and **3 W** fan input under its stated assumptions. That drop is never subtracted from room temperatures. The apartment's relative pressure index cannot be converted to these pascals.
- **Where does air travel?** Return to the apartment, close exterior openings, select **Validation case**, then open the bedroom 3 north window and main door. Airflow shows the planar connected route; pressure is a relative index, not Pa. Lab results do not repaint that field.

## Keep the demonstration reviewable

**Cancel** stops the worker; edits clear old results. **Refresh from the flat** updates candidate controls, not warmed fields or the saved baseline. Inspect shared conditions and changed settings before presenting. [CHECKLIST.md](../CHECKLIST.md) records software evidence, not physical validation.

The physical model needs **two A4 sheets of 3 mm card, no roof**. Full-size-flat thermal properties do not describe the card. USB/servos remain unverified. [Cooling science](cooling-science.md) and [fan thermodynamics](fan-thermodynamics.md) explain the mechanisms.

Written by gpt-6-astra in Codex on behalf of Edmund
