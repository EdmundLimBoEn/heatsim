import './cooling-lab.css';
import { model, roomLabel, deviceRoom, type Conditions } from './domain';
import { PURIFIER_SLOTS } from './config/slots';
import { PRESETS } from './simulation';
import { createThermalConfig, THERMAL_OPENINGS, THERMAL_ASSUMPTIONS } from './thermal-model';
import type { ThermalConfig, ThermalSnapshot, ThermalRoomReading, ThermalHeatBudget } from './thermal-types';
import { createThermalComparisonRunner, type ThermalComparisonResult, type ThermalComparisonProgress } from './thermal-comparison';
import { thermalComparisonCsv } from './thermal-export';
import { calculateFanThermodynamics } from './fan-thermodynamics';
import { pm25ToUsAqiEquivalent } from './air-quality';

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
  let weatherOverrides: Partial<Conditions> = {};
  let openingOverrides: Pick<Conditions, 'windows' | 'doors'> | null = null;
  let purifierOverride: Conditions['purifier'];
  let deviceOverrides: Conditions['devices'] = {};
  let comparisonMode: 'fan-toggle' | 'configuration' = 'fan-toggle';
  let baseline: ThermalConfig | null = null;
  let report: ThermalComparisonResult | null = null;
  let running = false;
  let runFailed = false;
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
  const openingLabel = (name: string) => name === 'main_door' ? 'Main entrance door' : `${roomLabel(name.replace(/^(window|door)_/, '').replace(/^master_(\d+)$/, 'master_bedroom_$1').replace(/_(\d+)$/, ' $1'))} ${name.startsWith('window_') ? 'window' : 'door'}`;
  const caseLabels = (result: ThermalComparisonResult): [string, string] => result.comparisonMode === 'configuration' ? ['Baseline', 'Candidate'] : ['Fan off', 'Fan on'];

  container.innerHTML = `<section class="cooling-lab" aria-labelledby="cl-title">
    <header class="cl-heading"><h2 id="cl-title" class="cl-accessible-title">Window fan test</h2><span class="cl-model-tag">A rough model for comparing ideas <strong>SIMULATED</strong></span></header>
    <p id="cl-capture-status" class="cl-capture-status" role="status" aria-live="polite" hidden></p>
    <div class="cl-workspace">
      <form class="cl-controls" id="cl-form" aria-label="Window fan test settings">
        <section><h3>Choose a comparison</h3><label class="cl-label" for="cl-comparison-mode">Experiment</label><select id="cl-comparison-mode" data-cl="comparison-mode"><option value="fan-toggle">Quick fan off / on</option><option value="configuration">Captured baseline / candidate</option></select><div id="cl-baseline-controls" hidden><p class="cl-help">Capture the current openings, devices, vent and envelope. Then adjust the candidate below. Current weather, corridor conditions and duration apply to both.</p><button id="cl-capture-baseline" type="button" class="cl-button cl-secondary">Capture baseline</button><p id="cl-baseline-status" class="cl-help">Capture a baseline before comparing.</p></div></section>
        <section><h3>Choose where to try it</h3><label class="cl-label" for="cl-room">Room</label><select id="cl-room" data-cl="room">${roomNames.map(room => `<option value="${room}" ${room === selectedRoom ? 'selected' : ''}>${roomLabel(room)}</option>`).join('')}</select>
        <label class="cl-label" for="cl-opening">Fan window</label><select id="cl-opening" data-cl="opening"></select>
        <label class="cl-label" for="cl-mode">Fan direction</label><select id="cl-mode" data-cl="mode"><option value="exhaust">Blow air out</option><option value="supply">Bring air in</option></select>
        <label class="cl-check" id="cl-fan-on-control" hidden><input id="cl-fan-on" type="checkbox" data-cl="fan-on" checked><span>Candidate vent fan powered</span></label>
        ${range('cl-flow', 'Rated fan flow', 20, 600, 10, config.vent.ratedM3h, ' m³/h')}
        <p class="cl-help">Rated flow is a specification. The actual flow depends on the available make-up path and opposing wind.</p>
        <label class="cl-label" for="cl-duration">Simulated duration</label><select id="cl-duration" data-cl="duration"><option value="600">10 minutes</option><option value="1200" selected>20 minutes</option><option value="1800">30 minutes</option></select></section>
        <section><h3>Shared outdoor conditions</h3><label class="cl-label" for="cl-scenario">Outdoor scenario</label><select id="cl-scenario" data-cl="scenario"><option value="captured">Captured flat setup</option>${PRESETS.map(preset => `<option value="${preset.id}">${escape(preset.name)}</option>`).join('')}</select><p id="cl-environment" class="cl-environment"></p>
        ${range('cl-outdoor-temperature', 'Outdoor temperature', 10, 60, 0.5, config.base.outdoorTemperature, '°C')}
        ${range('cl-outdoor-pm25', 'Outdoor PM2.5', 0, 1000, 1, config.base.outdoorPm25, ' µg/m³')}
        <p id="cl-aqi-equivalent" class="cl-help"></p>
        ${range('cl-wind-speed', 'Wind speed', 0, 10, 0.1, config.base.windSpeed, ' m/s')}
        <label class="cl-label" for="cl-wind-from">Wind coming from</label><select id="cl-wind-from" data-cl="wind-from"><option value="">Scenario direction</option><option value="N">North</option><option value="E">East</option><option value="S">South</option><option value="W">West</option></select><p class="cl-help">These weather conditions apply to both trials. Changing a scenario resets manual weather overrides.</p>
        <details class="cl-control-details"><summary>Optional shared corridor boundary</summary><label class="cl-check"><input id="cl-corridor-enabled" data-cl="corridor-enabled" type="checkbox"><span>Separate conditions at the main door</span></label><div id="cl-corridor-fields" hidden>${range('cl-corridor-temperature', 'Corridor temperature', 10, 60, 0.5, config.base.outdoorTemperature, '°C')}${range('cl-corridor-pm25', 'Corridor PM2.5', 0, 1000, 1, config.base.outdoorPm25, ' µg/m³')}</div><p class="cl-help">A fixed sheltered reservoir only at the main entrance, not simulated corridor geometry or the internal corridor. It does not warm or accumulate pollution from the flat. Windows still exchange with outdoors.</p></details>
        <button class="cl-button cl-secondary" type="button" id="cl-reset-weather">Reset weather to selected scenario</button>
        </section><section><h3>Openings & purification</h3>
        <label class="cl-label" for="cl-route">Opening arrangement</label><select id="cl-route" data-cl="route"><option value="captured">Use captured flat openings</option><option value="open">Open windows + internal doors</option><option value="sealed">Close all other openings</option><option value="custom">Custom openings below</option></select><details class="cl-control-details"><summary>Individual windows and doors</summary><div id="cl-opening-controls" class="cl-opening-controls"></div></details><p class="cl-help">The selected fan opening contains an adapter with a passively open fan passage, even when its window toggle is closed. Other openings supply make-up air.</p>
        <label class="cl-check"><input id="cl-purifier-on" type="checkbox" data-cl="purifier-on"><span>Portable purifier powered</span></label><label class="cl-label" for="cl-purifier-slot">Portable purifier position</label><select id="cl-purifier-slot" data-cl="purifier-slot">${PURIFIER_SLOTS.map((slot, index) => `<option value="${index}">${index + 1}. ${roomLabel(slot.room)}</option>`).join('')}</select><div id="cl-fixed-purifiers"></div><p class="cl-help">Quick mode holds these settings equal. Baseline / candidate mode compares them against the captured baseline.</p><button class="cl-button cl-secondary" type="button" id="cl-recapture">Refresh from the flat</button></section>
        <section><h3>Building envelope</h3>
        ${range('cl-uvalue', 'Envelope conductance', 0.2, 5, 0.1, config.envelope.uValue, ' W/m²K')}
        ${range('cl-absorptance', 'Solar absorptance', 0.05, 0.95, 0.05, config.envelope.solarAbsorptance, '')}
        ${range('cl-shade', 'External shading', 0, 100, 5, config.envelope.shadeFraction * 100, '%')}
        <p class="cl-help">Illustrative full-size flat properties. Conductance is outside-to-surface heat transfer, not a certified wall U-value. The cardboard thickness is unrelated.</p></section>
        <div class="cl-run-controls"><button class="cl-button cl-primary" id="cl-run" type="submit">Compare fan off / on</button><button class="cl-button cl-secondary" id="cl-cancel" type="button" hidden>Cancel comparison</button><progress id="cl-progress" max="100" value="0" aria-label="Comparison progress" hidden></progress><p id="cl-status" role="status" aria-live="polite">Choose a room and fan direction, then compare. Both trials start from the same scenario temperatures.</p><button id="cl-view-results" class="cl-button cl-secondary" type="button" hidden>View results</button></div>
      </form>
      <div class="cl-main">
        <div data-lab-model-slot class="cooling-lab-model-slot"></div>
        <div class="cl-fairness"><strong id="cl-fairness-title">One controlled change</strong><span id="cl-fairness-copy">Identical initial air and surface temperatures, weather, openings and devices. Only the installed vent fan changes.</span></div>
        <section id="cl-results" class="cl-results" aria-label="Fan comparison results" tabindex="-1" aria-busy="false">
          <div class="cl-results-heading"><div><h3>What changes after <span id="cl-duration-label">20 minutes</span>?</h3><p id="cl-comparison-description">Captured lab setup · fan on minus fan off. Negative temperature differences mean cooler air.</p></div><button class="cl-button cl-secondary" type="button" id="cl-export" disabled>Export comparison CSV</button></div><div id="cl-compared-inputs" class="cl-compared-inputs"></div>
          <p id="cl-export-status" class="cl-export-status" role="status"></p><div id="cl-summary" class="cl-summary"><p class="cl-empty">Choose a room and fan direction, then select <strong>Compare fan off / on</strong>. You’ll see temperature, PM2.5 and electricity differences for the same starting conditions.</p></div>
          <div class="cl-visuals"><section class="cl-chart-panel"><h4>Occupied-layer temperature</h4><div class="cl-chart-key"><span class="cl-line-off">Fan off</span><span class="cl-line-on">Fan on</span></div><div id="cl-chart"><p class="cl-empty">Both traces will start at the same temperature and use the same time axis.</p></div></section><section class="cl-section-panel"><h4 id="cl-section-title">Two air layers and one surface</h4><div id="cl-cross-section"><p class="cl-empty">The section will show the second trial’s final state in your selected room.</p></div><p class="cl-help">Nodal illustration, not a resolved plume or 3D temperature field. Layer boundaries and arrows are schematic.</p></section></div>
          <div class="cl-result-bottom"><section><h4>Actual exchange & make-up air</h4><div id="cl-flow-result"><p class="cl-empty">A blocked route can limit exchange. The fan rating alone does not establish the flow.</p></div></section><section><h4>Heat budget of the whole flat</h4><div id="cl-budget"><p class="cl-empty">Conduction, radiation, ventilation and internal heat sources will be shown separately.</p></div></section></div>
        </section>
      </div>
    </div>
    <div class="cl-learning-grid"><details class="cl-learning"><summary>Why these controls matter</summary><div class="cl-strategies"><p><strong>Shade before cooling.</strong> External shading reduces the solar source. It does not refrigerate the air. <a href="https://www.energy.gov/home-cooling" target="_blank" rel="noopener">DOE cooling guidance</a></p><p><strong>Provide a connected route.</strong> Exhaust needs replacement air. A door or window can become the limiting restriction. <a href="https://basc.pnnl.gov/resource-guides/whole-house-fans" target="_blank" rel="noopener">PNNL ventilation guidance</a></p><p><strong>Try cooler outdoor air.</strong> Warm replacement air can add sensible heat. Humid or hazy replacement air can create other costs. Compare the evening and haze scenarios.</p><p><strong>Insulation slows both directions.</strong> Reducing envelope conductance can slow daytime heat entry and nighttime heat escape. Quick mode holds the envelope equal; capture a baseline to compare envelope changes.</p></div></details>
    <details class="cl-learning"><summary>Assumptions & limits</summary><ul>${THERMAL_ASSUMPTIONS.map(note => `<li>${escape(note)}</li>`).join('')}<li>The properties describe the full-size flat, not 3 mm cardboard.</li><li>Longwave radiation exchanges with ambient-temperature surroundings. There is no assumed cold-sky sink.</li><li>The upper-air share of people heat is an illustrative plume approximation, not resolved rising airflow.</li><li>Humidity is a scenario condition. This experiment does not solve latent heat, condensation or dehumidification.</li></ul></details>
    <details class="cl-learning cl-expansion"><summary>Can pressure expansion make a room colder?</summary><div class="cl-expansion-content"><p>An ideal reversible expansion can lower static temperature while converting enthalpy into motion. A fan adds energy; mixing can return that motion to heat. This separate calculation is <strong>not net room cooling</strong>.</p><div class="cl-expansion-inputs">${range('cl-pressure', 'Hypothetical pressure drop', 0, 200, 5, 30, ' Pa')}${range('cl-efficiency', 'Overall fan efficiency', 10, 100, 5, 50, '%')}</div><div id="cl-expansion-result" class="cl-expansion-result" aria-live="polite"></div><p class="cl-help">Dry air at 303 K, 101325 Pa absolute pressure, 180 m³/h flow. All fan input energy is assumed to end up in the air. These Pa inputs are unrelated to the plan-view relative pressure index.</p><a href="https://www.grc.nasa.gov/www/k-12/airplane/isentrop.html" target="_blank" rel="noopener">NASA ideal isentropic relations</a></div></details></div>
  </section>`;

  const disclosure = (id: string, label: string, className: string) => {
    const details = document.createElement('details');
    details.id = id; details.className = className;
    const summary = document.createElement('summary'); summary.textContent = label;
    details.append(summary);
    return details;
  };
  const form = $('#cl-form');
  const [comparison, setup, weather, openings, envelope] = [...form.querySelectorAll<HTMLElement>(':scope > section')];
  const more = disclosure('cl-more-settings', 'Weather, openings & advanced comparisons', 'cl-more-settings');
  const fanSettings = document.createElement('section');
  const fanHeading = document.createElement('h3'); fanHeading.textContent = 'Fan rating and test length';
  fanSettings.append(fanHeading);
  let fanControl: ChildNode | null = $('#cl-flow').closest('label');
  while (fanControl) {
    const next = fanControl.nextSibling;
    fanSettings.append(fanControl);
    fanControl = next;
  }
  setup.append($('#cl-environment'), $('#cl-recapture'));
  more.append(comparison, fanSettings, weather, openings, envelope);
  form.prepend(setup, more);
  const resultDetails = disclosure('cl-result-details', 'Air exchange and heat balance', 'cl-result-details');
  const resultBottom = $('.cl-result-bottom');
  resultBottom.before(resultDetails); resultDetails.append(resultBottom);
  $('.cl-visuals').hidden = true; resultDetails.hidden = true;
  const about = disclosure('cl-about-test', 'About this test', 'cl-learning cl-about-test');
  const learning = $('.cl-learning-grid');
  for (const details of [...learning.querySelectorAll<HTMLDetailsElement>(':scope > details')]) {
    const section = document.createElement('section'); section.className = details.className;
    const summary = details.querySelector('summary')!;
    const heading = document.createElement('h3'); heading.textContent = summary.textContent;
    summary.replaceWith(heading);
    section.append(...details.childNodes); about.append(section);
  }
  learning.replaceWith(about);

  function setStatus(message: string, state: 'idle' | 'working' | 'error' | 'success' = 'idle'): void {
    $('#cl-status').textContent = message;
    $('#cl-status').dataset.state = state;
  }

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
    if (preset) {
      Object.assign(base, structuredClone(preset.conditions), { doors: base.doors, windows: base.windows, devices: base.devices, portableFan: base.portableFan, purifier: base.purifier, acSetpoint: base.acSetpoint });
      if (!preset.conditions.windFrom) delete base.windFrom;
    }
    const route = $<HTMLSelectElement>('#cl-route').value;
    if (route === 'custom' && openingOverrides) {
      base.windows = { ...openingOverrides.windows }; base.doors = { ...openingOverrides.doors };
    } else if (route === 'open' || route === 'sealed') {
      for (const id of Object.keys(base.windows)) base.windows[id] = route === 'open';
      for (const box of model.boxes) if (box.type === 'door') base.doors[box.name] = route === 'open' && !box.exterior;
    }
    if (purifierOverride) base.purifier = { ...purifierOverride };
    Object.assign(base.devices, deviceOverrides);
    Object.assign(base, weatherOverrides);
    return base;
  }
  function sync(): void {
    config.base = buildBase();
    const direction = config.base.windFrom ?? 'scenario direction';
    $('#cl-environment').textContent = `${config.base.outdoorTemperature}°C outdoors · ${config.base.outdoorPm25} µg/m³ PM2.5 · ${config.base.humidity}% RH · ${config.base.windSpeed} m/s from ${direction}`;
    $<HTMLInputElement>('#cl-outdoor-temperature').value = String(config.base.outdoorTemperature);
    $<HTMLInputElement>('#cl-outdoor-pm25').value = String(config.base.outdoorPm25);
    const aqi = pm25ToUsAqiEquivalent(config.base.outdoorPm25);
    $('#cl-aqi-equivalent').textContent = `US EPA PM2.5 index equivalent (24-hour scale): ${aqi === null ? 'outside the supported scale' : aqi}. Scenario equivalent only; not Singapore PSI or live AQI.`;
    $<HTMLInputElement>('#cl-wind-speed').value = String(config.base.windSpeed);
    $<HTMLSelectElement>('#cl-wind-from').value = config.base.windFrom ?? '';
    const purifier = config.base.purifier ?? { on: false, slot: 0 };
    $<HTMLInputElement>('#cl-purifier-on').checked = purifier.on;
    $<HTMLSelectElement>('#cl-purifier-slot').value = String(purifier.slot);
    container.querySelectorAll<HTMLInputElement>('[data-opening-id]').forEach(input => {
      const id = input.dataset.openingId!;
      input.checked = Boolean(config.base.windows[id] ?? config.base.doors[id]);
      input.disabled = id === config.vent.opening;
    });
    container.querySelectorAll<HTMLInputElement>('[data-fixed-purifier]').forEach(input => { input.checked = Boolean(config.base.devices[input.dataset.fixedPurifier!]); });
    const general = comparisonMode === 'configuration';
    $('#cl-baseline-controls').hidden = !general;
    $('#cl-fan-on-control').hidden = !general;
    $<HTMLInputElement>('#cl-fan-on').checked = config.vent.on;
    $('#cl-corridor-fields').hidden = !config.corridor?.enabled;
    $<HTMLButtonElement>('#cl-run').disabled = running || (general && !baseline);
    $('#cl-run').textContent = running ? 'Comparing…' : runFailed ? 'Retry comparison' : general ? 'Compare baseline / candidate' : 'Compare fan off / on';
    $('#cl-fairness-title').textContent = general ? 'Matched shared conditions' : 'One controlled change';
    $('#cl-fairness-copy').textContent = general ? 'Baseline captures interventions only. Current weather, corridor conditions, scenario initial temperatures and duration apply identically to both trials.' : 'Identical initial air and surface temperatures, weather, openings and devices. Only the installed vent fan changes.';
    $('#cl-comparison-description').textContent = general ? 'Candidate minus baseline. Negative temperature or PM2.5 differences mean a reduction.' : 'Captured lab setup · fan on minus fan off. Negative temperature differences mean cooler air.';
    if (baseline) {
      const open = Object.values(baseline.base.windows).filter(Boolean).length + Object.values(baseline.base.doors).filter(Boolean).length;
      $('#cl-baseline-status').textContent = `Baseline saved: ${open} open controls, vent fan ${baseline.vent.on ? 'on' : 'off'}, portable purifier ${baseline.base.purifier?.on ? 'on' : 'off'}. Change candidate settings, then compare. Shared weather remains editable.`;
      $('#cl-capture-baseline').textContent = 'Replace baseline with current candidate';
    }
    $('#cl-duration-label').textContent = `${config.durationSeconds / 60} minutes`;
    container.querySelectorAll<HTMLInputElement>('.cl-range input').forEach(input => {
      $(`#${input.id}-value`).textContent = `${Number(input.value)}${input.dataset.unit}`;
    });
    options.onVentChange?.({ ...config.vent, on: comparisonMode === 'fan-toggle' || config.vent.on });
    refreshCaptureStatus();
  }
  function clearReport(message: string): void {
    request++; runner.cancel(); running = false; runFailed = false; report = null;
    $<HTMLButtonElement>('#cl-run').disabled = comparisonMode === 'configuration' && !baseline;
    $('#cl-cancel').hidden = true; $('#cl-progress').hidden = true;
    $('#cl-view-results').hidden = true; $('.cl-visuals').hidden = true; $('#cl-result-details').hidden = true;
    $('#cl-results').setAttribute('aria-busy', 'false'); $('#cl-export-status').textContent = '';
    $<HTMLButtonElement>('#cl-export').disabled = true;
    setStatus(message);
    $('#cl-run').textContent = comparisonMode === 'configuration' ? 'Compare baseline / candidate' : 'Compare fan off / on';
    $('#cl-summary').innerHTML = '<p class="cl-empty">No current result. Compare again to use the current settings.</p>';
    $('#cl-chart').innerHTML = '<p class="cl-empty">New paired traces appear after the comparison.</p>';
    $('#cl-cross-section').innerHTML = '<p class="cl-empty">The selected room’s final state in the second trial will appear here.</p>';
    $('#cl-flow-result').innerHTML = '<p class="cl-empty">Actual exchange will be calculated from the configured route.</p>';
    $('#cl-budget').innerHTML = '<p class="cl-empty">A new comparison will show the heat budget.</p>';
    $('#cl-compared-inputs').replaceChildren();
  }
  const roomReading = (snapshot: ThermalSnapshot, room: string): ThermalRoomReading => {
    const reading = snapshot.rooms.find(reading => reading.room === room);
    if (!reading) throw new Error(`No thermal result for ${roomLabel(room)}.`);
    return reading;
  };
  function chart(result: ThermalComparisonResult, room: string): string {
    const [before, after] = caseLabels(result);
    const off = result.off.samples.map(sample => ({ time: sample.elapsedSeconds, value: roomReading(sample, room).lowerTemperature }));
    const on = result.on.samples.map(sample => ({ time: sample.elapsedSeconds, value: roomReading(sample, room).lowerTemperature }));
    const values = [...off, ...on].map(point => point.value);
    const min = Math.floor((Math.min(...values) - 0.15) * 2) / 2;
    const max = Math.ceil((Math.max(...values) + 0.15) * 2) / 2;
    const x = (time: number) => 46 + time / result.durationSeconds * 416;
    const y = (temperature: number) => 180 - (temperature - min) / (max - min) * 146;
    const path = (points: { time: number; value: number }[]) => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(2)} ${y(point.value).toFixed(2)}`).join(' ');
    return `<svg viewBox="0 0 490 225" role="img" aria-labelledby="cl-chart-title cl-chart-desc"><title id="cl-chart-title">${roomLabel(room)} occupied-layer temperatures, ${before} versus ${after}</title><desc id="cl-chart-desc">Both trials start at ${number(off[0].value)} degrees Celsius. At ${result.durationSeconds / 60} minutes, ${before} is ${number(off.at(-1)!.value)} and ${after} is ${number(on.at(-1)!.value)} degrees Celsius.</desc>${[0, 1, 2, 3].map(tick => { const value = min + (max - min) * tick / 3; return `<line x1="46" x2="462" y1="${y(value)}" y2="${y(value)}" class="cl-gridline"/><text x="38" y="${y(value) + 4}" text-anchor="end">${number(value)}</text>`; }).join('')}${[0, 1, 2, 3, 4].map(tick => `<text x="${x(result.durationSeconds * tick / 4)}" y="203" text-anchor="middle">${number(result.durationSeconds * tick / 240, 0)}</text>`).join('')}<text x="12" y="18">°C</text><text x="254" y="222" text-anchor="middle">Simulated minutes</text><path data-cl-series="off" d="${path(off)}" class="cl-trace-off"/><path data-cl-series="on" d="${path(on)}" class="cl-trace-on"/></svg><p class="cl-chart-values">${roomLabel(room)} at ${result.durationSeconds / 60} min: ${before} <strong>${number(off.at(-1)!.value)}°C</strong> / ${after} <strong>${number(on.at(-1)!.value)}°C</strong>.</p>`;
  }
  function crossSection(reading: ThermalRoomReading, result: ThermalComparisonResult): string {
    const [, after] = caseLabels(result);
    const actualFlow = result.on.final.actualVentM3h;
    const hasFlow = Math.abs(actualFlow) >= 0.1;
    const backflow = actualFlow < 0;
    const outward = (result.config.vent.mode === 'exhaust') !== backflow;
    const flowLabel = !hasFlow ? 'No exchange' : backflow ? 'Backflow' : result.config.vent.mode === 'exhaust' ? 'Exhaust' : 'Supply';
    return `<svg viewBox="0 0 420 232" role="img" aria-labelledby="cl-section-svg-title cl-section-svg-desc"><title id="cl-section-svg-title">${roomLabel(reading.room)} final ${after.toLowerCase()} thermal nodes</title><desc id="cl-section-svg-desc">Lower air ${number(reading.lowerTemperature)} degrees Celsius, upper air ${number(reading.upperTemperature)}, surface ${number(reading.surfaceTemperature)}. Vent flow: ${flowLabel.toLowerCase()}, ${number(Math.abs(actualFlow))} cubic metres per hour. The illustration is schematic.</desc><defs><marker id="cl-vent-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#386f62"/></marker></defs><rect x="38" y="26" width="300" height="166" fill="#e5eee7" rx="3"/><path d="M38 26H338V103H38Z" fill="#f2e5ce"/><path d="M38 103H338" stroke="#bbc9bc" stroke-dasharray="5 5"/><path d="M30 192V18H346V192" fill="none" stroke="#80988a" stroke-width="12"/><path d="M29 196H348" stroke="#80988a" stroke-width="10"/><text x="64" y="55">Upper air</text><text x="64" y="84" class="cl-node-number">${number(reading.upperTemperature)}°C</text><text x="64" y="131">Occupied / lower air</text><text x="64" y="163" class="cl-node-number">${number(reading.lowerTemperature)}°C</text><path d="M267 146V68" stroke="#b18e58" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#cl-vent-arrow)"/><text x="280" y="122"><tspan>Layer</tspan><tspan x="280" dy="16">exchange</tspan></text><circle cx="338" cy="55" r="15" fill="#fff" stroke="#386f62" stroke-width="2"/>${hasFlow ? `<path data-cl-vent-flow="${backflow ? 'backflow' : 'forward'}" d="M${outward ? '315 55H399' : '399 55H315'}" stroke="#386f62" stroke-width="3" marker-end="url(#cl-vent-arrow)"/>` : ''}<text x="358" y="89" text-anchor="middle">${flowLabel}</text><text x="211" y="222" text-anchor="middle">Surface ${number(reading.surfaceTemperature)}°C</text></svg>`;
  }
  function renderResult(result: ThermalComparisonResult): void {
    const [before, after] = caseLabels(result);
    const room = THERMAL_OPENINGS.find(opening => opening.name === result.candidateConfig.vent.opening)!.room;
    const on = roomReading(result.on.final, room);
    const metrics = [
      ['Whole-flat air temperature', signed(result.difference.averageTemperature, 2), '°C'],
      ['Whole-flat PM2.5 change', signed(result.difference.averagePm25, 2), 'µg/m³'],
      ['PM exposure change', signed(result.difference.pmExposureUgHoursM3, 2), 'µg·h/m³'],
      ['Total electricity change', signed(result.difference.energyWh, 2), 'Wh'],
    ];
    $('#cl-summary').innerHTML = metrics.map(([label, value, unit]) => `<div class="cl-metric"><span>${label}</span><strong>${value}<small>${unit}</small></strong><em>SIMULATED</em></div>`).join('');
    $('#cl-chart').innerHTML = chart(result, room);
    $('.cl-line-off').textContent = before; $('.cl-line-on').textContent = after;
    $('#cl-section-title').textContent = `${roomLabel(room)} · ${after.toLowerCase()}`;
    $('#cl-cross-section').innerHTML = crossSection(on, result);
    const shared = result.candidateConfig;
    const corridor = shared.corridor?.enabled ? `Main-door corridor: ${number(shared.corridor.temperature)}°C, ${number(shared.corridor.pm25)} µg/m³ PM2.5; fixed sheltered boundary.` : 'Main door uses outdoor conditions.';
    $('#cl-compared-inputs').innerHTML = `<details open><summary>Compared inputs · ${result.variedSettings.length} controlled changes</summary><p class="cl-help">Shared: ${shared.base.outdoorTemperature}°C outdoors, ${shared.base.outdoorPm25} µg/m³ PM2.5, wind ${shared.base.windSpeed} m/s from ${shared.base.windFrom ?? 'the scenario direction'}, ${result.durationSeconds / 60} minutes. Identical scenario initial temperatures and particles. ${corridor}</p><div class="cl-table-scroll"><table><thead><tr><th scope="col">Changed setting</th><th scope="col">${before}</th><th scope="col">${after}</th></tr></thead><tbody>${result.variedSettings.map(setting => `<tr><th scope="row">${escape(setting.label)}</th><td>${escape(setting.baseline)}</td><td>${escape(setting.candidate)}</td></tr>`).join('') || '<tr><td colspan="3">Identical intervention settings. Equal results are expected.</td></tr>'}</tbody></table></div></details>`;
    const actual = result.on.final.actualVentM3h;
    const flowNote = actual < -0.1 ? 'Backflow: the solved flow opposes the commanded fan direction.' : Math.abs(actual) < 0.1 ? 'Exchange is effectively blocked. Try opening a connected make-up route.' : 'The current opening network allows exchange. Actual flow includes wind and opening restrictions.';
    const rows: [string, number, number, string, number][] = [
      ['Rated vent flow', result.baselineConfig.vent.ratedM3h, shared.vent.ratedM3h, 'm³/h', 0],
      ['Actual vent flow', result.off.final.actualVentM3h, actual, 'm³/h', 1],
      ['Boundary air changes', result.off.final.airChangesPerHour, result.on.final.airChangesPerHour, 'h⁻¹', 2],
      ['Vent fan input power', result.off.final.fanPowerWatts, result.on.final.fanPowerWatts, 'W', 1],
      ['Vent fan electricity', result.off.final.fanEnergyWh, result.on.final.fanEnergyWh, 'Wh', 2],
      ['Total electricity', result.off.final.energyWh, result.on.final.energyWh, 'Wh', 2],
      ['Sensible heat removed, final rate', result.off.final.sensibleHeatRemovedWatts, result.on.final.sensibleHeatRemovedWatts, 'W', 1],
      ['Ventilation heat removed, cumulative', result.off.final.ventilationHeatRemovedJ / 3600, result.on.final.ventilationHeatRemovedJ / 3600, 'Wh', 2],
      ['PM exposure', result.off.pmExposureUgHoursM3, result.on.pmExposureUgHoursM3, 'µg·h/m³', 2],
    ];
    $('#cl-flow-result').innerHTML = `<div class="cl-table-scroll"><table><thead><tr><th scope="col">Exchange & energy</th><th scope="col">${before}</th><th scope="col">${after}</th></tr></thead><tbody>${rows.map(([label, left, right, unit, decimals]) => `<tr><th scope="row">${label}<small class="cl-unit">${unit}</small></th><td>${number(left, decimals)}</td><td>${number(right, decimals)}</td></tr>`).join('')}</tbody></table></div><p class="cl-help">${flowNote} Positive vent flow follows each trial’s chosen direction. Negative heat removed means heat imported. Air changes count boundary inflow once, including the corridor when enabled; this is not purifier clean-air delivery.</p><p class="cl-help">Vent fan electricity is separate from total electricity, which also includes captured fans, purifiers and AC. The heat figures describe ventilation heat transfer, not a cooling-efficiency rating.</p><p class="cl-caveat">Outdoor air is ${shared.base.outdoorTemperature}°C, ${shared.base.humidity}% RH and ${shared.base.outdoorPm25} µg/m³ PM2.5. Ventilation may bring heat, moisture or haze inside. Moisture loads are not calculated. PM exposure is a concentration integral, not inhaled dose.</p>`;
    const convection = (snapshot: ThermalSnapshot) => snapshot.rooms.reduce((sum, reading) => sum + reading.wallToAirWatts, 0);
    $('#cl-budget').innerHTML = `<p class="cl-help">Final heat rates in W. Positive adds heat; negative removes it.</p><div class="cl-table-scroll"><table><thead><tr><th scope="col">Mechanism</th><th scope="col">${before}</th><th scope="col">${after}</th></tr></thead><tbody>${budgetLabels.map(([key, label]) => `<tr><th scope="row">${label}</th><td>${signed(result.off.final.heatBudgetW[key])}</td><td>${signed(result.on.final.heatBudgetW[key])}</td></tr>`).join('')}<tr class="cl-net"><th scope="row">Net external + source heat</th><td>${signed(result.off.final.heatBudgetW.net)}</td><td>${signed(result.on.final.heatBudgetW.net)}</td></tr></tbody></table></div><p class="cl-help">Surface-to-air convection: ${signed(convection(result.off.final))} W ${before.toLowerCase()} / ${signed(convection(result.on.final))} W ${after.toLowerCase()}. This redistributes heat inside the flat and is not added again to the net heat budget.</p><p class="cl-help">Stored-energy difference: ${signed(result.difference.storedEnergyJ / 1000, 2)} kJ ${after.toLowerCase()} minus ${before.toLowerCase()}. These final rates are not the time-integrated energy balance.</p>`;
    $<HTMLButtonElement>('#cl-export').disabled = false;
    $('.cl-visuals').hidden = false; $('#cl-result-details').hidden = false; $('#cl-view-results').hidden = false;
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
    if (comparisonMode === 'configuration' && !baseline) {
      $('#cl-status').textContent = 'Capture a baseline first, then adjust candidate settings.'; $('#cl-capture-baseline').focus(); return;
    }
    sync();
    clearReport('Starting a fresh matched comparison.');
    const frozen = structuredClone(config);
    const token = ++request;
    running = true; report = null;
    $<HTMLButtonElement>('#cl-run').disabled = true; $<HTMLButtonElement>('#cl-export').disabled = true;
    $('#cl-run').textContent = 'Comparing…'; $('#cl-results').setAttribute('aria-busy', 'true');
    $('#cl-summary').innerHTML = '<p class="cl-empty">Comparing both trials from the same starting conditions. You can cancel or change the settings.</p>';
    $('#cl-cancel').hidden = false; $('#cl-progress').hidden = false;
    $<HTMLProgressElement>('#cl-progress').value = 0;
    setStatus(comparisonMode === 'configuration' ? 'Running matched baseline and candidate trials…' : 'Running matched fan-off and fan-on trials…', 'working');
    try {
      const onProgress = (progress: ThermalComparisonProgress) => {
        if (token !== request) return;
        $<HTMLProgressElement>('#cl-progress').value = progress.total > 0 ? progress.done / progress.total * 100 : 0;
        $('#cl-progress').setAttribute('aria-valuetext', `${number(progress.elapsedSeconds / 60, 1)} of ${frozen.durationSeconds / 60} simulated minutes`);
        $('#cl-status').textContent = `Comparing both trials: ${number(progress.elapsedSeconds / 60, 1)} / ${frozen.durationSeconds / 60} simulated minutes.`;
      };
      const result = comparisonMode === 'configuration' && baseline ? await runner.compare(structuredClone(baseline), frozen, onProgress) : await runner.run(frozen, onProgress);
      if (token !== request) return;
      report = result; renderResult(result);
      setStatus(`Comparison complete: ${result.durationSeconds / 60} simulated minutes per trial. View the results or download the CSV.`, 'success');
    } catch (error) {
      if (token !== request) return;
      runFailed = !(error instanceof DOMException && error.name === 'AbortError');
      setStatus(runFailed ? `${error instanceof Error ? error.message : 'The comparison could not finish.'} Your settings are saved here. Select Retry comparison to try again.` : 'Comparison cancelled. Your settings are retained.', runFailed ? 'error' : 'idle');
      $('#cl-summary').innerHTML = '<p class="cl-empty">No result was produced. Your settings are retained; run the comparison again when ready.</p>';
    } finally {
      if (token === request) { running = false; $('#cl-cancel').hidden = true; $('#cl-progress').hidden = true; $('#cl-results').setAttribute('aria-busy', 'false'); sync(); }
    }
  }
  function change(input: HTMLInputElement | HTMLSelectElement): void {
    if (input.id === 'cl-pressure' || input.id === 'cl-efficiency') {
      $(`#${input.id}-value`).textContent = `${Number(input.value)}${input.dataset.unit}`; renderExpansion(); return;
    }
    if (!input.dataset.cl) return;
    const checked = input instanceof HTMLInputElement && input.checked;
    if (input.dataset.openingId) {
      openingOverrides = { windows: { ...config.base.windows }, doors: { ...config.base.doors } };
      const id = input.dataset.openingId;
      openingOverrides[id.startsWith('window_') ? 'windows' : 'doors'][id] = checked;
      $<HTMLSelectElement>('#cl-route').value = 'custom';
    }
    if (input.dataset.fixedPurifier) deviceOverrides[input.dataset.fixedPurifier] = checked;
    if (input.id.startsWith('cl-corridor-')) {
      config.corridor ??= { enabled: false, temperature: Number($<HTMLInputElement>('#cl-corridor-temperature').value), pm25: Number($<HTMLInputElement>('#cl-corridor-pm25').value) };
      if (input.id === 'cl-corridor-enabled') config.corridor.enabled = checked;
      if (input.id === 'cl-corridor-temperature') config.corridor.temperature = Number(input.value);
      if (input.id === 'cl-corridor-pm25') config.corridor.pm25 = Number(input.value);
    }
    switch (input.id) {
      case 'cl-comparison-mode': comparisonMode = input.value as 'fan-toggle' | 'configuration'; if (comparisonMode === 'fan-toggle') config.vent.on = true; break;
      case 'cl-fan-on': config.vent.on = checked; break;
      case 'cl-scenario': weatherOverrides = {}; break;
      case 'cl-outdoor-temperature': weatherOverrides.outdoorTemperature = Number(input.value); break;
      case 'cl-outdoor-pm25': weatherOverrides.outdoorPm25 = Number(input.value); break;
      case 'cl-wind-speed': weatherOverrides.windSpeed = Number(input.value); break;
      case 'cl-wind-from': weatherOverrides.windFrom = input.value ? input.value as Conditions['windFrom'] : undefined; break;
      case 'cl-route': if (input.value === 'custom' && !openingOverrides) openingOverrides = { windows: { ...config.base.windows }, doors: { ...config.base.doors } }; break;
      case 'cl-purifier-on': purifierOverride = { ...(config.base.purifier ?? { on: false, slot: 0 }), on: checked }; break;
      case 'cl-purifier-slot': purifierOverride = { ...(config.base.purifier ?? { on: false, slot: 0 }), slot: Number(input.value) }; break;
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
  container.addEventListener('change', event => { const input = event.target as HTMLSelectElement | HTMLInputElement; if (input.matches('select[data-cl], input[type="checkbox"][data-cl]')) change(input); }, { signal: events.signal });
  $('#cl-cancel').addEventListener('click', () => { clearReport('Comparison cancelled. Your flat setup is unchanged.'); $('#cl-run').focus(); }, { signal: events.signal });
  $('#cl-view-results').addEventListener('click', () => { $('#cl-results').focus({ preventScroll: true }); $('#cl-results').scrollIntoView({ block: 'start' }); }, { signal: events.signal });
  $('#cl-recapture').addEventListener('click', () => {
    capturedBase = structuredClone(options.readConditions());
    weatherOverrides = {}; openingOverrides = null; purifierOverride = undefined; deviceOverrides = {};
    $<HTMLSelectElement>('#cl-scenario').value = 'captured'; $<HTMLSelectElement>('#cl-route').value = 'captured';
    clearReport('Fresh flat settings captured. Run to compare from the scenario’s initial temperatures.'); sync();
  }, { signal: events.signal });
  $('#cl-capture-baseline').addEventListener('click', () => {
    sync(); baseline = structuredClone(config);
    clearReport('Baseline captured. Adjust candidate interventions; current shared conditions apply to both trials.'); sync();
  }, { signal: events.signal });
  $('#cl-reset-weather').addEventListener('click', () => {
    weatherOverrides = {}; clearReport('Manual weather overrides reset. Interventions and captured baseline are unchanged.'); sync();
  }, { signal: events.signal });
  $('#cl-export').addEventListener('click', () => {
    if (!report) return;
    try {
      const url = URL.createObjectURL(new Blob([thermalComparisonCsv(report)], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `heatsim-cooling-${report.durationSeconds / 60}min.csv`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('#cl-export-status').textContent = 'CSV download started. It includes both trials and the settings used.';
      $('#cl-export-status').dataset.state = 'success';
    } catch (error) { $('#cl-export-status').textContent = `${error instanceof Error ? error.message : 'The CSV download could not start.'} Your result is retained. Try Export comparison CSV again.`; $('#cl-export-status').dataset.state = 'error'; }
  }, { signal: events.signal });
  $('#cl-opening-controls').innerHTML = model.boxes.filter(box => box.type === 'window' || box.type === 'door').map(box => `<label class="cl-check"><input type="checkbox" data-cl="opening-state" data-opening-id="${box.name}"><span>${escape(openingLabel(box.name))}</span></label>`).join('');
  $('#cl-fixed-purifiers').innerHTML = Object.keys(deviceRoom).filter(id => id.startsWith('purifier_')).map(id => `<label class="cl-check"><input type="checkbox" data-cl="fixed-purifier" data-fixed-purifier="${id}"><span>${roomLabel(deviceRoom[id])} fixed purifier</span></label>`).join('');
  updateOpenings(); sync(); renderExpansion();
  return { refreshCaptureStatus, readPreviewConditions: () => structuredClone(config.base), dispose() { request++; events.abort(); runner.dispose(); options.onVentChange?.(null); } };
}
