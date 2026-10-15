import './contractor-study.css';
import type { Conditions } from './domain';
import { PRESETS, SCENARIOS } from './simulation';
import { parseContractorPlan, previewOpeningSegment, contractorPlanGeometryId, CONTRACTOR_EXAMPLES, CONTRACTOR_PLAN_SCHEMA, type ContractorPlan } from './contractor-plan';
import { createContractorComparisonRunner, type ContractorComparisonResult, type ContractorStudyConfig } from './contractor-comparison';
import { contractorStudyHtml, contractorStudyJson } from './contractor-export';
import type { ThermalSnapshot } from './thermal-types';
import { bindContractorPlacement, contractorPreviewProjection, moveContractorDevice } from './contractor-placement';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const display = (value: number, places = 1) => Number.isFinite(value) ? value.toFixed(places) : 'Unavailable';
const palette = ['#286d60', '#a57538', '#5e6da2'];
const MAX_FILE_BYTES = 500_000;

export function mountContractorStudy(container: HTMLElement, options: { readConditions(): Conditions }): { dispose(): void } {
  const initialWeather = structuredClone(options.readConditions());
  let studyScenarioId = initialWeather.scenarioId;
  const scenario = SCENARIOS.find(item => item.id === initialWeather.scenarioId) ?? SCENARIOS[0];
  const runner = createContractorComparisonRunner();
  const events = new AbortController();
  const plans: (ContractorPlan | null)[] = [null, null, null];
  const importTokens = [0, 0, 0];
  const pendingFiles = [false, false, false];
  const objectUrls = new Set<string>();
  let examplesAbort: AbortController | null = null;
  let report: ContractorComparisonResult | null = null;
  let generation = 0;
  let running = false;
  let runFailed = false;
  let disposed = false;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const node = container.querySelector<T>(selector);
    if (!node) throw new Error(`Missing study control ${selector}`);
    return node;
  };
  const field = (id: string, label: string, value: string | number, type = 'text', attributes = '') => `<label class="cs-field" for="${id}"><span>${label}</span><input id="${id}" data-study-field type="${type}" value="${escape(String(value))}" ${attributes}></label>`;

  container.innerHTML = `<section class="contractor-study" aria-labelledby="cs-title">
    <header class="cs-hero"><h2 id="cs-title" class="cs-accessible-title">Compare floor plans</h2><div class="cs-positioning"><p>A rough room-by-room model for comparing ideas. It does not predict exact temperatures or replace a home assessment.</p></div></header>
    <div class="cs-grid"><form id="cs-brief" class="cs-brief" aria-label="Shared floor plan comparison settings">
      <section><div class="cs-step-title"><span>01</span><h3>Name and location</h3></div>
        ${field('cs-project', 'Comparison name', 'My floor plan comparison', 'text', 'maxlength="120" required')}
        ${field('cs-location', 'Location label', '', 'text', 'maxlength="160" placeholder="Estate, district or hypothetical site"')}
        <div class="cs-field-pair">${field('cs-latitude', 'Latitude', '', 'number', 'min="-90" max="90" step="any" placeholder="1.3521"')}${field('cs-longitude', 'Longitude', '', 'number', 'min="-180" max="180" step="any" placeholder="103.8198"')}</div>
        <a id="cs-windy" class="cs-link" target="_blank" rel="noopener noreferrer" aria-disabled="true">Open this location in Windy ↗</a><p class="cs-help">Coordinates identify the weather reference location. Optional Windy display is separate from the model: copy the chosen forecast values into the shared inputs.</p>
      </section><section><h3>Weather applied to all three plans</h3>
        <div class="cs-field-pair">${field('cs-temperature', 'Outdoor temperature · °C', initialWeather.outdoorTemperature, 'number', 'min="10" max="60" step="0.1" required')}${field('cs-pm25', 'Outdoor PM2.5 · µg/m³', initialWeather.outdoorPm25, 'number', 'min="0" max="1000" step="0.1" required')}</div>
        <div class="cs-field-pair">${field('cs-wind-speed', 'Reference wind · m/s', initialWeather.windSpeed, 'number', 'min="0" max="10" step="0.1" required')}<label class="cs-field" for="cs-wind-from"><span>Wind coming from</span><select id="cs-wind-from" data-study-field>${(['N', 'E', 'S', 'W'] as const).map(direction => `<option ${direction === (initialWeather.windFrom ?? scenario.windward) ? 'selected' : ''}>${direction}</option>`).join('')}</select></label></div>
        <div class="cs-field-pair">${field('cs-humidity', 'Relative humidity · %', initialWeather.humidity, 'number', 'min="0" max="100" step="1" required')}${field('cs-hour', 'Shared local hour', initialWeather.timeOfDay, 'number', 'min="0" max="23.9" step="0.1" required')}</div>
        <p class="cs-help">Wind direction is geographical. Each plan’s north orientation maps it to the correct façades. Humidity is recorded; latent moisture loads are not solved.</p>
        <details class="cs-details" open><summary>Source & reference assumptions</summary><label class="cs-field" for="cs-source-type"><span>Input provenance</span><select id="cs-source-type" data-study-field><option value="assumption">Illustrative assumption</option><option value="forecast">Copied forecast</option><option value="observation">Manually entered observation</option></select></label>
        ${field('cs-source-name', 'Provider / source', '', 'text', 'maxlength="160" placeholder="For example, Windy or a site log"')}${field('cs-source-model', 'Forecast model / observation method', '', 'text', 'maxlength="160" placeholder="Record the model shown by your source"')}${field('cs-source-url', 'Source URL (optional)', '', 'url', 'maxlength="500" placeholder="https://…"')}${field('cs-valid-time', 'Forecast / observation valid time', '', 'datetime-local')}${field('cs-time-zone', 'Time zone for that time', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Singapore', 'text', 'maxlength="80"')}${field('cs-reference-height', 'Wind reference height · m', 10, 'number', 'min="0.1" max="1000" step="0.1" required')}
        <p class="cs-help">A 10 m reference forecast is not a measurement at an apartment window. Sheltering, building height and local obstructions require on-site verification.</p></details>
      </section><section><h3>Matched starting conditions</h3><div class="cs-field-pair">${field('cs-initial-temperature', 'Initial indoor air & surface · °C', scenario.initialTemperature, 'number', 'min="10" max="60" step="0.1" required')}${field('cs-initial-pm25', 'Initial indoor PM2.5 · µg/m³', scenario.initialPm25, 'number', 'min="0" max="1000" step="0.1" required')}</div><div class="cs-field-pair">${field('cs-occupancy', 'People per plan', 4, 'number', 'min="0" max="100" step="1" required')}<label class="cs-field" for="cs-duration"><span>Simulated duration</span><select id="cs-duration" data-study-field><option value="600">10 minutes</option><option value="1200" selected>20 minutes</option><option value="1800">30 minutes</option></select></label></div><p class="cs-help">All plans start at the same temperatures and particle concentration. The same total occupancy is distributed by room area. Equipment and opening states remain specific to each plan.</p></section>
    </form><div class="cs-main"><details class="cs-weather-reference"><summary>Optional Windy weather reference</summary><p class="cs-help">This external map is a reference for the educational prototype. Copy wind, temperature and forecast source/time into the shared brief. Loading the map does not change simulation inputs.</p><button id="cs-load-windy" class="cs-button cs-secondary" type="button" disabled>Show Windy at these coordinates</button><p id="cs-windy-status" class="cs-help" role="status">Enter latitude and longitude in the location fields to load the map.</p><a id="cs-windy-fallback" class="cs-link" target="_blank" rel="noopener noreferrer" hidden>Open weather reference in Windy ↗</a><div id="cs-windy-map"></div></details><section class="cs-plan-section" aria-labelledby="cs-plans-title"><div class="cs-section-heading"><div class="cs-step-title"><span>02</span><div><h3 id="cs-plans-title">Three actual floor plans</h3><p>Upload the supported JSON room-and-opening format, or start with the examples.</p></div></div><button id="cs-load-examples" class="cs-button cs-primary" type="button">Load 3 example plans</button></div><div class="cs-format-note"><span>Rectangular rooms · metres · explicit openings · north orientation</span><button id="cs-schema" class="cs-text-button" type="button">Download JSON schema</button></div><p class="cs-help cs-format-copy">These inputs describe geometry and connections. Images, PDFs and scanned drawings are not automatically converted. The examples are illustrative layouts, not surveyed properties.</p><p id="cs-preview-key" class="cs-help cs-preview-key">Geometry view · blue windows, amber doors. F = fan, P = purifier, A = air conditioning. Appliance moves snap to a room.</p><div class="cs-plan-cards">${[0, 1, 2].map(index => `<article class="cs-plan-card" data-study-plan="${index}"><header><span class="cs-plan-letter" style="--plan-color:${palette[index]}">${String.fromCharCode(65 + index)}</span><h4 id="cs-plan-name-${index}">Add a floor plan</h4></header><div id="cs-preview-${index}" class="cs-preview"><p>Choose a JSON plan for this slot, or load the examples above.</p></div><div id="cs-plan-meta-${index}" class="cs-plan-meta">No plan loaded</div><label class="cs-file-label" for="cs-file-${index}">Import plan ${String.fromCharCode(65 + index)} · JSON, up to 500 KB</label><input id="cs-file-${index}" class="cs-file" data-study-file="${index}" type="file" accept=".json,application/json"><p id="cs-plan-status-${index}" class="cs-plan-status" role="status"></p><div id="cs-plan-controls-${index}"></div><button class="cs-text-button" data-study-download-plan="${index}" type="button" disabled>Download this plan JSON</button></article>`).join('')}</div></section>
      <div class="cs-run-row"><div><strong id="cs-readiness">Add three plans to compare</strong><p>Results use one shared weather case. Layout, equipment and area differences remain visible.</p></div><div class="cs-run-actions"><button id="cs-run" class="cs-button cs-primary" type="button" disabled>Compare three plans</button><button id="cs-cancel" class="cs-button cs-secondary" type="button" hidden>Cancel comparison</button><button id="cs-view-results" class="cs-button cs-secondary" type="button" hidden>View results</button></div><progress id="cs-progress" max="100" value="0" hidden aria-label="Three-plan comparison progress"></progress><p id="cs-status" role="status" aria-live="polite">Your comparison stays in this browser session. No account or board is needed.</p></div>
      <section id="cs-results" class="cs-results" aria-labelledby="cs-results-title" tabindex="-1" aria-busy="false"><div class="cs-section-heading"><div class="cs-step-title"><span>03</span><div><h3 id="cs-results-title">A shortlist with its trade-offs</h3><p id="cs-results-context">Run the three plans to compare model outputs under your shared assumptions.</p></div></div><div class="cs-export-actions"><button id="cs-export-html" class="cs-button cs-secondary" type="button" disabled>Download handoff report</button><button id="cs-export-json" class="cs-text-button" type="button" disabled>Study JSON</button></div></div><p id="cs-export-status" class="cs-export-status" role="status"></p><div id="cs-result-content"><p class="cs-empty">Start with the three example plans, or import a plan into each slot. Then compare their temperature, PM2.5 and electricity results.</p></div></section>
    </div></div>
  </section>`;

  const disclosure = (id: string, label: string) => {
    const details = document.createElement('details'); details.id = id; details.className = 'cs-disclosure';
    const summary = document.createElement('summary'); summary.textContent = label;
    details.append(summary); return details;
  };
  container.querySelectorAll('.cs-step-title > span').forEach(step => step.remove());
  $('#cs-plans-title').textContent = 'Your plans';
  $('#cs-results-title').textContent = 'What looks better for your home?';
  $('#cs-load-examples').classList.replace('cs-primary', 'cs-secondary');
  $('#cs-load-examples').textContent = 'Try the 3 example plans';
  $('#cs-export-html').textContent = 'Download comparison';
  $('#cs-export-html').title = 'Download an HTML report. Open it and choose Print to save a PDF.';
  $('#cs-export-json').textContent = 'Save comparison JSON';
  const grid = $('.cs-grid'), brief = $('#cs-brief'), planSection = $('.cs-plan-section');
  grid.prepend(planSection);
  const weatherDetails = disclosure('cs-weather-details', 'Weather source & details');
  weatherDetails.append(...brief.children, $('.cs-weather-reference'));
  const weatherQuick = document.createElement('section'); weatherQuick.className = 'cs-weather-quick';
  weatherQuick.innerHTML = `<div><h3>Weather for all three plans</h3><p id="cs-weather-summary" class="cs-help"></p></div><label class="cs-field" for="cs-scenario"><span>Choose the day</span><select id="cs-scenario" data-study-field><option value="captured">Use my flat’s weather</option>${PRESETS.filter(preset => preset.id !== 'validation').map(preset => `<option value="${escape(preset.id)}">${escape(preset.name)}</option>`).join('')}</select></label>`;
  brief.append(weatherQuick, weatherDetails);
  const validation = document.createElement('p'); validation.id = 'cs-validation'; validation.className = 'cs-validation'; validation.setAttribute('role', 'status'); validation.hidden = true;
  weatherQuick.after(validation);
  const format = disclosure('cs-plan-format', 'Plan format and limits');
  const formatNote = $('.cs-format-note'), formatCopy = $('.cs-format-copy');
  formatNote.before(format); format.append(formatNote, formatCopy);

  const input = (id: string) => $<HTMLInputElement>(`#${id}`).value;
  function setStatus(message: string, state: 'idle' | 'working' | 'error' | 'success' = 'idle'): void {
    $('#cs-status').textContent = message; $('#cs-status').dataset.state = state;
  }
  function validateBrief(): void {
    const fields = Array.from($<HTMLFormElement>('#cs-brief').querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select'));
    fields.forEach(field => field.setAttribute('aria-invalid', String(!field.validity.valid)));
    const invalid = fields.find(field => !field.validity.valid);
    $('#cs-validation').hidden = !invalid;
    $('#cs-validation').textContent = invalid ? `${invalid.closest('label')?.querySelector('span')?.textContent ?? 'Study setting'}: ${invalid.validationMessage}` : '';
  }
  function weatherSummary(): void {
    const value = (id: string) => input(id).trim() !== '' && Number.isFinite(Number(input(id))) ? input(id) : '—';
    $('#cs-weather-summary').textContent = `${value('cs-temperature')}°C outside · PM2.5 ${value('cs-pm25')} µg/m³ · wind ${value('cs-wind-speed')} m/s from ${input('cs-wind-from')}. Same weather for every plan.`;
  }
  function windLink(): void {
    const lat = input('cs-latitude'), lon = input('cs-longitude');
    const paired = (lat === '') === (lon === '');
    $<HTMLInputElement>('#cs-latitude').setCustomValidity(paired ? '' : 'Enter both coordinates, or leave both empty.');
    $<HTMLInputElement>('#cs-longitude').setCustomValidity(paired ? '' : 'Enter both coordinates, or leave both empty.');
    const valid = lat !== '' && lon !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180;
    const anchor = $<HTMLAnchorElement>('#cs-windy');
    anchor.setAttribute('aria-disabled', String(!valid));
    if (valid) anchor.href = `https://www.windy.com/${Number(lat)}/${Number(lon)}`;
    else anchor.removeAttribute('href');
    $<HTMLButtonElement>('#cs-load-windy').disabled = !valid;
    const fallback = $<HTMLAnchorElement>('#cs-windy-fallback'); fallback.hidden = !valid;
    if (valid) fallback.href = anchor.href; else fallback.removeAttribute('href');
    if (!container.querySelector('#cs-windy-map iframe')) $('#cs-windy-status').textContent = valid ? 'Load the map to inspect weather, then enter the chosen values yourself.' : 'Enter both coordinates to load Windy. Location is optional for a comparison.';
    const iframe = container.querySelector<HTMLIFrameElement>('#cs-windy-map iframe');
    if (iframe && iframe.dataset.coordinates !== `${lat},${lon}`) $('#cs-windy-map').textContent = 'Coordinates changed. Reload the weather reference to view the new location.';
  }
  function ready(): void {
    const count = plans.filter(Boolean).length;
    const loading = pendingFiles.some(Boolean) || examplesAbort !== null;
    $('#cs-readiness').textContent = running ? 'Comparing the three plans' : loading ? 'Loading plan inputs…' : count === 3 ? 'Three plans ready to compare' : `${count} of 3 plans loaded`;
    $<HTMLButtonElement>('#cs-run').disabled = count !== 3 || running || pendingFiles.some(Boolean) || examplesAbort !== null;
    $('#cs-run').textContent = running ? 'Comparing…' : runFailed ? 'Retry comparison' : 'Compare three plans';
    $('#cs-cancel').hidden = !running && !loading;
    $('#cs-cancel').textContent = loading ? 'Cancel loading' : 'Cancel comparison';
    $('#cs-load-examples').textContent = examplesAbort ? 'Loading examples…' : 'Try the 3 example plans';
    $('#cs-results').setAttribute('aria-busy', String(running));
  }
  function invalidate(message: string): void {
    generation++; runner.cancel(); running = false; runFailed = false; report = null;
    $('#cs-cancel').hidden = true; $('#cs-progress').hidden = true;
    $<HTMLButtonElement>('#cs-export-html').disabled = true; $<HTMLButtonElement>('#cs-export-json').disabled = true;
    $('#cs-view-results').hidden = true; $('#cs-export-status').textContent = '';
    $('#cs-result-content').innerHTML = '<p class="cs-empty">Inputs changed. Run a fresh comparison to produce a matching shortlist.</p>';
    $('#cs-results-context').textContent = 'Results will use the current shared conditions and all three plan configurations.';
    setStatus(message); ready();
    $('#cs-preview-key').textContent = 'Geometry view · blue windows, amber doors. F = fan, P = purifier, A = air conditioning. Appliance moves snap to a room.';
    plans.forEach((plan, index) => { if (plan) $(`#cs-preview-${index}`).innerHTML = preview(plan, index); });
  }
  function download(text: string, filename: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], { type })); objectUrls.add(url);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); objectUrls.delete(url); }, 1000);
  }
  function planArea(plan: ContractorPlan): number { return plan.rooms.reduce((sum, room) => sum + room.widthM * room.depthM, 0); }
  function preview(plan: ContractorPlan, index: number, final?: ThermalSnapshot): string {
    const { minX, minZ, width, depth, scale, offsetX, offsetY } = contractorPreviewProjection(plan);
    const x = (value: number) => offsetX + (value - minX) * scale, y = (value: number) => offsetY + (value - minZ) * scale;
    const marker = `cs-arrow-${index}`;
    return `<svg data-placement-plan="${index}" viewBox="0 0 310 240" role="img" aria-labelledby="cs-preview-title-${index} cs-preview-desc-${index}"><title id="cs-preview-title-${index}">${escape(plan.name)} geometry</title><desc id="cs-preview-desc-${index}">${plan.rooms.length} rooms, ${display(planArea(plan))} square metres, ${display(plan.heightM)} metre ceiling. Local north rotates ${display(plan.northDegrees, 0)} degrees clockwise from geographic north. ${final ? 'Arrows show solved opening exchange by air layer; this is a room-network illustration.' : 'Geometry preview, no solved flow shown.'}</desc><defs><marker id="${marker}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#26695b"/></marker></defs>${plan.rooms.map((room, roomIndex) => `<rect data-placement-room="${escape(room.id)}" x="${x(room.x)}" y="${y(room.z)}" width="${room.widthM * scale}" height="${room.depthM * scale}" fill="${roomIndex % 2 ? '#edf2e8' : '#e1ebdf'}" stroke="#7d9485" stroke-width="1.3"/><text x="${x(room.x + room.widthM / 2)}" y="${y(room.z + room.depthM / 2)}" text-anchor="middle" class="cs-room-label">${escape(room.label.length > 17 ? `${room.label.slice(0, 15)}…` : room.label)}</text>`).join('')}${plan.openings.map(opening => { const segment = previewOpeningSegment(plan, opening); const a = segment.start, b = segment.end; return `<line x1="${x(a[0])}" y1="${y(a[1])}" x2="${x(b[0])}" y2="${y(b[1])}" stroke="${opening.open ? opening.kind === 'window' ? '#5585a0' : '#aa8244' : '#394b42'}" stroke-width="3"/>`; }).join('')}${plan.devices.map(device => { const room = plan.rooms.find(room => room.id === device.roomId)!; const inRoom = plan.devices.filter(item => item.roomId === device.roomId), position = inRoom.findIndex(item => item.id === device.id), dx = (position - (inRoom.length - 1) / 2) * 17; return `<g data-placement-device="${escape(device.id)}" aria-label="${escape(device.id)} in ${escape(room.label)}"><circle cx="${x(room.x + room.widthM / 2) + dx}" cy="${y(room.z + room.depthM / 2) + 13}" r="8" fill="${device.on ? palette[index] : '#9aaca0'}"/><text x="${x(room.x + room.widthM / 2) + dx}" y="${y(room.z + room.depthM / 2) + 16}" text-anchor="middle" class="cs-device-label">${device.kind === 'purifier' ? 'P' : device.kind === 'ac' ? 'A' : 'F'}</text></g>`; }).join('')}${(final?.openingFlows ?? []).map(flow => { const opening = plan.openings.find(opening => opening.id === flow.opening); if (!opening) return ''; const segment = previewOpeningSegment(plan, opening), cx = x((segment.start[0] + segment.end[0]) / 2), cy = y((segment.start[1] + segment.end[1]) / 2), [nx, nz] = segment.normal; return [flow.lowerM3h, flow.upperM3h].map((value, layer) => { if (Math.abs(value) < 0.1) return ''; const sign = Math.sign(value), offset = layer === 0 ? -3 : 3, dx = nx * sign * 13, dy = nz * sign * 13; return `<path data-study-opening-flow="${escape(opening.id)}" data-study-flow-layer="${layer ? 'upper' : 'lower'}" data-study-flow-m3h="${value}" d="M${cx - dx - nz * offset} ${cy - dy + nx * offset}L${cx + dx - nz * offset} ${cy + dy + nx * offset}" stroke="#26695b" stroke-width="1.5" ${layer ? 'stroke-dasharray="3 2"' : ''} marker-end="url(#${marker})"/>`; }).join(''); }).join('')}<g transform="translate(278 24) rotate(${-plan.northDegrees})"><path d="M0 11V-11M-4-5L0-12L4-5" fill="none" stroke="#284e3d" stroke-width="1.4"/></g><text x="290" y="17" class="cs-north-label">N</text><text x="24" y="227" class="cs-dimension-label">${display(width)} × ${display(depth)} m · ${display(plan.heightM)} m high</text></svg>`;
  }
  function renderPlan(index: number): void {
    const plan = plans[index]; if (!plan) return;
    const settingsOpen = container.querySelector<HTMLDetailsElement>(`#cs-plan-controls-${index} details`)?.open ?? false;
    $(`#cs-plan-name-${index}`).textContent = plan.name;
    $(`#cs-preview-${index}`).innerHTML = preview(plan, index);
    renderPlanMeta(index);
    $(`#cs-plan-controls-${index}`).innerHTML = `<details class="cs-details cs-plan-settings"><summary>Openings, equipment & room placement</summary><p class="cs-help">Drag appliance markers to another room, or use the room selectors below. Positions snap to rooms; within-room coordinates are not solved.</p>${plan.openings.map(opening => `<label class="cs-check"><input type="checkbox" data-study-opening="${escape(opening.id)}" data-study-index="${index}" ${opening.open ? 'checked' : ''} ${opening.kind === 'passage' ? 'disabled' : ''}><span>${escape(opening.id)}<small>${opening.kind === 'passage' ? 'passage · always open' : opening.kind} · ${opening.roomB === null ? 'exterior' : 'internal'}</small></span></label>`).join('')}${plan.devices.map(device => `<label class="cs-check"><input type="checkbox" data-study-device="${escape(device.id)}" data-study-index="${index}" ${device.on ? 'checked' : ''}><span>${escape(device.id)}<small>${device.kind}</small></span></label><label class="cs-placement-label">Room for ${escape(device.id)}<select data-study-device-room="${escape(device.id)}" data-study-index="${index}">${plan.rooms.map(room => `<option value="${escape(room.id)}" ${room.id === device.roomId ? 'selected' : ''}>${escape(room.label)}</option>`).join('')}</select></label>`).join('') || '<p class="cs-help">No powered equipment declared.</p>'}</details>`;
    $<HTMLButtonElement>(`[data-study-download-plan="${index}"]`).disabled = false;
    $<HTMLDetailsElement>(`#cs-plan-controls-${index} details`).open = settingsOpen;
  }
  function renderPlanMeta(index: number): void {
    const plan = plans[index]; if (!plan) return;
    $(`#cs-plan-meta-${index}`).innerHTML = `<strong>${display(planArea(plan))} m²</strong><span>${plan.rooms.length} rooms · ${plan.openings.length} openings · ${plan.devices.length} devices</span><small>Input fingerprint ${escape(contractorPlanGeometryId(plan))} · north ${display(plan.northDegrees, 0)}°</small>`;
  }
  function capture(): ContractorStudyConfig {
    if (plans.some(plan => !plan)) throw new Error('Load three valid floor plans first.');
    const weather = structuredClone(initialWeather);
    weather.scenarioId = studyScenarioId;
    Object.assign(weather, { outdoorTemperature: Number(input('cs-temperature')), outdoorPm25: Number(input('cs-pm25')), windSpeed: Number(input('cs-wind-speed')), windFrom: input('cs-wind-from'), humidity: Number(input('cs-humidity')), timeOfDay: Number(input('cs-hour')) });
    return { plans: plans.map(plan => structuredClone(plan!)), weather, durationSeconds: Number(input('cs-duration')), initialTemperature: Number(input('cs-initial-temperature')), initialPm25: Number(input('cs-initial-pm25')), occupancyPeople: Number(input('cs-occupancy')), brief: {
      projectName: input('cs-project').trim(), locationLabel: input('cs-location').trim(), latitude: input('cs-latitude') === '' ? null : Number(input('cs-latitude')), longitude: input('cs-longitude') === '' ? null : Number(input('cs-longitude')),
      sourceType: input('cs-source-type') as 'assumption' | 'forecast' | 'observation', sourceName: input('cs-source-name').trim(), sourceModel: input('cs-source-model').trim(), sourceUrl: input('cs-source-url').trim(), validTime: input('cs-valid-time'), timeZone: input('cs-time-zone').trim(), referenceHeightM: Number(input('cs-reference-height')), enteredAt: new Date().toISOString(),
    } };
  }
  function renderResults(result: ContractorComparisonResult): void {
    const shared = result.config, brief = shared.brief;
    const names = (ids: string[]) => ids.map(id => result.cases.find(option => option.plan.id === id)?.plan.name ?? id).join(' · ');
    const rows: [string, string, (option: ContractorComparisonResult['cases'][number]) => number, number][] = [
      ['Floor area', 'm²', option => option.areaM2, 1],
      ['Final mean air temperature', '°C · lower + upper layers', option => option.final.averageTemperature, 2],
      ['Warmest occupied room', '°C · lower layer', option => Math.max(...option.final.rooms.map(room => room.lowerTemperature)), 2],
      ['Final mean PM2.5', 'µg/m³', option => option.final.averagePm25, 2],
      ['Highest room PM2.5', 'µg/m³', option => Math.max(...option.final.rooms.map(room => room.pm25)), 2],
      ['PM exposure integral', 'µg·h/m³ · not inhaled dose', option => option.pmExposureUgHoursM3, 2],
      ['Boundary air changes', 'h⁻¹ · incoming air counted once', option => option.final.airChangesPerHour, 2],
      ['Total electricity', 'Wh', option => option.final.energyWh, 2],
      ['Electricity per floor area', 'Wh/m²', option => option.energyWhPerM2, 3],
      ['Ventilation heat removed', 'Wh · negative means imported heat', option => option.final.ventilationHeatRemovedJ / 3600, 2],
      ['Ventilation heat removed, final rate', 'W · excludes AC and motor heat', option => option.final.sensibleHeatRemovedWatts, 1],
    ];
    const samples = result.cases.flatMap(option => option.samples.map(sample => sample.averageTemperature));
    const low = Math.floor((Math.min(...samples) - 0.2) * 2) / 2, high = Math.ceil((Math.max(...samples) + 0.2) * 2) / 2;
    const x = (time: number) => 49 + time / shared.durationSeconds * 585;
    const y = (temperature: number) => 180 - (temperature - low) / (high - low) * 150;
    const chart = `<svg id="cs-temperature-chart" viewBox="0 0 660 225" role="img" aria-labelledby="cs-chart-title cs-chart-desc"><title id="cs-chart-title">Mean air temperature for three plans</title><desc id="cs-chart-desc">All plans start at ${display(shared.initialTemperature)} degrees Celsius and run for ${shared.durationSeconds / 60} minutes. Mean air temperature includes both room air layers.</desc>${[0, 1, 2, 3].map(tick => { const value = low + (high - low) * tick / 3; return `<line x1="49" x2="634" y1="${y(value)}" y2="${y(value)}" stroke="#e4ebdf"/><text x="42" y="${y(value) + 4}" text-anchor="end">${display(value)}</text>`; }).join('')}${[0, 1, 2, 3, 4].map(tick => `<text x="${x(shared.durationSeconds * tick / 4)}" y="201" text-anchor="middle">${display(shared.durationSeconds * tick / 240, 0)}</text>`).join('')}<text x="12" y="17">°C</text><text x="341" y="221" text-anchor="middle">Simulated minutes</text>${result.cases.map((option, index) => `<path data-study-series="${escape(option.plan.id)}" d="${option.samples.map((sample, point) => `${point ? 'L' : 'M'}${x(sample.elapsedSeconds).toFixed(2)} ${y(sample.averageTemperature).toFixed(2)}`).join(' ')}" fill="none" stroke="${palette[index]}" stroke-width="2.5" ${index ? `stroke-dasharray="${index === 1 ? '6 3' : '2 3'}"` : ''}/>`).join('')}</svg>`;
    $('#cs-results-context').textContent = `${brief?.projectName || 'Study'} · ${shared.durationSeconds / 60} simulated minutes · ${shared.weather.outdoorTemperature}°C outside · ${shared.weather.outdoorPm25} µg/m³ PM2.5 · ${shared.weather.windSpeed} m/s from ${shared.weather.windFrom ?? 'the shared scenario direction'}.`;
    $('#cs-result-content').innerHTML = `<div class="cs-evidence"><div><strong>Input provenance</strong><span>${escape(brief?.sourceType ?? 'assumption')} · ${escape(brief?.sourceName || 'No external source recorded')}${brief?.validTime ? ` · valid ${escape(brief.validTime)} ${escape(brief.timeZone)}` : ' · no valid time recorded'}</span></div><div><strong>Ranking stability</strong><span>One weather case tested. Stability across changing weather is untested; this is not an accuracy confidence score.</span></div></div>
      <div class="cs-recommendations">${result.recommendations.map(recommendation => `<article><span>${escape(recommendation.label)}</span><h4>${escape(names(recommendation.planIds))}</h4><strong>${display(recommendation.value, 2)} <small>${escape(recommendation.unit)}</small></strong><p>${recommendation.planIds.length > 1 ? 'Tied options. ' : ''}${escape(recommendation.reason)}</p></article>`).join('')}</div>
      <div class="cs-shortlist"><strong>Plans worth a closer look: ${escape(names(result.shortlistPlanIds))}</strong><p>${result.shortlistPlanIds.length === result.cases.length ? 'Every tested plan retains a trade-off; none clearly dominates all three screening metrics.' : 'These options are not clearly worse across all three screening metrics: mean temperature, final mean PM2.5 and total electricity.'} This is a shortlist under the stated assumptions, not a universal best layout or installation instruction.</p></div>
      ${result.warnings.length ? `<ul class="cs-warnings">${result.warnings.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul>` : ''}
      <div class="cs-comparison-scroll" tabindex="0" aria-label="Results table; scroll horizontally for more columns"><table class="cs-comparison-table"><caption>Three plans under the same weather, starting concentrations, total occupancy and duration</caption><thead><tr><th scope="col">Model output</th>${result.cases.map((option, index) => `<th scope="col"><span class="cs-table-plan" style="--plan-color:${palette[index]}">${String.fromCharCode(65 + index)}</span>${escape(option.plan.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, unit, value, decimals]) => `<tr><th scope="row">${label}<small>${unit}</small></th>${result.cases.map(option => `<td>${display(value(option), decimals)}</td>`).join('')}</tr>`).join('')}<tr><th scope="row">Active equipment<small>Declared states, not an equal equipment budget</small></th>${result.cases.map(option => `<td>${option.enabledEquipment.fans} fans<br>${option.enabledEquipment.purifiers} purifiers<br>${option.enabledEquipment.ac} AC</td>`).join('')}</tr></tbody></table></div>
      <section class="cs-result-chart"><h4>Mean air temperature over time</h4><div class="cs-chart-legend">${result.cases.map((option, index) => `<span style="--plan-color:${palette[index]}">${String.fromCharCode(65 + index)} · ${escape(option.plan.name)}</span>`).join('')}</div>${chart}<p class="cs-help">Means include both room air layers. Floor area, room connectivity and equipment differ between plans; per-area electricity is context, not a substitute for the absolute energy demand.</p></section>
      <div class="cs-room-results">${result.cases.map(option => `<details class="cs-details"><summary>${escape(option.plan.name)} · room readings</summary><div class="cs-comparison-scroll" tabindex="0" aria-label="Results table; scroll horizontally for more columns"><table class="cs-room-table"><thead><tr><th scope="col">Room</th><th scope="col">Lower °C</th><th scope="col">Upper °C</th><th scope="col">PM2.5 µg/m³</th><th scope="col">Direct boundary ACH</th></tr></thead><tbody>${option.final.rooms.map(room => `<tr><th scope="row">${escape(option.plan.rooms.find(item => item.id === room.room)?.label ?? room.room)}</th><td>${display(room.lowerTemperature, 2)}</td><td>${display(room.upperTemperature, 2)}</td><td>${display(room.pm25, 2)}</td><td>${display(room.boundaryAirChangesPerHour, 2)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}</div>
      <div class="cs-site-checks"><h4>Before making changes at home</h4><p>Check the real dimensions, window sizes and orientation, nearby obstructions, and equipment ratings before acting on a result. Ask a qualified installer about noise, safe mounting and installation constraints. This room-by-room model does not resolve furniture, air jets or three-dimensional turbulence.</p><p>To test weather sensitivity, change the shared conditions and rerun all three plans. Export each captured report before replacing the result.</p></div>`;
    result.cases.forEach((option, index) => { $(`#cs-preview-${index}`).innerHTML = preview(option.plan, index, option.final); });
    $('#cs-preview-key').textContent = 'Solved opening exchange · solid arrows: lower layer; dashed: upper layer. Opposing arrows show counterflow. Room-network illustration, not resolved 3D airflow.';
  }
  async function run(): Promise<void> {
    const form = $<HTMLFormElement>('#cs-brief');
    windLink(); validateBrief();
    const invalid = form.querySelector<HTMLElement>(':invalid');
    for (let parent = invalid?.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    if (!form.reportValidity()) { setStatus('Check the highlighted settings, then compare again.', 'error'); return; }
    if (running) return;
    if (plans.some(plan => !plan) || pendingFiles.some(Boolean) || examplesAbort !== null) {
      $('#cs-status').textContent = 'Wait until all three valid plans finish loading before comparing.'; return;
    }
    try {
      const config = capture(); invalidate('Running the three plans under matched conditions…');
      const token = ++generation; running = true; ready(); $('#cs-cancel').hidden = false; $('#cs-progress').hidden = false; $<HTMLProgressElement>('#cs-progress').value = 0;
      setStatus('Comparing each plan under the same weather and starting conditions…', 'working');
      $('#cs-result-content').innerHTML = '<p class="cs-empty">The three comparisons are running. You can cancel or edit a setting to stop this run.</p>';
      try {
        const result = await runner.run(config, progress => { if (token !== generation) return; $<HTMLProgressElement>('#cs-progress').value = progress.total ? progress.done / progress.total * 100 : 0; $('#cs-status').textContent = `${progress.planName}: ${display(progress.elapsedSeconds / 60)} / ${progress.durationSeconds / 60} simulated minutes.`; });
        if (token !== generation || disposed) return;
        report = result; renderResults(result);
        $<HTMLButtonElement>('#cs-export-html').disabled = false; $<HTMLButtonElement>('#cs-export-json').disabled = false;
        $('#cs-view-results').hidden = false;
        setStatus('Comparison complete. View the results or download the comparison to keep this run.', 'success');
      } catch (error) { if (token === generation && !disposed) {
        runFailed = true;
        setStatus(`${error instanceof Error ? error.message : 'The comparison could not finish.'} Plans and settings are retained. Select Retry comparison to try again.`, 'error');
        $('#cs-result-content').innerHTML = '<p class="cs-empty">No result was produced. Retry the comparison with the current plans and settings.</p>';
      } }
      finally { if (token === generation && !disposed) { running = false; $('#cs-cancel').hidden = true; $('#cs-progress').hidden = true; ready(); } }
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Check the study inputs.', 'error'); }
  }
  container.addEventListener('input', event => { const target = event.target as HTMLElement; if (target.matches('[data-study-field]') && target.id !== 'cs-scenario') { windLink(); weatherSummary(); validateBrief(); invalidate('Settings changed. Compare again to update the results.'); } }, { signal: events.signal });
  container.addEventListener('change', async event => {
    const target = event.target as HTMLInputElement;
    if (target.id === 'cs-scenario') {
      const selected = PRESETS.find(preset => preset.id === target.value)?.conditions ?? initialWeather;
      const initial = SCENARIOS.find(item => item.id === selected.scenarioId) ?? SCENARIOS[0];
      studyScenarioId = selected.scenarioId;
      for (const [id, key] of [['cs-temperature', 'outdoorTemperature'], ['cs-pm25', 'outdoorPm25'], ['cs-wind-speed', 'windSpeed'], ['cs-humidity', 'humidity'], ['cs-hour', 'timeOfDay']] as const) $<HTMLInputElement>(`#${id}`).value = String(selected[key]);
      $<HTMLSelectElement>('#cs-wind-from').value = selected.windFrom ?? initial.windward;
      $<HTMLInputElement>('#cs-initial-temperature').value = String(initial.initialTemperature);
      $<HTMLInputElement>('#cs-initial-pm25').value = String(initial.initialPm25);
      $<HTMLSelectElement>('#cs-source-type').value = 'assumption';
      $<HTMLInputElement>('#cs-source-name').value = target.value === 'captured' ? 'My flat scenario settings' : initial.name;
      for (const id of ['cs-source-model', 'cs-source-url', 'cs-valid-time']) $<HTMLInputElement>(`#${id}`).value = '';
      weatherSummary(); validateBrief(); invalidate('Day changed for all three plans. Run a new comparison.'); return;
    }
    if (target.matches('select[data-study-field]')) { weatherSummary(); invalidate('Shared study inputs changed. Run a new comparison.'); return; }
    if (target.dataset.studyFile !== undefined) {
      const index = Number(target.dataset.studyFile), file = target.files?.[0]; if (!file) return;
      examplesAbort?.abort(); examplesAbort = null;
      const token = ++importTokens[index]; pendingFiles[index] = true; invalidate('Loading floor-plan geometry…');
      $(`#cs-plan-status-${index}`).textContent = `Reading ${file.name}…`; $(`#cs-plan-status-${index}`).dataset.state = 'working';
      try {
        if (file.size > MAX_FILE_BYTES) throw new Error('This file exceeds the 500 KB plan limit. Use the compact JSON template.');
        const plan = parseContractorPlan(await file.text());
        if (token !== importTokens[index] || disposed) return;
        plans[index] = plan; renderPlan(index); $(`#cs-plan-status-${index}`).textContent = `${file.name}: geometry consistency checks passed. This does not verify surveyed dimensions.`;
        $(`#cs-plan-status-${index}`).dataset.state = 'success';
      } catch (error) { if (token === importTokens[index] && !disposed) {
        $(`#cs-plan-status-${index}`).textContent = `${error instanceof Error ? error.message : 'Unable to read this plan.'} ${plans[index] ? 'The previous plan is retained.' : 'This slot is still empty.'} Correct the JSON and choose the file again.`;
        $(`#cs-plan-status-${index}`).dataset.state = 'error';
      } }
      finally { if (token === importTokens[index] && !disposed) { pendingFiles[index] = false; target.value = ''; ready(); } }
      return;
    }
    const index = Number(target.dataset.studyIndex), plan = plans[index];
    if (plan && target.dataset.studyDeviceRoom) {
      try {
        plans[index] = moveContractorDevice(plan, target.dataset.studyDeviceRoom, target.value);
        invalidate('Appliance room changed. Run a fresh comparison.'); renderPlan(index);
        $<HTMLSelectElement>(`[data-study-index="${index}"][data-study-device-room="${CSS.escape(target.dataset.studyDeviceRoom)}"]`).focus();
      } catch (error) { $('#cs-status').textContent = error instanceof Error ? error.message : 'That room placement is unavailable.'; }
      return;
    }
    if (plan && target.dataset.studyOpening) { const opening = plan.openings.find(item => item.id === target.dataset.studyOpening); if (opening && opening.kind !== 'passage') opening.open = target.checked; }
    else if (plan && target.dataset.studyDevice) { const device = plan.devices.find(item => item.id === target.dataset.studyDevice); if (device) device.on = target.checked; }
    else return;
    invalidate('A plan configuration changed. Run all three again for a matched comparison.'); renderPlanMeta(index);
  }, { signal: events.signal });
  $('#cs-load-examples').addEventListener('click', async () => {
    examplesAbort?.abort(); const controller = new AbortController(); examplesAbort = controller;
    const tokens = importTokens.map((_, index) => ++importTokens[index]);
    pendingFiles.fill(false);
    invalidate('Loading three illustrative JSON plans…'); $<HTMLButtonElement>('#cs-load-examples').disabled = true;
    try {
      const loaded = await Promise.all(CONTRACTOR_EXAMPLES.map(async example => { const response = await fetch(example.url, { signal: controller.signal }); if (!response.ok) throw new Error(`Could not load ${example.name}.`); return parseContractorPlan(await response.text()); }));
      if (disposed || controller.signal.aborted || tokens.some((token, index) => token !== importTokens[index])) return;
      loaded.forEach((plan, index) => { plans[index] = plan; pendingFiles[index] = false; renderPlan(index); $(`#cs-plan-status-${index}`).textContent = 'Illustrative example. Review dimensions and equipment before drawing conclusions.'; });
      setStatus('Three example plans loaded. Move an appliance or change the weather, then compare.', 'success');
    } catch (error) { if (!controller.signal.aborted && !disposed) setStatus(`${error instanceof Error ? error.message : 'The example plans could not load.'} Existing plans are retained. Try loading the examples again or import a JSON plan.`, 'error'); }
    finally { if (examplesAbort === controller) examplesAbort = null; if (!disposed) { $<HTMLButtonElement>('#cs-load-examples').disabled = false; ready(); } }
  }, { signal: events.signal });
  container.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-study-download-plan]');
    if (!target) return; const index = Number(target.dataset.studyDownloadPlan), plan = plans[index];
    if (plan) download(JSON.stringify(plan, null, 2), `heatsim-plan-${String.fromCharCode(65 + index)}.json`, 'application/json');
  }, { signal: events.signal });
  $('#cs-brief').addEventListener('submit', event => { event.preventDefault(); void run(); }, { signal: events.signal });
  $('#cs-run').addEventListener('click', () => void run(), { signal: events.signal });
  $('#cs-cancel').addEventListener('click', () => {
    examplesAbort?.abort(); examplesAbort = null;
    pendingFiles.forEach((pending, index) => { if (pending) { $(`#cs-plan-status-${index}`).textContent = 'Loading cancelled. The previous plan is retained, if one was loaded.'; $(`#cs-plan-status-${index}`).dataset.state = 'idle'; $<HTMLInputElement>(`#cs-file-${index}`).value = ''; } importTokens[index]++; });
    pendingFiles.fill(false); $<HTMLButtonElement>('#cs-load-examples').disabled = false;
    invalidate('Cancelled. Your loaded plans and settings are retained.');
    ($<HTMLButtonElement>('#cs-run').disabled ? $('#cs-load-examples') : $('#cs-run')).focus();
  }, { signal: events.signal });
  $('#cs-view-results').addEventListener('click', () => { $('#cs-results').focus({ preventScroll: true }); $('#cs-results').scrollIntoView({ block: 'start' }); }, { signal: events.signal });
  $('#cs-schema').addEventListener('click', () => download(JSON.stringify(CONTRACTOR_PLAN_SCHEMA, null, 2), 'heatsim-plan.schema.json', 'application/schema+json'), { signal: events.signal });
  $('#cs-load-windy').addEventListener('click', () => {
    windLink(); if ($<HTMLButtonElement>('#cs-load-windy').disabled) return;
    const parameters = new URLSearchParams({ type: 'map', location: 'coordinates', metricRain: 'default', metricTemp: '°C', metricWind: 'm/s', zoom: '10', overlay: 'wind', product: '', level: 'surface', lat: String(Number(input('cs-latitude'))), lon: String(Number(input('cs-longitude'))) });
    const iframe = document.createElement('iframe'); iframe.src = `https://embed.windy.com/embed.html?${parameters}`; iframe.title = 'Windy external weather reference'; iframe.loading = 'lazy'; iframe.referrerPolicy = 'no-referrer'; iframe.dataset.coordinates = `${input('cs-latitude')},${input('cs-longitude')}`;
    $('#cs-windy-status').textContent = 'Loading the external map. If it stays blank, use the Windy link below. Model inputs stay as entered.';
    iframe.addEventListener('load', () => { if (!disposed && iframe.isConnected) $('#cs-windy-status').textContent = 'Weather reference only. Check the map’s forecast time and units before copying values. If the map is blank, open Windy using the link below.'; }, { signal: events.signal });
    iframe.addEventListener('error', () => { if (!disposed && iframe.isConnected) $('#cs-windy-status').textContent = 'The external map could not load. Open the Windy link below, or continue using manually entered conditions.'; }, { signal: events.signal });
    $('#cs-windy-map').replaceChildren(iframe);
  }, { signal: events.signal });
  for (const kind of ['html', 'json'] as const) $(`#cs-export-${kind}`).addEventListener('click', () => { if (!report) return; try { download(kind === 'html' ? contractorStudyHtml(report) : contractorStudyJson(report), `heatsim-contractor-study.${kind}`, kind === 'html' ? 'text/html;charset=utf-8' : 'application/json'); $('#cs-export-status').textContent = kind === 'html' ? 'HTML report download started. Open it locally and choose Print to save a PDF.' : 'Study JSON download started with the captured plans and conditions.'; $('#cs-export-status').dataset.state = 'success'; } catch (error) { $('#cs-export-status').textContent = `${error instanceof Error ? error.message : 'The download could not start.'} Your result is retained. Try the download again.`; $('#cs-export-status').dataset.state = 'error'; } }, { signal: events.signal });
  const disposePlacement = bindContractorPlacement(container, {
    getPlan: slot => plans[Number(slot)],
    onMove(slot, nextPlan, deviceId, roomId) {
      if (disposed) return; const index = Number(slot); plans[index] = nextPlan;
      invalidate(`${deviceId} moved to ${nextPlan.rooms.find(room => room.id === roomId)?.label ?? roomId}. Run a fresh comparison.`); renderPlan(index);
    },
    onAnnounce(message) { if (!disposed) $('#cs-status').textContent = message; },
  });
  windLink(); weatherSummary(); ready();
  return { dispose() { disposed = true; generation++; importTokens.forEach((_, index) => importTokens[index]++); events.abort(); examplesAbort?.abort(); disposePlacement(); runner.dispose(); for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); $('#cs-windy-map').replaceChildren(); } };
}
