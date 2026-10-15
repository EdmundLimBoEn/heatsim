import './cooling-lab.css';
import { model, roomLabel, type Conditions } from './domain';
import { PRESETS } from './simulation';
import { createThermalConfig, THERMAL_OPENINGS, THERMAL_ASSUMPTIONS } from './thermal-model';
import type { ThermalConfig, ThermalSnapshot, ThermalRoomReading, ThermalHeatBudget } from './thermal-types';
import { createThermalComparisonRunner, type ThermalComparisonResult } from './thermal-comparison';
import { thermalComparisonCsv } from './thermal-export';
import { calculateFanThermodynamics } from './fan-thermodynamics';

export interface CoolingLabOptions {
  readConditions: () => Conditions;
  selectedRoom?: () => string | null;
  onVentChange?: (vent: ThermalConfig['vent'] | null) => void;
}

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const signed = (value: number, decimals = 1) => `${Math.abs(value) < 0.5 * 10 ** -decimals ? '' : value > 0 ? '+' : '−'}${Math.abs(value).toFixed(decimals)}`;
const number = (value: number, decimals = 1) => Number.isFinite(value) ? value.toFixed(decimals) : 'Unavailable';
const budgetLabels: [keyof ThermalHeatBudget, string][] = [
  ['solar', 'Solar gain'], ['conduction', 'Envelope conduction'], ['radiation', 'Longwave radiation'],
  ['ventilation', 'Outdoor air exchange'], ['people', 'People'], ['fan', 'Fan heat'], ['appliances', 'Other appliances'], ['ac', 'Air conditioning'],
];

export function mountCoolingLab(container: HTMLElement, options: CoolingLabOptions): { dispose(): void; refreshCaptureStatus(): void; readPreviewConditions(): Conditions } {
  const runner = createThermalComparisonRunner();
  const events = new AbortController();
  let capturedBase = structuredClone(options.readConditions());
  let config = createThermalConfig(capturedBase);
  let report: ThermalComparisonResult | null = null;
  let running = false;
  let request = 0;
  const roomNames = [...new Set(THERMAL_OPENINGS.map(opening => opening.room))];
  let selectedRoom = options.selectedRoom?.() ?? 'bedroom3';
  if (!roomNames.includes(selectedRoom)) selectedRoom = 'bedroom3';
  const firstOpening = THERMAL_OPENINGS.find(opening => opening.room === selectedRoom) ?? THERMAL_OPENINGS[0];
  selectedRoom = firstOpening.room;
  config.vent.opening = firstOpening.name;
  config.vent.on = true;

  const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const element = container.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Cooling Lab control ${selector}`);
    return element;
  };
  const range = (id: string, label: string, min: number, max: number, step: number, value: number, unit: string) => `<label class="cl-range" for="${id}"><span>${label}<output id="${id}-value">${value}${unit}</output></span><input id="${id}" data-cl="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-unit="${unit}"></label>`;

  container.innerHTML = `<section class="cooling-lab" aria-labelledby="cl-title">
    <header class="cl-heading"><div><h2 id="cl-title">Where does the heat go?</h2><p>Compare the same home with its high-level ventilation fan off and on.</p></div><span class="cl-model-tag">Reduced-order thermal / ventilation model <strong>SIMULATED</strong></span></header>
    <p id="cl-capture-status" class="cl-capture-status" role="status" aria-live="polite" hidden></p>
    <div class="cl-workspace">
      <form class="cl-controls" id="cl-form" aria-label="Cooling experiment settings">
        <section><h3>Set up the experiment</h3><label class="cl-label" for="cl-room">Room</label><select id="cl-room" data-cl="room">${roomNames.map(room => `<option value="${room}" ${room === selectedRoom ? 'selected' : ''}>${roomLabel(room)}</option>`).join('')}</select>
        <label class="cl-label" for="cl-opening">Exterior fan opening</label><select id="cl-opening" data-cl="opening"></select>
        <label class="cl-label" for="cl-mode">Fan direction</label><select id="cl-mode" data-cl="mode"><option value="exhaust">High-level exhaust · out of the room</option><option value="supply">High-level supply · into the room</option></select>
        ${range('cl-flow', 'Rated fan flow', 20, 600, 10, config.vent.ratedM3h, ' m³/h')}
        <p class="cl-help">Rated flow is a specification. The actual flow depends on the available make-up path and opposing wind.</p>
        <label class="cl-label" for="cl-duration">Simulated duration</label><select id="cl-duration" data-cl="duration"><option value="600">10 minutes</option><option value="1200" selected>20 minutes</option><option value="1800">30 minutes</option></select></section>
        <section><h3>Weather & make-up air</h3><label class="cl-label" for="cl-scenario">Outdoor scenario</label><select id="cl-scenario" data-cl="scenario"><option value="captured">Captured flat setup</option>${PRESETS.map(preset => `<option value="${preset.id}">${escape(preset.name)}</option>`).join('')}</select><p id="cl-environment" class="cl-environment"></p>
        <label class="cl-label" for="cl-route">Openings for both trials</label><select id="cl-route" data-cl="route"><option value="captured">Use captured flat openings</option><option value="open">Open windows + internal doors</option><option value="sealed">Close all other openings</option></select><p class="cl-help">The selected fan opening has the same installed adapter in both trials. Other openings supply the make-up path. These settings only affect this lab.</p><button class="cl-button cl-secondary" type="button" id="cl-recapture">Refresh from the flat</button></section>
        <section><h3>Building envelope</h3>
        ${range('cl-uvalue', 'Envelope conductance', 0.2, 5, 0.1, config.envelope.uValue, ' W/m²K')}
        ${range('cl-absorptance', 'Solar absorptance', 0.05, 0.95, 0.05, config.envelope.solarAbsorptance, '')}
        ${range('cl-shade', 'External shading', 0, 100, 5, config.envelope.shadeFraction * 100, '%')}
        <p class="cl-help">Illustrative full-size flat properties. Conductance is outside-to-surface heat transfer, not a certified wall U-value. The cardboard thickness is unrelated.</p></section>
        <div class="cl-run-controls"><button class="cl-button cl-primary" id="cl-run" type="submit">Compare fan off / on</button><button class="cl-button cl-secondary" id="cl-cancel" type="button" hidden>Cancel</button><progress id="cl-progress" max="100" value="0" aria-label="Comparison progress" hidden></progress><p id="cl-status" role="status" aria-live="polite">Both trials start from identical scenario temperatures, not the live 3D readings.</p></div>
      </form>
      <div class="cl-main">
        <div data-lab-model-slot class="cooling-lab-model-slot"></div>
        <div class="cl-fairness"><strong>One controlled change</strong><span>Identical initial air and surface temperatures, weather, openings and devices. Only the installed vent fan changes.</span></div>
        <section id="cl-results" class="cl-results" aria-label="Fan comparison results">
          <div class="cl-results-heading"><div><h3>What changes after <span id="cl-duration-label">20 minutes</span>?</h3><p>Captured lab setup · fan on minus fan off. Negative temperature differences mean cooler air.</p></div><button class="cl-button cl-secondary" type="button" id="cl-export" disabled>Export comparison CSV</button></div>
          <div id="cl-summary" class="cl-summary"><p class="cl-empty">Run a comparison to see the temperatures, electricity and particle changes.</p></div>
          <div class="cl-visuals"><section class="cl-chart-panel"><h4>Occupied-layer temperature</h4><div class="cl-chart-key"><span class="cl-line-off">Fan off</span><span class="cl-line-on">Fan on</span></div><div id="cl-chart"><p class="cl-empty">Both traces will start at the same temperature and use the same time axis.</p></div></section><section class="cl-section-panel"><h4 id="cl-section-title">Two air layers and one surface</h4><div id="cl-cross-section"><p class="cl-empty">The section will show the final fan-on state of your selected room.</p></div><p class="cl-help">Nodal illustration, not a resolved plume or 3D temperature field. Layer boundaries and arrows are schematic.</p></section></div>
          <div class="cl-result-bottom"><section><h4>Actual exchange & make-up air</h4><div id="cl-flow-result"><p class="cl-empty">A blocked route can limit exchange. The fan rating alone does not establish the flow.</p></div></section><section><h4>Heat budget of the whole flat</h4><div id="cl-budget"><p class="cl-empty">Conduction, radiation, ventilation and internal heat sources will be shown separately.</p></div></section></div>
        </section>
      </div>
    </div>
    <div class="cl-learning-grid"><details class="cl-learning"><summary>Why these controls matter</summary><div class="cl-strategies"><p><strong>Shade before cooling.</strong> External shading reduces the solar source. It does not refrigerate the air. <a href="https://www.energy.gov/home-cooling" target="_blank" rel="noopener">DOE cooling guidance</a></p><p><strong>Provide a connected route.</strong> Exhaust needs replacement air. A door or window can become the limiting restriction. <a href="https://basc.pnnl.gov/resource-guides/whole-house-fans" target="_blank" rel="noopener">PNNL ventilation guidance</a></p><p><strong>Try cooler outdoor air.</strong> Warm replacement air can add sensible heat. Humid or hazy replacement air can create other costs. Compare the evening and haze scenarios.</p><p><strong>Insulation slows both directions.</strong> Reducing envelope conductance can slow daytime heat entry and nighttime heat escape. Both trials use the same envelope settings.</p></div></details>
    <details class="cl-learning"><summary>Assumptions & limits</summary><ul>${THERMAL_ASSUMPTIONS.map(note => `<li>${escape(note)}</li>`).join('')}<li>The properties describe the full-size flat, not 3 mm cardboard.</li><li>Longwave radiation exchanges with ambient-temperature surroundings. There is no assumed cold-sky sink.</li><li>The upper-air share of people heat is an illustrative plume approximation, not resolved rising airflow.</li><li>Humidity is a scenario condition. This experiment does not solve latent heat, condensation or dehumidification.</li></ul></details>
    <details class="cl-learning cl-expansion"><summary>Can pressure expansion make a room colder?</summary><div class="cl-expansion-content"><p>An ideal reversible expansion can lower static temperature while converting enthalpy into motion. A fan adds energy; mixing can return that motion to heat. This separate calculation is <strong>not net room cooling</strong>.</p><div class="cl-expansion-inputs">${range('cl-pressure', 'Hypothetical pressure drop', 0, 200, 5, 30, ' Pa')}${range('cl-efficiency', 'Overall fan efficiency', 10, 100, 5, 50, '%')}</div><div id="cl-expansion-result" class="cl-expansion-result" aria-live="polite"></div><p class="cl-help">Dry air at 303 K, 101325 Pa absolute pressure, 180 m³/h flow. All fan input energy is assumed to end up in the air. These Pa inputs are unrelated to the plan-view relative pressure index.</p><a href="https://www.grc.nasa.gov/www/k-12/airplane/isentrop.html" target="_blank" rel="noopener">NASA ideal isentropic relations</a></div></details></div>
  </section>`;

  function updateOpenings(): void {
    const openings = THERMAL_OPENINGS.filter(opening => opening.room === selectedRoom);
    if (!openings.some(opening => opening.name === config.vent.opening)) config.vent.opening = openings[0].name;
    $('#cl-opening').innerHTML = openings.map(opening => {
      const suffix = openings.filter(candidate => candidate.label === opening.label).length > 1 ? ` ${opening.name.match(/_(\d+)$/)?.[1] ?? openings.indexOf(opening) + 1}` : '';
      return `<option value="${opening.name}" ${opening.name === config.vent.opening ? 'selected' : ''}>${escape(opening.label + suffix)}</option>`;
    }).join('');
  }
  function refreshCaptureStatus(): void {
    const changed = JSON.stringify(options.readConditions()) !== JSON.stringify(capturedBase);
    $('#cl-capture-status').hidden = !changed;
    $('#cl-capture-status').textContent = changed ? 'The flat has changed since this setup was captured. This preview and any retained results use the lab’s captured setup. Choose “Refresh from the flat” to use the new settings.' : '';
  }
  function buildBase(): Conditions {
    const scenario = $<HTMLSelectElement>('#cl-scenario').value;
    const preset = PRESETS.find(preset => preset.id === scenario);
    const base = structuredClone(capturedBase);
    if (preset) Object.assign(base, structuredClone(preset.conditions), { doors: base.doors, windows: base.windows, devices: base.devices, portableFan: base.portableFan, purifier: base.purifier, acSetpoint: base.acSetpoint });
    const route = $<HTMLSelectElement>('#cl-route').value;
    if (route !== 'captured') {
      for (const id of Object.keys(base.windows)) base.windows[id] = route === 'open';
      for (const box of model.boxes) if (box.type === 'door') base.doors[box.name] = route === 'open' && !box.exterior;
    }
    return base;
  }
  function sync(): void {
    config.base = buildBase();
    $('#cl-environment').textContent = `${config.base.outdoorTemperature}°C outdoors · ${config.base.outdoorPm25} µg/m³ PM2.5 · ${config.base.humidity}% RH`;
    $('#cl-duration-label').textContent = `${config.durationSeconds / 60} minutes`;
    container.querySelectorAll<HTMLInputElement>('.cl-range input').forEach(input => {
      $(`#${input.id}-value`).textContent = `${Number(input.value)}${input.dataset.unit}`;
    });
    options.onVentChange?.({ ...config.vent, on: true });
    refreshCaptureStatus();
  }
  function clearReport(message: string): void {
    request++; runner.cancel(); running = false; report = null;
    $<HTMLButtonElement>('#cl-run').disabled = false;
    $('#cl-cancel').hidden = true; $('#cl-progress').hidden = true;
    $<HTMLButtonElement>('#cl-export').disabled = true;
    $('#cl-status').textContent = message;
    $('#cl-summary').innerHTML = '<p class="cl-empty">Settings updated. Run a new matched comparison.</p>';
    $('#cl-chart').innerHTML = '<p class="cl-empty">New paired traces appear after the comparison.</p>';
    $('#cl-cross-section').innerHTML = '<p class="cl-empty">The selected room’s final fan-on state will appear here.</p>';
    $('#cl-flow-result').innerHTML = '<p class="cl-empty">Actual exchange will be calculated from the configured route.</p>';
    $('#cl-budget').innerHTML = '<p class="cl-empty">A new comparison will show the heat budget.</p>';
  }
  const roomReading = (snapshot: ThermalSnapshot, room: string): ThermalRoomReading => {
    const reading = snapshot.rooms.find(reading => reading.room === room);
    if (!reading) throw new Error(`No thermal result for ${roomLabel(room)}.`);
    return reading;
  };
  function chart(result: ThermalComparisonResult, room: string): string {
    const off = result.off.samples.map(sample => ({ time: sample.elapsedSeconds, value: roomReading(sample, room).lowerTemperature }));
    const on = result.on.samples.map(sample => ({ time: sample.elapsedSeconds, value: roomReading(sample, room).lowerTemperature }));
    const values = [...off, ...on].map(point => point.value);
    const min = Math.floor((Math.min(...values) - 0.15) * 2) / 2;
    const max = Math.ceil((Math.max(...values) + 0.15) * 2) / 2;
    const x = (time: number) => 46 + time / result.durationSeconds * 416;
    const y = (temperature: number) => 180 - (temperature - min) / (max - min) * 146;
    const path = (points: { time: number; value: number }[]) => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(2)} ${y(point.value).toFixed(2)}`).join(' ');
    return `<svg viewBox="0 0 490 225" role="img" aria-labelledby="cl-chart-title cl-chart-desc"><title id="cl-chart-title">${roomLabel(room)} occupied-layer temperatures, fan off versus fan on</title><desc id="cl-chart-desc">Both trials start at ${number(off[0].value)} degrees Celsius. At ${result.durationSeconds / 60} minutes, fan off is ${number(off.at(-1)!.value)} and fan on is ${number(on.at(-1)!.value)} degrees Celsius.</desc>${[0, 1, 2, 3].map(tick => { const value = min + (max - min) * tick / 3; return `<line x1="46" x2="462" y1="${y(value)}" y2="${y(value)}" class="cl-gridline"/><text x="38" y="${y(value) + 4}" text-anchor="end">${number(value)}</text>`; }).join('')}${[0, 1, 2, 3, 4].map(tick => `<text x="${x(result.durationSeconds * tick / 4)}" y="203" text-anchor="middle">${number(result.durationSeconds * tick / 240, 0)}</text>`).join('')}<text x="12" y="18">°C</text><text x="254" y="222" text-anchor="middle">Simulated minutes</text><path data-cl-series="off" d="${path(off)}" class="cl-trace-off"/><path data-cl-series="on" d="${path(on)}" class="cl-trace-on"/></svg><p class="cl-chart-values">${roomLabel(room)} at ${result.durationSeconds / 60} min: off <strong>${number(off.at(-1)!.value)}°C</strong> / on <strong>${number(on.at(-1)!.value)}°C</strong>.</p>`;
  }
  function crossSection(reading: ThermalRoomReading, result: ThermalComparisonResult): string {
    const actualFlow = result.on.final.actualVentM3h;
    const hasFlow = Math.abs(actualFlow) >= 0.1;
    const backflow = actualFlow < 0;
    const outward = (result.config.vent.mode === 'exhaust') !== backflow;
    const flowLabel = !hasFlow ? 'No exchange' : backflow ? 'Backflow' : result.config.vent.mode === 'exhaust' ? 'Exhaust' : 'Supply';
    return `<svg viewBox="0 0 420 232" role="img" aria-labelledby="cl-section-svg-title cl-section-svg-desc"><title id="cl-section-svg-title">${roomLabel(reading.room)} final fan-on thermal nodes</title><desc id="cl-section-svg-desc">Lower air ${number(reading.lowerTemperature)} degrees Celsius, upper air ${number(reading.upperTemperature)}, surface ${number(reading.surfaceTemperature)}. Vent flow: ${flowLabel.toLowerCase()}, ${number(Math.abs(actualFlow))} cubic metres per hour. The illustration is schematic.</desc><defs><marker id="cl-vent-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#386f62"/></marker></defs><rect x="38" y="26" width="300" height="166" fill="#e5eee7" rx="3"/><path d="M38 26H338V103H38Z" fill="#f2e5ce"/><path d="M38 103H338" stroke="#bbc9bc" stroke-dasharray="5 5"/><path d="M30 192V18H346V192" fill="none" stroke="#80988a" stroke-width="12"/><path d="M29 196H348" stroke="#80988a" stroke-width="10"/><text x="64" y="55">Upper air</text><text x="64" y="84" class="cl-node-number">${number(reading.upperTemperature)}°C</text><text x="64" y="131">Occupied / lower air</text><text x="64" y="163" class="cl-node-number">${number(reading.lowerTemperature)}°C</text><path d="M267 146V68" stroke="#b18e58" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#cl-vent-arrow)"/><text x="280" y="122"><tspan>Layer</tspan><tspan x="280" dy="16">exchange</tspan></text><circle cx="338" cy="55" r="15" fill="#fff" stroke="#386f62" stroke-width="2"/>${hasFlow ? `<path data-cl-vent-flow="${backflow ? 'backflow' : 'forward'}" d="M${outward ? '315 55H399' : '399 55H315'}" stroke="#386f62" stroke-width="3" marker-end="url(#cl-vent-arrow)"/>` : ''}<text x="358" y="89" text-anchor="middle">${flowLabel}</text><text x="211" y="222" text-anchor="middle">Surface ${number(reading.surfaceTemperature)}°C</text></svg>`;
  }
  function renderResult(result: ThermalComparisonResult): void {
    const room = THERMAL_OPENINGS.find(opening => opening.name === result.config.vent.opening)!.room;
    const off = roomReading(result.off.final, room), on = roomReading(result.on.final, room);
    const metrics = [
      ['Occupied-layer change', signed(on.lowerTemperature - off.lowerTemperature, 2), '°C'],
      ['Upper-layer change', signed(on.upperTemperature - off.upperTemperature, 2), '°C'],
      ['Whole-flat PM2.5 change', signed(result.difference.averagePm25, 2), 'µg/m³'],
      ['Electricity change', signed(result.difference.energyWh, 2), 'Wh'],
    ];
    $('#cl-summary').innerHTML = metrics.map(([label, value, unit]) => `<div class="cl-metric"><span>${label}</span><strong>${value}<small>${unit}</small></strong><em>SIMULATED</em></div>`).join('');
    $('#cl-chart').innerHTML = chart(result, room);
    $('#cl-section-title').textContent = `${roomLabel(room)} · fan on`;
    $('#cl-cross-section').innerHTML = crossSection(on, result);
    const actual = result.on.final.actualVentM3h;
    const flowNote = actual < -0.1 ? 'Backflow: the solved flow opposes the commanded fan direction.' : Math.abs(actual) < 0.1 ? 'Exchange is effectively blocked. Try opening a connected make-up route.' : 'The current opening network allows exchange. Actual flow includes the effect of wind and restrictions.';
    $('#cl-flow-result').innerHTML = `<dl class="cl-flow-list"><div><dt>Rated fan flow</dt><dd>${number(result.config.vent.ratedM3h, 0)} m³/h</dd></div><div><dt>Actual flow, fan on</dt><dd>${signed(actual)} m³/h</dd></div><div><dt>Actual flow, fan off</dt><dd>${signed(result.off.final.actualVentM3h)} m³/h</dd></div><div><dt>Fan electricity</dt><dd>${number(result.on.final.fanPowerWatts)} W</dd></div><div><dt>Whole-flat energy, off / on</dt><dd>${number(result.off.final.energyWh, 2)} / ${number(result.on.final.energyWh, 2)} Wh</dd></div><div><dt>PM exposure change</dt><dd>${signed(result.difference.pmExposureUgHoursM3, 2)} µg·h/m³</dd></div></dl><p class="cl-help">${flowNote} Positive flow follows the chosen ${result.config.vent.mode} direction.</p><p class="cl-caveat">Outdoor air is ${result.config.base.outdoorTemperature}°C, ${result.config.base.humidity}% RH and ${result.config.base.outdoorPm25} µg/m³ PM2.5. Ventilation may bring heat, moisture or haze inside. Moisture loads are not calculated.</p>`;
    const convection = (snapshot: ThermalSnapshot) => snapshot.rooms.reduce((sum, reading) => sum + reading.wallToAirWatts, 0);
    $('#cl-budget').innerHTML = `<p class="cl-help">Final heat rates in W. Positive adds heat; negative removes it.</p><div class="cl-table-scroll"><table><thead><tr><th scope="col">Mechanism</th><th scope="col">Fan off</th><th scope="col">Fan on</th></tr></thead><tbody>${budgetLabels.map(([key, label]) => `<tr><th scope="row">${label}</th><td>${signed(result.off.final.heatBudgetW[key])}</td><td>${signed(result.on.final.heatBudgetW[key])}</td></tr>`).join('')}<tr class="cl-net"><th scope="row">Net external + source heat</th><td>${signed(result.off.final.heatBudgetW.net)}</td><td>${signed(result.on.final.heatBudgetW.net)}</td></tr></tbody></table></div><p class="cl-help">Surface-to-air convection: ${signed(convection(result.off.final))} W off / ${signed(convection(result.on.final))} W on. This redistributes heat inside the flat and is not added again to the net heat budget.</p><p class="cl-help">Stored-energy change: ${signed(result.difference.storedEnergyJ / 1000, 2)} kJ on minus off. These final rates are not the time-integrated energy balance.</p>`;
    $<HTMLButtonElement>('#cl-export').disabled = false;
  }
  function renderExpansion(): void {
    try {
      const pressure = Number($<HTMLInputElement>('#cl-pressure').value);
      const efficiency = Number($<HTMLInputElement>('#cl-efficiency').value) / 100;
      const result = calculateFanThermodynamics({ pressureDifferencePa: pressure, efficiency, flowM3s: 0.05 });
      $('#cl-expansion-result').innerHTML = `<div><span>Ideal static-temperature drop</span><strong>${number(result.idealStaticTemperatureDropK, 4)}°C</strong></div><div><span>Fan input power</span><strong>${number(result.electricalPowerW, 2)} W</strong></div><div><span>Assumed fan-heat rise</span><strong>+${number(result.fanTemperatureRiseK ?? 0, 4)}°C</strong></div>`;
    } catch (error) { $('#cl-expansion-result').textContent = error instanceof Error ? error.message : 'The calculation is unavailable.'; }
  }
  async function run(): Promise<void> {
    if (running) return;
    sync();
    clearReport('Starting a fresh matched comparison.');
    const frozen = structuredClone(config);
    const token = ++request;
    running = true; report = null;
    $<HTMLButtonElement>('#cl-run').disabled = true; $<HTMLButtonElement>('#cl-export').disabled = true;
    $('#cl-cancel').hidden = false; $('#cl-progress').hidden = false;
    $<HTMLProgressElement>('#cl-progress').value = 0;
    $('#cl-status').textContent = 'Running matched fan-off and fan-on trials…';
    try {
      const result = await runner.run(frozen, progress => {
        if (token !== request) return;
        $<HTMLProgressElement>('#cl-progress').value = progress.total > 0 ? progress.done / progress.total * 100 : 0;
        $('#cl-status').textContent = `Comparing both trials: ${number(progress.elapsedSeconds / 60, 1)} / ${frozen.durationSeconds / 60} simulated minutes.`;
      });
      if (token !== request) return;
      report = result; renderResult(result);
      $('#cl-status').textContent = `Comparison complete: ${result.durationSeconds / 60} simulated minutes per trial in ${number(result.runtimeMs / 1000)} real seconds.`;
    } catch (error) {
      if (token !== request) return;
      $('#cl-status').textContent = error instanceof DOMException && error.name === 'AbortError' ? 'Comparison cancelled.' : error instanceof Error ? error.message : 'Comparison failed. Your flat setup is unchanged.';
    } finally {
      if (token === request) { running = false; $<HTMLButtonElement>('#cl-run').disabled = false; $('#cl-cancel').hidden = true; $('#cl-progress').hidden = true; }
    }
  }
  function change(input: HTMLInputElement | HTMLSelectElement): void {
    if (input.id === 'cl-pressure' || input.id === 'cl-efficiency') {
      $(`#${input.id}-value`).textContent = `${Number(input.value)}${input.dataset.unit}`; renderExpansion(); return;
    }
    if (!input.dataset.cl) return;
    switch (input.id) {
      case 'cl-room': selectedRoom = input.value; updateOpenings(); break;
      case 'cl-opening': config.vent.opening = input.value; break;
      case 'cl-mode': config.vent.mode = input.value as 'exhaust' | 'supply'; break;
      case 'cl-flow': config.vent.ratedM3h = Number(input.value); break;
      case 'cl-duration': config.durationSeconds = Number(input.value); break;
      case 'cl-uvalue': config.envelope.uValue = Number(input.value); break;
      case 'cl-absorptance': config.envelope.solarAbsorptance = Number(input.value); break;
      case 'cl-shade': config.envelope.shadeFraction = Number(input.value) / 100; break;
    }
    clearReport('Settings changed. Run a new matched comparison.'); sync();
  }
  $('#cl-form').addEventListener('submit', event => { event.preventDefault(); void run(); }, { signal: events.signal });
  container.addEventListener('input', event => { const input = event.target as HTMLInputElement; if (input.matches('input[type="range"][data-cl]')) change(input); }, { signal: events.signal });
  container.addEventListener('change', event => { const input = event.target as HTMLSelectElement; if (input.matches('select[data-cl]')) change(input); }, { signal: events.signal });
  $('#cl-cancel').addEventListener('click', () => { clearReport('Comparison cancelled. Your flat setup is unchanged.'); $('#cl-run').focus(); }, { signal: events.signal });
  $('#cl-recapture').addEventListener('click', () => {
    capturedBase = structuredClone(options.readConditions());
    $<HTMLSelectElement>('#cl-scenario').value = 'captured'; $<HTMLSelectElement>('#cl-route').value = 'captured';
    clearReport('Fresh flat settings captured. Run to compare from the scenario’s initial temperatures.'); sync();
  }, { signal: events.signal });
  $('#cl-export').addEventListener('click', () => {
    if (!report) return;
    try {
      const url = URL.createObjectURL(new Blob([thermalComparisonCsv(report)], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `heatsim-cooling-${report.durationSeconds / 60}min.csv`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('#cl-status').textContent = 'Comparison CSV exported with its captured configuration and both traces.';
    } catch (error) { $('#cl-status').textContent = error instanceof Error ? error.message : 'Export failed. Run a new comparison and try again.'; }
  }, { signal: events.signal });
  updateOpenings(); sync(); renderExpansion();
  return { refreshCaptureStatus, readPreviewConditions: () => structuredClone(config.base), dispose() { request++; events.abort(); runner.dispose(); options.onVentChange?.(null); } };
}
