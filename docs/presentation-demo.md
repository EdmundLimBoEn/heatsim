# Outdoor air, haze and cooling: presentation walkthrough

**Final prototype mapping (16 Oct): D5 now controls the Bedroom 3 main standing fan (fan preset 1), held = ON and released = OFF. D4 and switch polarity are unchanged. The already-uploaded sketch still sends `PUR:ON/OFF`; the app maps that legacy channel to the fan, and sends main-fan power requests back on `PUR`. The purifier is software-only. No reflash is required. On a D5 update, the main fan returns to its Bedroom 3 preset; other fans and purifier settings are preserved. References to D5 purifier control below describe the previous mapping.**

Run `bun run dev` and open the localhost address. No SSTuino is needed. The visible workspaces are **My flat**, **Window fan test** and **Compare floor plans**. Describe My flat as **planar toy CFD** and Window fan test (Cooling Lab) as a **separate two-layer/surface teaching model**. Neither is calibrated.

## 1. Show the outdoor inputs

1. Open **My flat → Weather → Set my own weather**. Enter **31°C**, **200 µg/m³ PM2.5** and **2 m/s** wind, then choose **Wind from South**. This means air arriving from the south towards the north.
2. Show **US EPA PM2.5 index equivalent (24-hour scale)**. Say: “This is a scenario equivalent, not Singapore PSI, live AQI or a health forecast.” Raw PM2.5 remains manual; the optional weather loader does not fetch haze.
3. **Reset outdoor conditions to scenario** restores weather while keeping controls/readings. Selecting another scenario also resets indoor fields.

## 2. Compare open windows with closed ordinary windows during haze

1. Refresh for a clean setup, leave AC and ordinary fans off, and open **Window fan test → Customize test**. Choose **Captured baseline / candidate**, **Bedroom 3**, its **north window** fan adapter, and **20 minutes**.
2. Select **Haze outside**. Set shared outdoor conditions to **31°C**, **200 µg/m³**, **2 m/s from South**. Leave the optional corridor boundary **off**. Uncheck **Candidate vent fan powered**; keep its rating at **120 m³/h**. The adapter's passive opening remains present in both trials.
3. Select **Open windows + internal doors**. Enable **Portable purifier powered** at **Bedroom 3**; leave fixed purifiers off. Keep envelope conductance **1.5 W/m²K**, absorptance **0.6**, shading **0%**. Click **Capture baseline**.
4. Expand **Individual windows and doors**. Close every ordinary exterior window that can be changed, leaving the selected fan-adapter opening and **all internal-door states unchanged**. Leave the main entrance closed. Keep the purifier on in the same room.
5. Click **Compare baseline / candidate**. Check **Compared inputs**: only ordinary window states should differ. Confirm shared weather, initial state and 20-minute duration. Read whole-flat PM2.5, PM exposure, air changes and electricity; export CSV.

Explain: “The purifier removes particles in both trials. Openings change the incoming haze. Closing ordinary windows does not establish safe air: leakage and many real-building effects are omitted, and the fan adapter remains passively open.”

Differences are **candidate minus baseline**. Negative PM2.5/exposure means lower model concentration/integrated concentration, not a measured inhaled dose. Fewer air changes are not automatically better for every indoor-air need.

A fresh `two-layer-surface-v2` engine probe of this exact pair gave whole-flat final PM2.5 **146.48 → 34.21 µg/m³**, integrated concentration **35.41 → 12.11 µg·h/m³**, and **13.33 Wh electricity in each arm**. Ten ordinary windows differed. The candidate has only one passive exterior connection, so this steady network predicts approximately zero sustained boundary flow. It omits leakage and single-sided turbulent exchange; this is not real airtightness or a safe-air claim. Read the actual displayed result during rehearsal.

Optional purifier test: capture the current closed-window setup with purifier **off**, then turn it **on** and compare. Only purifier power should differ.

## 3. Show when a window fan helps — and when it does not

1. Open **Window fan test → Demo setup → 1. Cooler evening · connected route**. Select **Compare fan off / on**. The explicit setup uses 31°C initial air/surfaces, 27°C outside, no wind, a 300 m³/h Bedroom 3 north-window exhaust, 30 simulated minutes, and no other powered devices. Living-room window 2 plus internal doors provide replacement air. This replaces only the lab controls, not My flat.
2. Read the **Bedroom 3 occupied air** difference and chart alongside the whole-flat mean. The result explanation shows actual fan-off/on exchange. These are different spatial averages, not contradictory readings. The paired comparison changes only fan power; the adapter passage exists in both arms.
3. Choose **2. Same evening · blocked route**, then compare again. All other openings close. Sustained flow is blocked while motor heat remains. This is an intentional counterexample, not a failed demonstration.
4. Choose **3. Hotter outside · connected route**, then compare again. The same calm, non-sunny setup now has 35°C replacement air. Explain: “A fan moves air. Cooler replacement air can take heat away; hotter replacement air can bring heat in.” This is an illustrative manual condition, not a forecast.

A solver check of these presets gives approximately **−0.58°C occupied-layer / −0.45°C whole-flat** change for the cooler connected route, **286 m³/h** actual fan-on flow, and **7 Wh** additional electricity over 30 minutes. The blocked case gives approximately zero sustained flow and slight warming; the hotter case gives about **+0.35°C whole-flat** change. Read the displayed results in rehearsal rather than promising these as measured effects. Coefficients are unchanged. The selected room effect can differ from the flat-wide effect because of the route and stored wall heat.

**Why a custom comparison may show little change:** the route may be blocked, outdoor air may be as warm as indoor air, natural ventilation may already be doing much of the work, or a local change may be diluted in a whole-flat mean. This model does not calculate a fan’s evaporative comfort effect on a person. Do not invent cooling to make the chart dramatic.

**Customize test** retains the individual controls. Editing a demo turns it into a custom setup. **Refresh from the flat** restores the flat’s current weather/openings/devices; it never changes the flat. **Compared inputs** and **Air exchange and heat balance** remain available as disclosures beneath the result.

## 4. Optional corridor, envelope and pressure questions

- **Different air outside the main door:** enable **Optional shared corridor boundary → Separate conditions at the main door**, set its temperature/PM2.5, and open **Main entrance door** under individual openings. It is a fixed sheltered reservoir only at that exterior door; it does not respond to the flat or replace internal corridor rooms. Windows still use outdoors. Current corridor values apply to both arms, including an older baseline.
- **Stop heat arriving first:** in configuration mode, choose a hot sunny scenario, capture a baseline at **0% shading**, change to **80%**, and compare. Only shading should differ. Conductance slows transfer in both directions; it is not certified wall performance or cardboard thickness.
- **Can pressure expansion cool the room?** Under **About this test**, use the separate pressure-expansion calculator at **30 Pa / 50%**. It gives about **0.0256°C** ideal static-temperature drop and **3 W** fan input under its stated assumptions. That drop is never subtracted from room temperatures. The apartment's relative pressure index cannot be converted to these pascals.
- **Where does air travel?** Return to **My flat**, enable **More → Science views → Show pressure and validation**, close exterior openings, select **Validation case**, then open the bedroom 3 north window and main door. **Air movement** shows the planar connected route; pressure is a relative index, not Pa. Lab results do not repaint that field.

## Optional multiple-fan walkthrough

Open **My flat → Devices → Standing fans**, click **Add fan**, then choose each fan under **Fan to adjust**. Switch both on at nonzero speed; point one toward the plan top (**0°**) and another toward the plan right (**90°**). Drag them onto valid floor or use **Move to a room / Exact floor position**. Inspect **Air movement** without presenting the illustrative arrows as measured airflow. Turn an individual fan off, or remove an added fan, to compare the setup. Fans move air rather than refrigerating it.

Run **Suggest changes** and show the note that added fans stay fixed while Main fan presets are tested. Fan-control browser checks pass, including invalid placements and workspace retention. Native multiple-fan dragging still needs rehearsal on the presentation machine; the room selector is the checked alternative.

## Optional homeowner and switch walkthrough

In **My flat**, choose a day and use **What to try → Suggest changes**. Read the actual change list and heat/haze/power trade-offs before clicking **Apply these changes**. Use **Undo** before making another edit. The suggestion compares whole-flat options and does not predict a health-safe or professionally assessed outcome.

To show the three-plan workflow, open **Compare floor plans → Try the 3 example plans**, choose shared weather and click **Compare three plans**. Read the separate metric advantages and room results, then **Download comparison**. **Weather source & details** records manual input provenance; it does not automatically fetch weather.

With the verified board setup connected, press and release **D4** once: both Bedroom 3 windows change together. Holding must not repeat. Press again to reverse the group. Hold **D5** to power the simulated Bedroom 3 corner purifier, then release to stop it. These switches supply inputs only; no real purifier or motor is powered. Physical upload/USB checks remain outstanding until performed on the actual board. Without a board, select Bedroom 3 and use **Open both windows / Close both windows** plus the purifier controls. Keyboard **1 / 4** changes the north/east window independently; keyboard 4 is distinct from the physical D4 group button.

## Keep the demonstration reviewable

**Cancel** stops the worker; edits clear old results. If a worker fails, keep the inputs and choose **Retry comparison**; after completion, **View results** reaches the result section. **Refresh from the flat** updates candidate controls, not warmed fields or the saved baseline. Inspect shared conditions and changed settings before presenting. [CHECKLIST.md](../CHECKLIST.md) records software evidence, not physical validation.

The physical model needs **two A4 sheets of 3 mm card, no roof**. Full-size-flat thermal properties do not describe the card. USB/servos remain unverified. [Cooling science](cooling-science.md) and [fan thermodynamics](fan-thermodynamics.md) explain the mechanisms.

Written by gpt-6-astra in Codex on behalf of Edmund
