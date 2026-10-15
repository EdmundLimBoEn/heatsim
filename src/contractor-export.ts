import type { ContractorComparisonResult, ContractorPlanCase } from './contractor-comparison';
import { contractorPlanGeometryId, parseContractorPlan, previewOpeningSegment, type ContractorPlan } from './contractor-plan';
import { createThermalModel, THERMAL_MODEL_ID, THERMAL_MODEL_PARAMETERS } from './thermal-model';

const DISCLAIMER = 'Early-stage ventilation option screening. SIMULATED, uncalibrated results; not specialist 3D CFD, a construction specification, a compliance assessment or measured performance.';
const ASSUMPTIONS = [
  'Each imported room has two well-mixed air layers, each half its declared ceiling height, and one lumped surface temperature. Areas and volumes come from the individual imported plan, not the bundled HDB model.',
  'The same initial temperature, initial PM2.5, weather, total occupancy and duration apply to all plans. Different areas imply different air volumes, thermal capacities and occupant densities.',
  'Occupancy adds an illustrative 100 W per person, distributed by floor area. Each enabled circulating fan uses 50 W; each purifier uses 40 W with assumed 250 m³/h CADR; each imported AC has 2,500 W maximum sensible cooling and assumed COP 3.2. These are model defaults, not verified product specifications.',
  'Device positions are room-level assignments. Room-centre markers do not define mounting coordinates or resolve jets. The input fingerprint identifies plan content; it is not a security hash or proof that two geometries are equivalent.',
  'Mean air temperature averages both layers, weighted by room area. ACH counts incoming boundary air once, divided by air volume. Electricity is accumulated over the stated horizon; Wh/m² uses each plan’s own floor area.',
  'Humidity is a fixed input: no latent load, dehumidification, condensation, turbulent flow, surrounding buildings or facade wind shielding is solved. Reference weather does not establish the wind at an installed opening.',
];

function json(value: unknown, indent?: number): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('The contractor study contains a non-finite value. Run it again before exporting.');
    if (item instanceof Float64Array || item instanceof Float32Array) return Array.from(item);
    return item;
  }, indent);
}

function validate(report: ContractorComparisonResult): void {
  json(report);
  if (report.scope !== 'single-weather-case' || report.config.plans.length !== 3 || report.cases.length !== 3) throw new Error('Export requires a completed three-plan study.');
  const inputs = report.config.plans.map(parseContractorPlan);
  if (new Set(inputs.map(plan => plan.id)).size !== 3 || new Set(report.cases.map(option => option.plan.id)).size !== 3) throw new Error('Study plan IDs must be unique.');
  for (const option of report.cases) {
    const plan = parseContractorPlan(option.plan);
    const source = inputs.find(input => input.id === plan.id);
    if (!source || json(source) !== json(plan) || option.geometryId !== contractorPlanGeometryId(plan)) throw new Error('A report plan does not match its captured inputs. Run the study again.');
    const instance = createThermalModel(plan);
    instance.validateState(option.initialState);
    const weatherKeys = ['scenarioId', 'outdoorTemperature', 'outdoorPm25', 'humidity', 'windSpeed', 'windFrom', 'timeOfDay', 'acSetpoint'] as const;
    if (weatherKeys.some(key => option.config.base[key] !== report.config.weather[key])
      || option.config.durationSeconds !== report.config.durationSeconds
      || option.config.initialTemperature !== report.config.initialTemperature
      || option.config.initialPm25 !== report.config.initialPm25
      || (option.config.occupancyPeople ?? 4) !== (report.config.occupancyPeople ?? 4)) throw new Error('A plan configuration does not match the shared study conditions.');
    const area = plan.rooms.reduce((sum, room) => sum + room.widthM * room.depthM, 0);
    if (Math.abs(area - option.areaM2) > 1e-6 || Math.abs(option.final.elapsedSeconds - report.config.durationSeconds) > 1e-6 || option.initial.elapsedSeconds !== 0) throw new Error('A plan area or simulation horizon does not match the study.');
    for (const snapshot of [option.initial, option.final]) {
      if (snapshot.rooms.length !== plan.rooms.length || new Set(snapshot.rooms.map(room => room.room)).size !== plan.rooms.length || snapshot.rooms.some(room => !plan.rooms.some(input => input.id === room.room))) throw new Error('Room results do not match the captured plan.');
    }
    for (const field of [option.initialState.lowerT, option.initialState.upperT, option.initialState.wallT]) if (!field.every(value => Math.abs(value - report.config.initialTemperature) < 1e-8)) throw new Error('Study plans did not share the declared initial temperature.');
    for (const field of [option.initialState.lowerPm25, option.initialState.upperPm25]) if (!field.every(value => Math.abs(value - report.config.initialPm25) < 1e-8)) throw new Error('Study plans did not share the declared initial PM2.5.');
  }
  const ids = new Set(inputs.map(plan => plan.id));
  if ([...report.shortlistPlanIds, ...report.recommendations.flatMap(item => item.planIds)].some(id => !ids.has(id))) throw new Error('A recommendation references an unknown plan.');
}

export function contractorStudyJson(report: ContractorComparisonResult): string {
  validate(report);
  return json({ format: 'heatsim-contractor-study', version: 1, disclaimer: DISCLAIMER,
    model: { id: THERMAL_MODEL_ID, parameters: THERMAL_MODEL_PARAMETERS, assumptions: ASSUMPTIONS,
      stateArrayOrder: 'Within each case, initial-state arrays follow case.initial.rooms.map(room => room.room), not the input room order.' }, study: report }, 2);
}

const escape = (value: unknown): string => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const fixed = (value: number, digits = 2): string => value.toFixed(digits);
const supplied = (value: string | null | undefined): string => value?.trim() ? value : 'Not supplied';
const list = (items: readonly string[]): string => `<ul>${items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>`;
const table = (headers: string[], rows: (string | number)[][]): string => `<div class="table-wrap"><table><thead><tr>${headers.map(header => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

function bounds(plan: ContractorPlan) {
  const x = Math.min(...plan.rooms.map(room => room.x)), z = Math.min(...plan.rooms.map(room => room.z));
  return { x, z, width: Math.max(...plan.rooms.map(room => room.x + room.widthM)) - x, depth: Math.max(...plan.rooms.map(room => room.z + room.depthM)) - z };
}

function preview(plan: ContractorPlan): string {
  const extent = bounds(plan), scale = Math.min(330 / extent.width, 210 / extent.depth);
  const x = (value: number) => 35 + (value - extent.x) * scale;
  const z = (value: number) => 44 + (value - extent.z) * scale;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 470 300" role="img" aria-label="${escape(plan.name)} floor plan"><title>${escape(plan.name)}: declared geometry in metres</title><rect width="470" height="300" fill="#f4f7f3"/>`];
  for (const room of plan.rooms) {
    const cx = x(room.x + room.widthM / 2), cz = z(room.z + room.depthM / 2);
    parts.push(`<g><title>${escape(room.label)} (${escape(room.id)}), ${fixed(room.widthM)} × ${fixed(room.depthM)} m</title><rect x="${x(room.x)}" y="${z(room.z)}" width="${room.widthM * scale}" height="${room.depthM * scale}" fill="#e4eee5" stroke="#33594b" stroke-width="1.5"/><text x="${cx}" y="${cz - 8}" text-anchor="middle" font-size="10">${escape(room.label.length > 20 ? `${room.label.slice(0, 19)}…` : room.label)}</text></g>`);
    const devices = plan.devices.filter(device => device.roomId === room.id);
    if (devices.length) parts.push(`<text x="${cx}" y="${cz + 7}" text-anchor="middle" font-size="9">${escape(devices.map(device => `${device.kind.toUpperCase()} ${device.on ? 'ON' : 'off'}`).join(' · '))}</text>`);
  }
  for (const opening of plan.openings) {
    const segment = previewOpeningSegment(plan, opening);
    parts.push(`<line x1="${x(segment.start[0])}" y1="${z(segment.start[1])}" x2="${x(segment.end[0])}" y2="${z(segment.end[1])}" stroke="${opening.open ? '#167aa3' : '#b46248'}" stroke-width="4"${opening.open ? '' : ' stroke-dasharray="3 2"'}><title>${escape(opening.id)} · ${escape(opening.kind)} · ${fixed(opening.widthM)} m · ${opening.open ? 'open' : 'closed'}</title></line>`);
  }
  parts.push(`<g transform="translate(425 63) rotate(${-plan.northDegrees})"><path d="M0 22V-20M0-20L-6-7M0-20L6-7" fill="none" stroke="#173e31" stroke-width="2"/></g><text x="425" y="22" text-anchor="middle" font-size="10">TRUE N</text><text x="35" y="282" font-size="11">${fixed(extent.width)} × ${fixed(extent.depth)} m bounds · height ${fixed(plan.heightM)} m</text></svg>`);
  return parts.join('');
}

function planSection(option: ContractorPlanCase, index: number): string {
  const plan = option.plan, roomNames = new Map(plan.rooms.map(room => [room.id, room.label]));
  const rooms = plan.rooms.map(room => {
    const reading = option.final.rooms.find(value => value.room === room.id)!;
    return [room.label, room.id, `${fixed(room.widthM)} × ${fixed(room.depthM)}`, fixed(reading.lowerTemperature), fixed(reading.upperTemperature), fixed(reading.pm25), fixed(reading.boundaryAirChangesPerHour, 3)];
  });
  return `<section class="plan"><div class="eyebrow">OPTION ${index + 1} · ${escape(plan.id)}</div><h2>${escape(plan.name)}</h2>
    <div class="plan-summary"><figure>${preview(plan)}<figcaption>Blue: open; rust dashed: closed. Room labels show declared equipment states. Device placement is indicative at room level. Local plan north is ${fixed(plan.northDegrees, 1)}° clockwise from true north.</figcaption></figure>
    <div><dl><dt>Floor area</dt><dd>${fixed(option.areaM2)} m²</dd><dt>Input fingerprint</dt><dd class="mono">${escape(option.geometryId)}</dd><dt>Active equipment</dt><dd>${option.enabledEquipment.fans} fans · ${option.enabledEquipment.purifiers} purifiers · ${option.enabledEquipment.ac} AC units</dd><dt>Final mean air / upper layer</dt><dd>${fixed(option.final.averageTemperature)} / ${fixed(option.final.averageUpperTemperature)} °C</dd><dt>Final PM2.5 / boundary air changes</dt><dd>${fixed(option.final.averagePm25)} µg/m³ / ${fixed(option.final.airChangesPerHour, 3)} h⁻¹</dd><dt>Total electricity / per floor area</dt><dd>${fixed(option.final.energyWh)} Wh / ${fixed(option.energyWhPerM2, 3)} Wh/m²</dd><dt>Fan electricity, all enabled fans</dt><dd>${fixed(option.fanEnergyWh)} Wh</dd><dt>Signed ventilation heat removal</dt><dd>${fixed(option.final.sensibleHeatRemovedWatts)} W final · ${fixed(option.final.ventilationHeatRemovedJ / 1000)} kJ accumulated</dd></dl></div></div>
    <h3>Room results at the shared horizon</h3>${table(['Room', 'ID', 'Dimensions m', 'Lower °C', 'Upper °C', 'PM2.5 µg/m³', 'Boundary ACH h⁻¹'], rooms)}
    <h3>Declared equipment</h3>${plan.devices.length ? table(['Device', 'Kind', 'Assigned room', 'State'], plan.devices.map(device => [device.id, device.kind, roomNames.get(device.roomId)!, device.on ? 'On' : 'Off'])) : '<p>No devices declared.</p>'}
    <h3>Envelope assumptions</h3><p>Exterior-face-to-interior-surface conductance ${fixed(option.config.envelope.uValue)} W/(m² K), solar absorptance ${fixed(option.config.envelope.solarAbsorptance)}, shade fraction ${fixed(option.config.envelope.shadeFraction)}. Conductance is not a rated whole-wall U-value.</p></section>`;
}

export function contractorStudyHtml(report: ContractorComparisonResult): string {
  validate(report);
  const { config } = report, brief = config.brief, weather = config.weather;
  const names = new Map(report.cases.map(option => [option.plan.id, option.plan.name]));
  const missing = !brief ? ['Project/site/weather provenance not supplied.'] : [
    ...([['Project name', brief.projectName], ['Site label', brief.locationLabel], ['Weather provider/source', brief.sourceName], ['Weather valid time', brief.validTime], ['Time zone', brief.timeZone]] as const).filter(([, value]) => !value.trim()).map(([label]) => `${label} not supplied.`),
    ...(brief.latitude === null || brief.longitude === null ? ['Site coordinates incomplete.'] : []),
  ];
  const project = supplied(brief?.projectName);
  const recommendations = report.recommendations.map(item => [item.label, item.planIds.map(id => names.get(id)!).join(' / '), `${fixed(item.value)} ${item.unit}`, `±${fixed(item.tolerance)} ${item.unit}`, item.reason]);
  const summary = report.cases.map(option => [option.plan.name, fixed(option.areaM2), `${option.enabledEquipment.fans}/${option.enabledEquipment.purifiers}/${option.enabledEquipment.ac}`, fixed(option.final.averageTemperature), fixed(option.final.averagePm25), fixed(option.final.airChangesPerHour, 3), fixed(option.final.energyWh), fixed(option.energyWhPerM2, 3)]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(project)} · HeatSim study</title><style>
  *{box-sizing:border-box}body{margin:0;color:#203a31;background:#edf2ec;font:14px/1.55 Arial,Helvetica,sans-serif}main{max-width:1120px;margin:auto;padding:40px}h1{font-size:38px;line-height:1.1;margin:8px 0 18px}h2{font-size:24px;line-height:1.2;margin:8px 0 20px}h3{font-size:16px;margin:24px 0 10px}p{margin:12px 0}.eyebrow{font-size:11px;font-weight:bold;letter-spacing:1.5px}.note{background:#fff3d7;padding:18px;border-left:4px solid #b07b28}.muted,figcaption{color:#536b5d;font-size:12px}section{background:white;margin:24px 0;padding:28px;border:1px solid #d8e3d8}.plan-summary{display:grid;grid-template-columns:1.3fr 1fr;gap:24px}figure{margin:0}svg{width:100%;height:auto;font-family:Arial,Helvetica,sans-serif;fill:#203a31}dl{display:grid;grid-template-columns:1fr 1.1fr;gap:8px 14px;margin:0}dt{color:#536b5d}dd{margin:0;font-weight:bold;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #dce5dc;padding:9px 8px;overflow-wrap:anywhere}th{background:#e9f0e9;font-size:11px}li{margin:7px 0}.mono{font-family:monospace}.table-wrap{overflow:auto}.checklist{list-style:none;padding:0}.checklist li:before{content:'□ ';font-size:17px}.source{white-space:pre-wrap;overflow-wrap:anywhere}footer{font-size:11px;color:#536b5d;padding-top:15px}@page{size:A4;margin:14mm}@media print{body{background:white;font-size:10px}main{padding:0;max-width:none}h1{font-size:26px}h2{font-size:18px}h3{font-size:12px}section{border:0;padding:0;margin:20px 0}.plan{break-before:page}.plan-summary{gap:14px}table{font-size:9px}th{font-size:8px}th,td{padding:5px}tr,figure,dl,.note{break-inside:avoid}thead{display:table-header-group}.table-wrap{overflow:visible}.screen-only{display:none}footer{font-size:8px}}@media(max-width:760px){main{padding:20px}.plan-summary{grid-template-columns:1fr}section{padding:18px}}</style></head><body><main>
  <header><div class="eyebrow">HEATSIM · CONTRACTOR STUDY · SIMULATED</div><h1>${escape(project)}</h1><p>Three declared floor plans, one shared comparison brief.</p><div class="note">${escape(DISCLAIMER)}</div><p class="screen-only muted">Open your browser’s Print command to print this self-contained report or save it as PDF. Keep the companion JSON with the report to retain exact inputs, initial states and results.</p></header>
  <section><h2>Project, site and weather provenance</h2><dl><dt>Site</dt><dd>${escape(supplied(brief?.locationLabel))}</dd><dt>Coordinates, latitude / longitude</dt><dd>${brief?.latitude == null ? 'Not supplied' : fixed(brief.latitude, 6)} / ${brief?.longitude == null ? 'Not supplied' : fixed(brief.longitude, 6)}</dd><dt>Source classification</dt><dd>${escape(brief?.sourceType ?? 'Not supplied')}</dd><dt>Provider / source</dt><dd>${escape(supplied(brief?.sourceName))}</dd><dt>Source model</dt><dd>${escape(supplied(brief?.sourceModel))}</dd><dt>Valid time / time zone</dt><dd>${escape(supplied(brief?.validTime))} / ${escape(supplied(brief?.timeZone))}</dd><dt>Wind reference height</dt><dd>${brief ? `${fixed(brief.referenceHeightM)} m` : 'Not supplied'}</dd><dt>Entered at</dt><dd>${escape(supplied(brief?.enteredAt))}</dd></dl><p class="source">Source URL: ${escape(supplied(brief?.sourceUrl))}</p><p class="muted">Provenance is user-entered and was not fetched or independently verified. Coordinates identify the site; they do not automatically determine facade wind or surrounding-building effects. Plan geometry source and measured dimensions require site confirmation.</p></section>
  <section><h2>Shared comparison conditions</h2>${table(['Outdoor °C', 'PM2.5 µg/m³', 'Humidity %', 'Wind m/s', 'Wind FROM', 'Hour', 'Initial °C / PM2.5 µg/m³', 'Occupants', 'Duration min'], [[fixed(weather.outdoorTemperature), fixed(weather.outdoorPm25), fixed(weather.humidity), fixed(weather.windSpeed), weather.windFrom ?? 'Scenario default', fixed(weather.timeOfDay, 1), `${fixed(config.initialTemperature)} / ${fixed(config.initialPm25)}`, String(config.occupancyPeople ?? 4), fixed(config.durationSeconds / 60)]])}<p>Scenario: ${escape(weather.scenarioId ?? 'baseline')}. Wind direction is where air comes <strong>from</strong>; N means north-to-south before considering each plan’s north bearing. All plans start at the same air/surface temperature and PM2.5 concentration, not the same stored energy.</p><p>Geometry passes the supported rectangular-plan schema; this is not an as-built survey. ${missing.length ? 'Provenance gaps remain:' : 'The required provenance fields shown above are populated; their accuracy has not been verified.'}</p>${list(missing)}<p><strong>Ranking stability: not tested.</strong> This is one weather case, not a sensitivity study or an accuracy percentage.</p></section>
  <section><h2>Compare the three outcomes</h2>${table(['Plan', 'Area m²', 'Fans / purifier / AC on', 'Mean air °C', 'PM2.5 µg/m³', 'Boundary ACH h⁻¹', 'Total Wh', 'Wh/m²'], summary)}<p>Lower temperature, lower PM2.5 and lower electricity are separate outcomes. Different areas and device counts affect the comparison; per-area electricity is shown alongside total use. These values are not measured cooling, air-quality or energy-bill savings.</p>${list(report.warnings)}<h3>Best tested outcomes and ties</h3>${table(['Metric', 'Plan(s)', 'Best value', 'Tie tolerance', 'Interpretation'], recommendations)}<p><strong>Trade-off shortlist:</strong> ${escape(report.shortlistPlanIds.map(id => names.get(id)!).join(' / ') || 'No shortlist returned')}. For a shortlisted plan, no other tested plan is no worse on all three ranking metrics and improves at least one by more than its tie tolerance. This is a shortlist for site assessment, not a universal optimum or installation recommendation.</p></section>
  ${report.cases.map(planSection).join('')}
  <section><h2>Model assumptions and next checks</h2><p class="mono">Model ${escape(THERMAL_MODEL_ID)} · plan schema v1 · ${fixed(report.runtimeMs, 0)} ms calculation time</p>${list(ASSUMPTIONS)}<h3>On-site verification before specification</h3><ul class="checklist"><li>Confirm the source drawing, room dimensions, ceiling heights, true north and actual openings against the site.</li><li>Confirm outdoor and opening-level wind conditions, shielding, adjacent buildings and weather/air-quality variation.</li><li>Confirm occupancy, solar exposure, shading and material properties; rerun plausible weather and operating cases.</li><li>Check product airflow/pressure curves, installed resistance, filtration, electrical demand and control assumptions.</li><li>Check mounting positions, clearances, noise, fire/security constraints and a connected makeup-air route with the responsible qualified professional.</li><li>Measure installed airflow and indoor conditions during commissioning; obtain specialist analysis and applicable approvals where the project requires them.</li></ul></section>
  <footer>Written by gpt-6-astra in Codex on behalf of Edmund</footer></main></body></html>`;
}
