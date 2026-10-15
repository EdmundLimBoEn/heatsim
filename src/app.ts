import './style.css';
import { defaultConditions, defaultView, deviceRoom, model, roomLabel, type Conditions, type ModelBox, type ViewMode } from './domain';
import { PRESETS, SCENARIOS } from './simulation';
import { createSimulation, stepSimulation, PLAN_SIMULATION_NOTE as SIMULATION_NOTE } from './plan-simulation';
import { createPlanGpu, type PlanGpu } from './plan-gpu';
import { createScene, type SceneController, type ThermalVentConfig } from './scene';
import { mountCoolingLab } from './cooling-lab';
import { mountContractorStudy } from './contractor-study';
import './theme.css';
import { FAN_SLOTS, PURIFIER_SLOTS } from './config/slots';
import { openingForKey } from './config/mapping';
import { createOptimiser, type OptimiserReport, type OptimiserBudget } from './optimiser';
import { pm25ToUsAqiEquivalent, usAqiEquivalentToPm25, US_PM25_AQI_EQUIVALENT_LABEL, US_PM25_AQI_EQUIVALENT_NOTE, US_PM25_AQI_SOURCE } from './air-quality';

const icons: Record<string, string> = {
  house: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7M3 10h18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  wind: '<path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h6a3 3 0 1 1-3 3"/>',
  plan: '<path d="M3 3h18v18H3ZM3 11h8V3m0 8v10m0-5h10m-5-5h5"/>',
  cube: '<path d="m12 2 10 5v10l-10 5-10-5V7Zm0 10v10M2 7l10 5 10-5M7 4.5l10 5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2.8 7M3 4v7h7"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  usb: '<path d="M12 21V3m-3 3 3-3 3 3M12 15l-5-4V8m5 10 5-4V9"/><circle cx="7" cy="6" r="2"/><path d="M15 5h4v4h-4Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
};
const icon = (name: string, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name] ?? icons.house}</svg>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
};
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

let conditions: Conditions = structuredClone(PRESETS[0]?.conditions ?? defaultConditions());
let result = createSimulation(conditions);
let view = { ...defaultView, selectedRoom: 'living' as string | null };
let scene: SceneController | null = null;
type Workspace = 'flat' | 'lab' | 'study';
let workspace: Workspace = 'flat';
let coolingLab: ReturnType<typeof mountCoolingLab> | null = null;
let contractorStudy: ReturnType<typeof mountContractorStudy> | null = null;
let thermalVent: ThermalVentConfig | null = null;
let flatViewMode: ViewMode = defaultView.mode;
let playing = true;
let speed = 30;
let activePreset = conditions.scenarioId ?? 'baseline';
let previousTime = performance.now();
let lastPaint = 0;
let lastSample = -1;
let history: number[] = [];
let camera: 'perspective' | 'top' = 'perspective';
let optimiserReport: OptimiserReport | null = null;
let optimiserInput: string | null = null;
let optimising = false;
let selectedLayout = 0;
let appliedLayout: number | null = null;
let gpu: PlanGpu | null = null;
let gpuBusy = false;
let gpuPendingSeconds = 0;
let simulationRevision = 0;
let disposed = false;

const formatTime = (hour: number) => `${Math.floor(hour).toString().padStart(2, '0')}:${Math.round((hour % 1) * 60).toString().padStart(2, '0')}`;
const elapsed = (seconds: number) => `${Math.floor(seconds / 3600).toString().padStart(2, '0')}:${Math.floor(seconds % 3600 / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const range = (field: keyof Conditions, label: string, min: number, max: number, step: number, unit: string) => `<label class="range-control" for="${field}"><span>${label}<output id="${field}-value"></output></span><input id="${field}" type="range" min="${min}" max="${max}" step="${step}" value="${conditions[field]}" data-field="${field}" data-unit="${unit}"><span class="range-limits"><span>${min}${unit}</span><span>${max}${unit}</span></span></label>`;
const outdoorNumber = (field: 'outdoorTemperature' | 'windSpeed' | 'outdoorPm25', label: string, min: number, max: number) => `<div class="outdoor-entry"><label class="field-label" for="${field}-number">${label}</label><input class="device-select" id="${field}-number" type="number" min="${min}" max="${max}" step="0.1" value="${conditions[field]}" data-weather-number="${field}"></div>`;
const primaryRooms = ['living', 'dining', 'master_bedroom', 'bedroom2', 'bedroom3', 'kitchen'];

$('#app').innerHTML = `
  <a class="skip-link" href="#controls">Skip to controls</a>
  <header class="app-header">
    <a class="brand" href="/" aria-label="HeatSim home"><span class="brand-mark">${icon('house')}</span><span>heatsim<span class="brand-dot">.</span></span></a>
    <span class="brand-description">HDB climate studio</span>
    <div class="header-actions"><span class="demo-indicator"><i></i>Standalone ready</span><button class="button primary" data-action="build">${icon('plan')}<span>Build the physical model</span></button></div>
  </header>
  <main>
    <div class="workspace-heading"><nav class="segmented" aria-label="HeatSim workspace"><button data-workspace="flat" aria-controls="flat-workspace" aria-pressed="true">${icon('house')}Flat simulation</button><button data-workspace="lab" aria-controls="cooling-lab-workspace" aria-pressed="false">${icon('wind')}Cooling Lab</button><button data-workspace="study" aria-controls="contractor-study-workspace" aria-pressed="false">${icon('plan')}Contractor study</button></nav></div>
    <section id="flat-workspace" aria-label="Flat simulation">
    <div class="workspace-heading"><div><h1>A small home. A changing climate.</h1><p>Explore how openings and everyday devices shape the rooms around you.</p></div><span class="home-meta">4-room flat <span>90 m²</span></span></div>
    <div class="workspace">
      <section class="model-panel" aria-label="Interactive apartment model">
        <div class="model-toolbar"><div class="segmented overlay-modes" role="group" aria-label="Model overlay">
          ${(['model', 'temperature', 'airflow', 'pressure', 'pm25'] as ViewMode[]).map(mode => `<button data-mode="${mode}" aria-pressed="${mode === 'model'}">${({ model: '3D model', temperature: 'Temperature', airflow: 'Airflow', pressure: 'Pressure', pm25: 'Air quality' })[mode]}</button>`).join('')}
        </div><button class="icon-button" data-action="screenshot" aria-label="Download model image" title="Download model image">${icon('camera')}</button></div>
        <div id="scene" class="scene" aria-label="3D apartment. Drag to orbit, scroll to zoom. Use room selector for keyboard access."><div id="scene-loading" class="scene-message" role="status"><span class="loading-mark">${icon('cube')}</span><strong>Setting up your home</strong><span>Preparing the 3D floor plan…</span></div></div>
        <div class="model-title"><span id="view-label">Your home, in perspective</span><p id="view-description">Select a room to explore its controls.</p></div>
        <div class="view-tools"><div class="segmented camera-modes" role="group" aria-label="Camera view"><button data-camera="perspective" aria-pressed="true">${icon('cube')}<span>Isometric</span></button><button data-camera="top" aria-pressed="false">${icon('plan')}<span>Floor plan</span></button></div><button class="icon-button" data-action="reset-camera" title="Reset view" aria-label="Reset camera view">${icon('reset')}</button></div>
        <div class="view-options" aria-label="Model display options"><label><input type="checkbox" data-view="cutaway" checked>Cutaway</label><label><input type="checkbox" data-view="labels" checked>Room labels</label><label><input type="checkbox" data-view="dimensions">Dimensions</label></div>
        <div class="model-legend" id="model-legend" hidden></div>
        <div class="model-bottom"><span class="orbit-hint">Drag to orbit <span>Scroll to zoom</span></span><button class="scale-link" data-action="build">${icon('plan')}<span>1:65 model <strong>187.69 × 118.46 mm</strong></span>${icon('external')}</button></div>
      </section>
      <aside class="control-panel" id="controls" aria-label="Simulation controls">
        <div class="control-tabs" role="tablist" aria-label="Control section"><button role="tab" id="tab-environment" aria-controls="panel-environment" aria-selected="true" data-tab="environment">Environment</button><button role="tab" id="tab-room" aria-controls="panel-room" aria-selected="false" tabindex="-1" data-tab="room">Openings</button><button role="tab" id="tab-devices" aria-controls="panel-devices" aria-selected="false" tabindex="-1" data-tab="devices">Devices</button></div>
        <div class="control-scroll">
          <section id="panel-environment" role="tabpanel" aria-labelledby="tab-environment">
            <div class="section-heading"><h2>Try a scenario</h2><span id="scenario-label">Normal day</span></div>
            <div class="scenario-grid">${PRESETS.map((preset, index) => `<button class="scenario-button" data-preset="${escape(preset.id)}" aria-pressed="false"><span class="scenario-symbol">${icon(index === 1 ? 'wind' : index === 2 ? 'house' : index === 3 ? 'info' : 'sun')}</span><span>${escape(preset.name)}</span></button>`).join('')}</div>
            <p class="section-note" id="scenario-description">Change the conditions, then watch the rooms respond over time.</p>
            <div class="section-divider"></div><h2 class="section-title">Outside the home</h2>
            ${range('outdoorTemperature', 'Temperature', 10, 60, 0.1, '°C')}
            ${outdoorNumber('outdoorTemperature', 'Enter temperature (°C)', 10, 60)}
            ${range('windSpeed', 'Wind speed', 0, 10, 0.1, ' m/s')}
            ${outdoorNumber('windSpeed', 'Enter wind speed (m/s)', 0, 10)}
            <label class="field-label" for="windFrom">Wind from</label><select id="windFrom" class="device-select"><option value="">Scenario direction</option><option value="N">North → towards south</option><option value="E">East → towards west</option><option value="S">South → towards north</option><option value="W">West → towards east</option></select>
            <div class="spaced">${range('outdoorPm25', 'Outdoor PM2.5', 0, 1000, 0.1, ' µg/m³')}</div>
            ${outdoorNumber('outdoorPm25', 'Enter PM2.5 (µg/m³)', 0, 1000)}
            <div class="outdoor-entry"><label class="field-label" for="outdoor-aqi">${escape(US_PM25_AQI_EQUIVALENT_LABEL)}</label><input class="device-select" id="outdoor-aqi" type="number" min="0" max="500" step="1" aria-describedby="outdoor-aqi-note outdoor-aqi-range"></div>
            <p class="section-note" id="outdoor-aqi-range" hidden>PM2.5 is above the supported 0–500 index scale. Its concentration remains unchanged.</p><p class="section-note" id="outdoor-aqi-note">${escape(US_PM25_AQI_EQUIVALENT_NOTE)} <a href="${US_PM25_AQI_SOURCE}" target="_blank" rel="noopener">EPA scale</a></p>
            <p class="section-note" id="outdoor-source"></p><button class="button secondary full-width spaced" data-action="reset-weather">Reset outdoor conditions to scenario</button>
            <p class="section-note">Manual outdoor values override the selected scenario. Choosing another scenario clears these overrides. Sun exposure follows the scenario; humidity adjusts the comfort estimate. No sensors or live data are used.</p>
            <div class="section-divider"></div><div class="section-heading"><h2>Whole-home openings</h2><span id="window-count"></span></div>
            <div class="button-pair"><button class="button secondary" data-bulk="windows" data-value="true">Open windows</button><button class="button secondary" data-bulk="windows" data-value="false">Close windows</button></div>
            <div class="button-pair"><button class="button text-button" data-bulk="doors" data-value="true">Open all doors</button><button class="button text-button" data-bulk="doors" data-value="false">Close all doors</button></div>
            <p class="section-note">Opening windows exchanges indoor air with outdoors. On hazy days, this can bring particles inside.</p>
          </section>
          <section id="panel-room" role="tabpanel" aria-labelledby="tab-room" hidden>
            <label class="field-label" for="room-select">Select a room</label><select id="room-select">${model.rooms.map(room => `<option value="${room.name}" ${room.name === 'living' ? 'selected' : ''}>${roomLabel(room.name)}</option>`).join('')}</select>
            <div id="room-detail"></div>
          </section>
          <section id="panel-devices" role="tabpanel" aria-labelledby="tab-devices" hidden>
            <h2 class="section-title">Place your devices</h2><p class="section-note">Move a portable device between the marked positions. Explore comfort, haze and power together.</p>
            <h3 class="control-group-title">Portable fan <kbd>F</kbd></h3>
            <label class="toggle-control"><span>Fan power<small id="fan-state">Off</small></span><input type="checkbox" data-device-key="fanOn" aria-label="Portable fan power"><span class="switch-track" aria-hidden="true"></span></label>
            <label class="field-label spaced" for="fan-slot">Position</label><select id="fan-slot" class="device-select" data-device-key="fanSlot">${FAN_SLOTS.map((slot, index) => `<option value="${index}">${index + 1}. ${roomLabel(slot.room)}</option>`).join('')}</select>
            <label class="range-control spaced" for="fan-angle"><span>Fan direction<output id="fan-angle-value">90°</output></span><input id="fan-angle" type="range" min="0" max="180" step="15" value="90" data-device-key="fanAngle"><span class="range-limits"><span>0°</span><span>180°</span></span></label>
            <label class="field-label" for="fan-speed">Fan speed</label><select id="fan-speed" class="device-select" data-device-key="fanSpeed"><option value="0">Stopped</option><option value="1">Low</option><option value="2" selected>Medium</option><option value="3">High</option></select>
            <h3 class="control-group-title">Air purifier <kbd>P</kbd></h3>
            <label class="toggle-control"><span>Purifier power<small id="purifier-state">Off</small></span><input type="checkbox" data-device-key="purifierOn" aria-label="Portable purifier power"><span class="switch-track" aria-hidden="true"></span></label>
            <label class="field-label spaced" for="purifier-slot">Position</label><select id="purifier-slot" class="device-select" data-device-key="purifierSlot">${PURIFIER_SLOTS.map((slot, index) => `<option value="${index}">${index + 1}. ${roomLabel(slot.room)}${index === 4 ? ' corner' : ''}</option>`).join('')}</select>
            <h3 class="control-group-title">Air conditioning <kbd>A</kbd></h3>
            <label class="toggle-control"><span>AC power<small id="ac-state">Off</small></span><input type="checkbox" data-device-key="acOn" aria-label="Air conditioning power"><span class="switch-track" aria-hidden="true"></span></label>
            <label class="field-label spaced" for="ac-unit">Room to cool</label><select id="ac-unit" class="device-select" data-device-key="acUnit">${Object.keys(deviceRoom).filter(id => id.startsWith('ac_')).map(id => `<option value="${id}">${roomLabel(deviceRoom[id])}</option>`).join('')}</select>
            <div class="spaced">${range('acSetpoint', 'Set temperature', 18, 30, 0.5, '°C')}</div>
            <div class="section-divider"></div><section id="optimiser-panel" aria-label="Compare device layouts"><h2 class="section-title">Find a better arrangement</h2><label class="field-label" for="optimiser-budget">Available devices</label><select id="optimiser-budget" class="device-select"><option value="fan">Fan only</option><option value="fan+purifier" selected>Fan + purifier</option><option value="fan+purifier+ac">Fan + purifier + AC</option></select><label class="option-check"><input id="optimiser-openings" type="checkbox" checked>Also suggest windows and doors</label><button class="button primary full-width" id="run-optimiser" data-action="optimise">Compare layouts <kbd>O</kbd></button><div id="optimiser-result" aria-live="polite"><p class="section-note">Compare your setup with simulated alternatives. Lower heat, haze and power scores are better.</p></div></section>
          </section>
          <details class="hardware-section"><summary>${icon('usb')}Physical model (optional)<span class="details-plus">+</span></summary><div id="hardware-controls"><p class="hardware-state"><span class="status-dot"></span><strong>SSTuino not connected</strong></p><p class="section-note">Everything works with the on-screen controls and keyboard. When your model is ready, connect USB to use its switches and buttons.</p><button class="button secondary full-width" id="connect-hardware" type="button">Connect SSTuino</button><p class="hardware-help" id="hardware-status" role="status">USB serial works in desktop Chrome or Edge.</p></div></details>
        </div>
        <div class="simulation-controls"><div class="simulation-clock"><span class="running-dot"></span><span id="play-status">Simulation running</span><output id="elapsed-time">00:00:00</output></div><div class="playback-row"><button class="button play-button" data-action="play">${icon('pause')}<span>Pause</span></button><select id="simulation-speed" aria-label="Simulation speed"><option value="1">1× speed</option><option value="30" selected>30× speed</option><option value="60">60× speed</option></select><button class="icon-button" data-action="reset" aria-label="Reset simulation time and readings" title="Reset readings">${icon('reset')}</button></div><p>Target: 1 real second = <span id="speed-description">30 simulated seconds</span></p><p id="simulation-engine" role="status">CPU · 2D</p></div>
      </aside>
    </div>
    <section class="results-panel" aria-label="Illustrative simulation readings">
      <div class="results-summary"><div class="results-heading"><h2>Inside the home</h2><p><span class="simulated-tag">SIMULATED</span></p><svg id="temperature-history" viewBox="0 0 160 32" aria-label="Average temperature trend" role="img"><path d="M0 24H160"/></svg></div><div class="metric"><span>Mean temperature <span class="simulated-tag">SIMULATED</span></span><strong id="mean-temperature">—</strong><small id="feels-like">Feels like —</small></div><div class="metric"><span>Mean PM2.5 <span class="simulated-tag">SIMULATED</span></span><strong id="mean-pm25">—</strong><small>Estimated indoor particles</small></div><div class="metric"><span>Device power <span class="simulated-tag">SIMULATED</span></span><strong id="power">—</strong><small id="energy">0.000 kWh used</small></div><div class="results-actions"><button class="button secondary compact" data-action="readings">All room readings</button><button class="button text-button compact" data-action="export">${icon('download')}Export CSV</button></div></div>
      <div class="room-readings" aria-label="Select a room">${primaryRooms.map(room => `<button class="room-reading ${room === 'living' ? 'selected' : ''}" data-room="${room}" aria-pressed="${room === 'living'}"><span>${roomLabel(room)}</span><strong id="reading-${room}">—</strong><span class="room-reading-detail" id="airflow-${room}">—</span></button>`).join('')}</div>
    </section>
    </section>
    <section id="cooling-lab-workspace" aria-labelledby="cooling-lab-title" hidden>
      <div class="workspace-heading"><div><h1 id="cooling-lab-title" tabindex="-1">Cooling Lab</h1><p>Compare a window-fan idea with your starting setup.</p></div><button class="button secondary" data-workspace="flat">Back to flat</button></div>
      <div id="cooling-lab-mount" tabindex="-1"></div>
    </section>
    <section id="contractor-study-workspace" aria-labelledby="contractor-study-title" hidden>
      <div class="workspace-heading"><div><h1 id="contractor-study-title" tabindex="-1">Contractor study</h1><p>Compare floor plans and design choices under shared assumptions.</p></div><button class="button secondary" data-workspace="flat">Back to flat</button></div>
      <div id="contractor-study-mount" tabindex="-1"></div>
    </section>
    <footer class="app-footer"><p>${icon('info')}Qualitative toy CFD. Simulated conditions, no sensors.</p><button class="text-link" data-action="about">How this model works</button><button class="text-link" data-action="help">Keyboard shortcuts</button><span>Made for exploring. Built for the tabletop.</span></footer>
  </main>
  <dialog id="build-dialog" class="build-dialog" aria-labelledby="build-dialog-title"><div class="dialog-heading"><div><span class="dialog-kicker">From screen to cardboard</span><h2 id="build-dialog-title">Your physical build pack</h2></div><button class="icon-button" data-close aria-label="Close build guide">${icon('close')}</button></div><div class="build-content"><div class="build-plan"><img src="/build-pack/floor-plan.svg" alt="Dimensioned HDB four-room floor plan at 1:65 scale"><span>Print at 100% / Actual size. Do not fit to page.</span></div><div class="build-details"><p class="build-intro">A full floor plan that fits comfortably inside your 15 × 20 cm limit, on an A4 base.</p><dl class="build-specs"><div><dt>Building footprint</dt><dd>187.69 × 118.46 mm</dd></div><div><dt>Wall height</dt><dd>40 mm</dd></div><div><dt>Model scale</dt><dd>1:65</dd></div><div><dt>Cardboard throughout</dt><dd>3 mm · no roof</dd></div><div><dt>Material needed</dt><dd>2 A4 sheets total</dd></div><div><dt>A4 cardboard base</dt><dd>210 × 297 mm</dd></div></dl><a class="button primary full-width" href="/build-pack/index.html" target="_blank" rel="noopener">${icon('plan')}Open the complete build guide ${icon('external')}</a><div class="build-downloads"><a href="/build-pack/all-walls-stock.svg" download>${icon('download')}All 13 walls · one A4 sheet</a><a href="/build-pack/floor-plan.svg" download>${icon('download')}Floor plan SVG</a><a href="/build-pack/cut-list.csv" download>${icon('download')}Wall cut list CSV</a><a href="/build-pack/dimensions.json" download>${icon('download')}All dimensions JSON</a></div><p class="section-note">Build the walls first. Place servos and the SSTuino beside the building on the spare base area. Check the actual parts before cutting mounting holes.</p><p class="section-note">Representative 4-room layout, not an official HDB construction drawing.</p></div></div></dialog>
  <dialog id="readings-dialog" class="readings-dialog" aria-labelledby="readings-dialog-title"><div class="dialog-heading"><div><span class="dialog-kicker">Every room, at a glance</span><h2 id="readings-dialog-title">Room readings</h2></div><button class="icon-button" data-close aria-label="Close room readings">${icon('close')}</button></div><p class="dialog-note">Illustrative values at <span id="readings-time"></span>. These are not sensor measurements.</p><div class="readings-table-wrap"><table><thead><tr><th>Room</th><th>Temperature</th><th>Feels like</th><th>Air speed</th><th>PM2.5</th></tr></thead><tbody id="readings-table"></tbody></table></div><button class="button secondary" data-action="export">${icon('download')}Export this snapshot</button></dialog>
  <dialog id="about-dialog" class="about-dialog" aria-labelledby="about-dialog-title"><div class="dialog-heading"><h2 id="about-dialog-title">A model for asking “what if?”</h2><button class="icon-button" data-close aria-label="Close explanation">${icon('close')}</button></div><p>${escape(SIMULATION_NOTE)}</p><p>Change a scenario or a control, then let simulated time pass. Temperature and particles respond gradually. Fans move air and change perceived comfort; air conditioning cools rooms and uses electricity.</p><p>The pressure view shows the 2D solver’s relative pressure potential, normalised from −1 to +1 within the current layout. It is a dimensionless simulated index, not pressure in pascals (Pa). Colours show relative differences within one arrangement; airflow arrows show the solved direction of travel.</p><p>The 3D view and cardboard plans use the same floor-plan geometry. Cutaway walls, overlays and camera changes only change the view.</p><p>Use this to compare ideas for your presentation. It is not a building assessment or a source of measured indoor air quality.</p></dialog>
  <dialog id="help-dialog" class="help-dialog" aria-labelledby="help-dialog-title"><div class="dialog-heading"><div><span class="dialog-kicker">Presentation controls</span><h2 id="help-dialog-title">Keep the demo in your hands</h2></div><button class="icon-button" data-close aria-label="Close keyboard help">${icon('close')}</button></div><div class="keyboard-help"><p><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><span>Bedroom 3 north / living south / living east window</span></p><p><kbd>Shift</kbd> + <kbd>1</kbd><kbd>2</kbd><span>Main door / Bedroom 3 door</span></p><p><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd><kbd>T</kbd><kbd>Y</kbd><span>The six scenarios, in order</span></p><p><kbd>F</kbd><kbd>A</kbd><kbd>P</kbd><span>Fan / AC / purifier power</span></p><p><kbd>[</kbd><kbd>]</kbd><span>Fan direction ±15°</span></p><p><kbd>,</kbd><kbd>.</kbd><span>Previous / next fan position</span></p><p><kbd>−</kbd><kbd>=</kbd><span>Decrease / increase fan speed</span></p><p><kbd>Shift</kbd> + <kbd>P</kbd><span>Next purifier position</span></p><p><kbd>O</kbd><kbd>Enter</kbd><span>Compare layouts / apply suggestion</span></p><p><kbd>Space</kbd><kbd>Backspace</kbd><span>Pause / reset simulation</span></p><p><kbd>C</kbd><kbd>H</kbd><span>Connect SSTuino / show this help</span></p></div><p class="section-note">Tab moves between accessible controls. Shortcuts pause while you use a form field or dialog. Unmapped window and door keys do nothing.</p></dialog>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>`;

const doorRooms: Record<string, string[]> = {
  main_door: ['dining'], door_master_bedroom: ['master_bedroom', 'corridor'], door_common_bath: ['common_bath', 'corridor'],
  door_bedroom2: ['bedroom2', 'corridor'], door_bedroom3: ['bedroom3', 'corridor'], door_master_bath: ['master_bedroom', 'master_bath'],
  door_kitchen: ['kitchen', 'corridor'], door_service_yard: ['kitchen', 'service_yard'], door_shelter: ['household_shelter', 'corridor_lobby'],
};
function windowRoom(id: string): string {
  if (id.startsWith('window_master_bath')) return 'master_bath';
  if (id.startsWith('window_master_')) return 'master_bedroom';
  return id.replace(/^window_/, '').replace(/_\d+$/, '');
}
function openingLabel(box: ModelBox): string {
  if (box.type === 'window') return `${roomLabel((box.wall ?? '').replace('wall_ext_', ''))} window${/\d$/.test(box.name) ? ` ${box.name.slice(-1)}` : ''}`;
  if (box.name === 'main_door') return 'Main entrance door';
  const rooms = doorRooms[box.name] ?? [];
  const other = rooms.find(room => room !== view.selectedRoom);
  return other ? `Door to ${roomLabel(other).toLowerCase()}` : 'Room door';
}
function checkControlMappings(): void {
  const rooms = new Set(model.rooms.map(room => room.name));
  for (const box of model.boxes) {
    if (box.type !== 'window' && box.type !== 'door') continue;
    const reachableRooms = box.type === 'window' ? [windowRoom(box.name)] : doorRooms[box.name] ?? [];
    if (!reachableRooms.length || reachableRooms.some(room => !rooms.has(room))) throw new Error(`No room control for ${box.name}`);
  }
}
function toggleControl(kind: 'window' | 'door' | 'device', id: string, label: string, active: boolean): string {
  return `<label class="toggle-control" for="control-${id}"><span>${escape(label)}<small data-control-status="${id}">${kind === 'device' ? (active ? 'On' : 'Off') : (active ? 'Open' : 'Closed')}</small></span><input type="checkbox" id="control-${id}" data-control="${kind}" data-id="${id}" ${active ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span></label>`;
}
function renderRoomControls(): void {
  const room = model.rooms.find(room => room.name === view.selectedRoom)!;
  const windows = model.boxes.filter(box => box.type === 'window' && windowRoom(box.name) === room.name);
  const doors = model.boxes.filter(box => box.type === 'door' && doorRooms[box.name]?.includes(room.name));
  const devices = Object.keys(deviceRoom).filter(id => deviceRoom[id] === room.name);
  $('#room-detail').innerHTML = `<div class="selected-room-info"><span>${room.area_m2.toFixed(1)} m² floor area</span><span>${((room.max[0] - room.min[0]) * 1000 / 65).toFixed(1)} × ${((room.max[2] - room.min[2]) * 1000 / 65).toFixed(1)} mm at 1:65</span></div><div class="selected-room-reading"><strong id="selected-temperature">—</strong><span id="selected-comfort">Estimated room conditions</span></div><h3 class="control-group-title">Windows & doors</h3>${windows.concat(doors).map(box => toggleControl(box.type as 'window' | 'door', box.name, openingLabel(box), box.type === 'window' ? conditions.windows[box.name] : conditions.doors[box.name])).join('') || '<p class="section-note">This space connects through adjacent rooms. Select a neighbouring room to change its openings.</p>'}<h3 class="control-group-title">Room devices</h3>${devices.map(id => toggleControl('device', id, id.startsWith('fan_') ? 'Ceiling fan' : id.startsWith('ac_') ? 'Air conditioning' : 'Air purifier', conditions.devices[id])).join('') || '<p class="section-note">No powered devices in this room.</p>'}<p class="section-note room-note">Door and window states also respond to a connected physical model.</p>`;
  syncControls();
  renderReadings();
}

function selectTab(tab: string): void {
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => {
    const active = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    $(`#panel-${button.dataset.tab}`).hidden = !active;
  });
}
function selectRoom(id: string | null): void {
  if (!id) return;
  if (!model.rooms.some(room => room.name === id)) return;
  view.selectedRoom = id;
  $<HTMLSelectElement>('#room-select').value = id;
  selectTab('room');
  renderRoomControls();
  document.querySelectorAll<HTMLButtonElement>('[data-room]').forEach(button => {
    button.classList.toggle('selected', button.dataset.room === id);
    button.setAttribute('aria-pressed', String(button.dataset.room === id));
  });
  updateScene();
}

function syncControls(): void {
  document.querySelectorAll<HTMLInputElement>('[data-field]').forEach(input => {
    const field = input.dataset.field as keyof Conditions;
    const value = conditions[field] as number;
    input.value = String(value);
    $(`#${field}-value`).textContent = field === 'timeOfDay' ? formatTime(value) : `${value}${input.dataset.unit}`;
    input.style.setProperty('--range-progress', `${(value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
  });
  document.querySelectorAll<HTMLInputElement>('[data-weather-number]').forEach(input => {
    input.value = String(conditions[input.dataset.weatherNumber as 'outdoorTemperature' | 'windSpeed' | 'outdoorPm25']);
  });
  const direction = $<HTMLSelectElement>('#windFrom');
  const scenario = SCENARIOS.find(item => item.id === conditions.scenarioId) ?? SCENARIOS[0];
  direction.value = conditions.windFrom ?? '';
  direction.options[0].textContent = `Scenario direction (${scenario.windward === 'N' ? 'north' : 'south'})`;
  $('#outdoor-source').textContent = `Base scenario: ${scenario.name}. Outdoor edits keep your current openings and devices.`;
  const aqi = pm25ToUsAqiEquivalent(conditions.outdoorPm25);
  const aqiInput = $<HTMLInputElement>('#outdoor-aqi');
  aqiInput.value = aqi === null ? '' : String(aqi);
  aqiInput.placeholder = aqi === null ? 'Beyond scale' : '';
  $('#outdoor-aqi-range').hidden = aqi !== null;
  document.querySelectorAll<HTMLInputElement>('[data-control]').forEach(input => {
    const group = input.dataset.control === 'window' ? 'windows' : input.dataset.control === 'door' ? 'doors' : 'devices';
    input.checked = conditions[group][input.dataset.id!];
    $(`[data-control-status="${input.dataset.id}"]`).textContent = group === 'devices' ? (input.checked ? 'On' : 'Off') : (input.checked ? 'Open' : 'Closed');
  });
  $('#window-count').textContent = `${Object.values(conditions.windows).filter(Boolean).length} / ${Object.keys(conditions.windows).length} open`;
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.preset === activePreset)));
  const fan = conditions.portableFan ?? { on: false, slot: 0, angleDeg: 90, speed: 2 };
  const purifier = conditions.purifier ?? { on: false, slot: 0 };
  $<HTMLInputElement>('[data-device-key="fanOn"]').checked = fan.on;
  $<HTMLSelectElement>('#fan-slot').value = String(fan.slot);
  $<HTMLInputElement>('#fan-angle').value = String(fan.angleDeg);
  $('#fan-angle').style.setProperty('--range-progress', `${fan.angleDeg / 180 * 100}%`);
  $('#fan-angle-value').textContent = `${fan.angleDeg}°`;
  $<HTMLSelectElement>('#fan-speed').value = String(fan.speed);
  $('#fan-state').textContent = fan.on ? 'On' : 'Off';
  $<HTMLInputElement>('[data-device-key="purifierOn"]').checked = purifier.on;
  $<HTMLSelectElement>('#purifier-slot').value = String(purifier.slot);
  $('#purifier-state').textContent = purifier.on ? 'On' : 'Off';
  const activeAc = Object.keys(conditions.devices).find(id => id.startsWith('ac_') && conditions.devices[id]);
  $<HTMLInputElement>('[data-device-key="acOn"]').checked = Boolean(activeAc);
  $('#ac-state').textContent = activeAc ? 'On' : 'Off';
  if (activeAc) $<HTMLSelectElement>('#ac-unit').value = activeAc;
}
function updateScene(): void {
  if (workspace === 'study') return;
  const preview = workspace === 'lab' && coolingLab ? coolingLab.readPreviewConditions() : conditions;
  scene?.update(preview, result, view);
}
function selectWorkspace(next: Workspace): void {
  if (next === workspace) return;
  const lab = next === 'lab';
  const study = next === 'study';
  const labSection = $('#cooling-lab-workspace');
  const studySection = $('#contractor-study-workspace');
  if (lab && !coolingLab) {
    labSection.hidden = false;
    try {
      coolingLab = mountCoolingLab($('#cooling-lab-mount'), {
        readConditions,
        selectedRoom: () => view.selectedRoom,
        onVentChange(vent) {
          thermalVent = vent ? { ...vent } : null;
          if (workspace === 'lab') { scene?.setThermalVent(thermalVent); updateScene(); }
        },
      });
    } catch (error) {
      labSection.hidden = true;
      $('#cooling-lab-mount').replaceChildren();
      console.error('Unable to initialize Cooling Lab', error);
      notify('Cooling Lab could not start. The flat simulation is still available.');
      return;
    }
  }
  if (study && !contractorStudy) {
    studySection.hidden = false;
    try {
      contractorStudy = mountContractorStudy($('#contractor-study-mount'), { readConditions });
    } catch (error) {
      studySection.hidden = true;
      $('#contractor-study-mount').replaceChildren();
      console.error('Unable to initialize Contractor study', error);
      notify('Contractor study could not start. Your current workspace is still available.');
      return;
    }
  }
  invalidateGpuStep();
  const panel = $('.model-panel');
  if (workspace === 'lab') {
    $('#flat-workspace .workspace').prepend(panel);
    view.mode = flatViewMode;
  }
  if (lab) {
    flatViewMode = view.mode;
    $('#cooling-lab-mount [data-lab-model-slot]').append(panel);
    view.mode = 'model';
  }
  workspace = next;
  $('#flat-workspace').hidden = next !== 'flat';
  labSection.hidden = !lab;
  studySection.hidden = !study;
  $('.overlay-modes').hidden = lab;
  $<HTMLAnchorElement>('.skip-link').href = lab ? '#cooling-lab-mount' : study ? '#contractor-study-mount' : '#controls';
  document.querySelectorAll<HTMLButtonElement>('nav [data-workspace]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspace === next)));
  scene?.setPortableDraggingEnabled(next === 'flat');
  scene?.setThermalVent(lab ? thermalVent : null);
  updateOverlay();
  if (lab) {
    coolingLab?.refreshCaptureStatus();
    $('#view-label').textContent = '3D position preview';
    $('#view-description').textContent = 'Cooling Lab charts use a separate two-layer room model.';
    $('#cooling-lab-title').focus();
  } else if (study) {
    $('#contractor-study-title').focus();
  } else {
    $('nav [data-workspace="flat"]').focus();
  }
}
function isSeparateWorkspaceControl(target: HTMLElement): boolean {
  return Boolean(target.closest('#contractor-study-mount') || (target.closest('#cooling-lab-mount') && !target.closest('.model-panel')));
}
function emitControl(): void {
  window.dispatchEvent(new CustomEvent('heatsim:control', { detail: { conditions: readConditions() } }));
}
function markCustom(emit = false): void {
  invalidateGpuStep();
  coolingLab?.refreshCaptureStatus();
  invalidateOptimiser();
  activePreset = '';
  $('#scenario-label').textContent = 'Custom setup';
  $('#scenario-description').textContent = 'Your own experiment. Change a control and watch the rooms respond over time.';
  syncControls();
  updateScene();
  if (emit) emitControl();
}

export function applyHardwareControl(kind: 'window' | 'door' | 'device', id: string, active: boolean): boolean {
  const group = kind === 'window' ? 'windows' : kind === 'door' ? 'doors' : kind === 'device' ? 'devices' : null;
  if (!group || typeof active !== 'boolean' || !Object.hasOwn(conditions[group], id)) return false;
  if (conditions[group][id] === active) return true;
  if (kind === 'device' && id.startsWith('ac_') && active) {
    for (const key of Object.keys(conditions.devices)) if (key.startsWith('ac_')) conditions.devices[key] = false;
  }
  conditions[group][id] = active;
  markCustom();
  return true;
}
export function readConditions(): Conditions { return structuredClone(conditions); }
export function replaceConditions(next: Conditions, resetSimulation = false): void {
  if (!resetSimulation && JSON.stringify(next) === JSON.stringify(conditions)) return;
  conditions = structuredClone(next);
  if (resetSimulation) { result = createSimulation(conditions); history = []; lastSample = -1; }
  markCustom(); renderReadings();
}
export function loadScenario(id: string, source: 'user' | 'hardware' = 'user'): boolean {
  const preset = PRESETS.find(preset => preset.id === id);
  if (!preset) return false;
  invalidateGpuStep();
  invalidateOptimiser();
  conditions = { ...structuredClone(preset.conditions), doors: conditions.doors, windows: conditions.windows, devices: conditions.devices, portableFan: conditions.portableFan, purifier: conditions.purifier, acSetpoint: conditions.acSetpoint };
  if (id === 'validation' && source === 'user') {
    for (const box of model.boxes) if (box.type === 'door' && !box.exterior) conditions.doors[box.name] = true;
  }
  result = createSimulation(conditions);
  history = []; lastSample = -1;
  coolingLab?.refreshCaptureStatus();
  activePreset = preset.id;
  $('#scenario-label').textContent = preset.name;
  $('#scenario-description').textContent = preset.description;
  syncControls(); renderReadings(); updateScene();
  if (source === 'user') emitControl();
  notify(id === 'validation' && source === 'user' ? 'Validation case loaded. Internal doors opened; exterior openings and devices kept.' : `${preset.name} loaded. Openings and devices kept.`);
  return true;
}
function editDevice(key: string, value: number | boolean | string): void {
  const fan = conditions.portableFan ??= { on: false, slot: 0, angleDeg: 90, speed: 2 };
  const purifier = conditions.purifier ??= { on: false, slot: 0 };
  switch (key) {
    case 'fanOn': fan.on = Boolean(value); break;
    case 'fanSlot': fan.slot = Math.max(0, Math.min(FAN_SLOTS.length - 1, Number(value))); break;
    case 'fanAngle': fan.angleDeg = Math.max(0, Math.min(180, Number(value))); break;
    case 'fanSpeed': fan.speed = Math.max(0, Math.min(3, Number(value))); break;
    case 'purifierOn': purifier.on = Boolean(value); break;
    case 'purifierSlot': purifier.slot = Math.max(0, Math.min(PURIFIER_SLOTS.length - 1, Number(value))); break;
    case 'acOn': {
      const unit = $<HTMLSelectElement>('#ac-unit').value;
      for (const id of Object.keys(conditions.devices)) if (id.startsWith('ac_')) conditions.devices[id] = id === unit && Boolean(value);
      break;
    }
    case 'acUnit': {
      const on = Object.keys(conditions.devices).some(id => id.startsWith('ac_') && conditions.devices[id]);
      for (const id of Object.keys(conditions.devices)) if (id.startsWith('ac_')) conditions.devices[id] = id === value && on;
      break;
    }
    default: return;
  }
  markCustom(true);
}

function invalidateOptimiser(): void {
  if (optimising) { optimiser.cancel(); optimising = false; }
  if (!optimiserInput) return;
  optimiserReport = null; optimiserInput = null; appliedLayout = null;
  $('#run-optimiser').innerHTML = 'Optimise layout <kbd>O</kbd>';
  $('#optimiser-result').innerHTML = '<p class="section-note">The setup changed. Run a new comparison for this arrangement.</p>';
}
function scoreComparison(current: number, suggested: number): string {
  if (current === suggested) return 'Same combined score';
  if (current === 0) return 'Combined score increased from zero';
  const percent = Math.abs((suggested - current) / current * 100).toFixed(1);
  if (percent === '0.0') return 'Same combined score at 0.1% precision';
  return `${percent}% ${suggested < current ? 'lower' : 'higher'} combined score`;
}
function renderOptimiserReport(): void {
  if (!optimiserReport) return;
  const report = optimiserReport;
  const layout = report.layouts[selectedLayout];
  if (!layout) return;
  const applied = appliedLayout === selectedLayout;
  const fan = layout.conditions.portableFan;
  const purifier = layout.conditions.purifier;
  const ac = Object.entries(layout.conditions.devices).find(([id, on]) => id.startsWith('ac_') && on)?.[0];
  const positions = [
    fan?.on ? `Fan: ${roomLabel(FAN_SLOTS[fan.slot].room)}, ${fan.angleDeg}°, speed ${fan.speed}` : 'Portable fan off',
    purifier?.on ? `Portable purifier: ${roomLabel(PURIFIER_SLOTS[purifier.slot].room)}, position ${purifier.slot + 1}` : 'Portable purifier off',
    ac ? `AC: ${roomLabel(deviceRoom[ac])}, ${layout.conditions.acSetpoint}°C` : 'AC off',
    ...Object.entries(layout.conditions.devices).filter(([id, on]) => on && (id.startsWith('fan_') || id.startsWith('purifier_')))
      .map(([id]) => `${id.startsWith('fan_') ? 'Ceiling fan' : 'Fixed purifier'}: ${roomLabel(deviceRoom[id])}`),
  ];
  const comparison = scoreComparison(report.you.J, layout.J);
  const roundedScores = report.you.J !== layout.J && report.you.J.toFixed(2) === layout.J.toFixed(2);
  const openingChanges = [...Object.entries(layout.conditions.windows), ...Object.entries(layout.conditions.doors)].filter(([id, value]) => value !== (report.you.conditions.windows[id] ?? report.you.conditions.doors[id]));
  $('#optimiser-result').innerHTML = `<div class="optimiser-score"><div>${appliedLayout === null ? 'Your setup' : 'Before comparison'}<strong>${report.you.J.toFixed(2)}</strong></div><div>${applied ? 'Applied layout' : 'Suggested setup'}<strong>${layout.J.toFixed(2)}</strong></div></div><p class="optimiser-improvement ${comparison.startsWith('Same') ? 'is-equal' : layout.J > report.you.J ? 'is-worse' : ''}">${comparison} <span class="simulated-tag">SIMULATED</span></p><p class="section-note">${roundedScores ? 'The displayed scores are rounded; the comparison uses their full values. ' : ''}Heat ${layout.breakdown.heat.toFixed(2)} + haze ${layout.breakdown.haze.toFixed(2)} + power ${layout.breakdown.energy.toFixed(2)}. Both layouts start fresh and run for ${report.simulatedSeconds} simulated seconds.</p><div class="optimiser-layout">${positions.map(escape).join('<br>')}${openingChanges.length ? `<br>${openingChanges.length} opening change${openingChanges.length === 1 ? '' : 's'}` : ''}</div>${report.layouts.length > 1 ? `<label class="field-label" for="optimiser-alternative">Compared alternatives</label><select id="optimiser-alternative" class="device-select">${report.layouts.map((choice, index) => `<option value="${index}" ${index === selectedLayout ? 'selected' : ''}>${index === 0 ? 'Best found' : `Alternative ${index + 1}`} · score ${choice.J.toFixed(2)}</option>`).join('')}</select>` : ''}<div class="optimiser-result-actions spaced"><button id="apply-optimiser" class="button primary" data-action="apply-optimiser" ${applied ? 'disabled' : ''}>${applied ? 'Applied to your model' : 'Apply layout <kbd>Enter</kbd>'}</button></div>${applied ? '<p class="section-note">Your model now uses this arrangement. Live readings restarted; the comparison above remains available for your presentation.</p>' : ''}<p class="section-note">2D plan-view engine · ${report.evaluations} layouts · ${(report.durationMs / 1000).toFixed(1)} s${report.partial ? ' · time-limited search' : ''}. This score is an illustrative trade-off, not a health or engineering standard.</p>`;
}
const optimiser = createOptimiser({
  onProgress(progress) {
    $('#optimiser-result').innerHTML = `<progress class="optimiser-progress" value="${progress.done}" max="${progress.total}" aria-label="Layout comparison progress"></progress><p class="section-note">Comparing arrangements… ${progress.done} of about ${progress.total}. The 3D model stays interactive.</p>`;
  },
  onResult(report) {
    optimising = false;
    $('#run-optimiser').innerHTML = 'Compare again <kbd>O</kbd>';
    if (JSON.stringify(conditions) !== optimiserInput) { invalidateOptimiser(); return; }
    optimiserReport = report; selectedLayout = 0; renderOptimiserReport();
    notify('Comparison ready. Review the layout before applying it.');
  },
  onError(message) {
    optimising = false; optimiserInput = null;
    $('#run-optimiser').innerHTML = 'Try comparison again <kbd>O</kbd>';
    $('#optimiser-result').innerHTML = `<p class="section-note" role="alert">${escape(message)}</p>`;
  },
});
function runOptimiser(): void {
  selectTab('devices');
  if (optimising) { invalidateOptimiser(); notify('Comparison stopped.'); return; }
  optimiserReport = null; optimiserInput = JSON.stringify(conditions); optimising = true; appliedLayout = null;
  $('#run-optimiser').textContent = 'Cancel comparison';
  $('#optimiser-result').innerHTML = '<p class="section-note">Starting the comparison worker…</p>';
  optimiser.run(readConditions(), $<HTMLSelectElement>('#optimiser-budget').value as OptimiserBudget, $<HTMLInputElement>('#optimiser-openings').checked);
}

function renderReadings(): void {
  $('#mean-temperature').innerHTML = `${result.averageTemperature.toFixed(1)}<span>°C</span>`;
  $('#feels-like').textContent = `Feels like ${result.averageFeelsLike.toFixed(1)}°C`;
  $('#mean-pm25').innerHTML = `${result.averagePm25.toFixed(1)}<span>µg/m³</span>`;
  $('#power').innerHTML = `${Math.round(result.powerWatts).toLocaleString()}<span>W</span>`;
  $('#energy').textContent = `${result.energyKwh.toFixed(3)} kWh used`;
  $('#elapsed-time').textContent = elapsed(result.elapsedSeconds);
  for (const room of result.rooms) {
    const element = document.getElementById(`reading-${room.room}`);
    if (element) {
      element.innerHTML = `${room.temperature.toFixed(1)}<span>°C</span>`;
      $(`#airflow-${room.room}`).textContent = `${room.airflow.toFixed(2)} m/s air speed`;
    }
    if (room.room === view.selectedRoom) {
      const selected = document.getElementById('selected-temperature');
      if (selected) selected.innerHTML = `${room.temperature.toFixed(1)}<span>°C</span>`;
      const comfort = document.getElementById('selected-comfort');
      if (comfort) comfort.textContent = `Feels like ${room.feelsLike.toFixed(1)}°C · ${room.pm25.toFixed(1)} µg/m³ PM2.5`;
    }
  }
  if ($<HTMLDialogElement>('#readings-dialog').open) renderTable();
  const sample = Math.floor(result.elapsedSeconds / 10);
  if (sample !== lastSample) {
    lastSample = sample;
    history.push(result.averageTemperature);
    if (history.length > 80) history.shift();
    const min = Math.min(...history) - 0.3;
    const max = Math.max(...history) + 0.3;
    $('#temperature-history').innerHTML = `<path d="${history.map((value, index) => `${index === 0 ? 'M' : 'L'}${(index / Math.max(1, history.length - 1) * 160).toFixed(1)} ${(29 - (value - min) / (max - min) * 26).toFixed(1)}`).join(' ')}"/>`;
  }
}
function renderTable(): void {
  $('#readings-time').textContent = `${elapsed(result.elapsedSeconds)} simulated time`;
  $('#readings-table').innerHTML = result.rooms.map(room => `<tr><th scope="row">${roomLabel(room.room)}</th><td>${room.temperature.toFixed(1)}°C</td><td>${room.feelsLike.toFixed(1)}°C</td><td>${room.airflow.toFixed(2)} m/s</td><td>${room.pm25.toFixed(1)} µg/m³</td></tr>`).join('');
}
function updateOverlay(): void {
  const copy = {
    model: ['Your home, in perspective', 'Select a room to explore its controls.'],
    temperature: ['How heat moves through your home', 'Estimated room air temperature in °C.'],
    airflow: ['Make room for a breeze', 'Colour shows speed (m/s); arrows show airflow direction.'],
    pressure: ['What drives the airflow', 'Pressure potential, relative to this layout. Dimensionless, not Pa.'],
    pm25: ['The air you let in', 'Estimated indoor PM2.5 in µg/m³.'],
  }[view.mode];
  $('#view-label').textContent = copy[0];
  $('#view-description').textContent = copy[1];
  const legend = $('#model-legend');
  legend.hidden = view.mode === 'model';
  legend.className = `model-legend legend-${view.mode}`;
  const labels = { model: ['', ''], temperature: ['24°C', '40°C'], airflow: ['0 m/s', '1.5 m/s'], pressure: ['−1 low', '+1 high'], pm25: ['0', '250 µg/m³'] }[view.mode];
  legend.innerHTML = view.mode === 'pressure'
    ? `<span class="legend-caption">RELATIVE / SIMULATED</span><span>${labels[0]}</span><span class="pressure-scale"><i></i><small>0</small></span><span>${labels[1]}</span>`
    : `<span>${labels[0]}</span><i></i><span>${labels[1]}</span>`;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === view.mode)));
  updateScene();
}

let toastTimer: ReturnType<typeof setTimeout>;
function notify(message: string): void {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4500);
}
function download(url: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
}
function exportCsv(): void {
  const rows = [
    ['Model', 'Qualitative toy CFD - simulated conditions, no sensors'],
    ['Scenario', conditions.scenarioId ?? 'baseline'],
    ['Simulated seconds', result.elapsedSeconds.toFixed(1)],
    ['Outdoor temperature C', String(conditions.outdoorTemperature)],
    ['Outdoor PM2.5 ug/m3', String(conditions.outdoorPm25)],
    [US_PM25_AQI_EQUIVALENT_LABEL, String(pm25ToUsAqiEquivalent(conditions.outdoorPm25) ?? 'Beyond supported index scale')],
    ['Index interpretation', US_PM25_AQI_EQUIVALENT_NOTE],
    ['Relative humidity %', String(conditions.humidity)],
    ['Time of day', formatTime(conditions.timeOfDay)],
    ['Wind speed m/s', String(conditions.windSpeed)],
    ['Wind from', conditions.windFrom ?? (SCENARIOS.find(item => item.id === conditions.scenarioId) ?? SCENARIOS[0]).windward],
    ['Wind direction source', conditions.windFrom ? 'Manual override' : 'Scenario'],
    ['AC setpoint C', String(conditions.acSetpoint)],
    ['Portable fan on', String(conditions.portableFan?.on ?? false)],
    ['Portable fan slot (zero-based)', String(conditions.portableFan?.slot ?? 0)],
    ['Portable fan angle degrees', String(conditions.portableFan?.angleDeg ?? 90)],
    ['Portable fan speed', String(conditions.portableFan?.speed ?? 2)],
    ['Portable purifier on', String(conditions.purifier?.on ?? false)],
    ['Portable purifier slot (zero-based)', String(conditions.purifier?.slot ?? 0)],
    ['Device power W', result.powerWatts.toFixed(1)],
    ['Energy kWh', result.energyKwh.toFixed(4)],
    [], ['Room', 'Temperature C', 'Feels like C', 'Air speed m/s', 'PM2.5 ug/m3'],
    ...result.rooms.map(room => [roomLabel(room.room), room.temperature.toFixed(2), room.feelsLike.toFixed(2), room.airflow.toFixed(3), room.pm25.toFixed(2)]),
    [], ['Control', 'State'],
    ...Object.entries({ ...conditions.windows, ...conditions.doors, ...conditions.devices }).map(([id, value]) => [id, value ? '1' : '0']),
  ];
  const csv = rows.map(row => row.map(cell => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  download(url, `heatsim-snapshot-${Math.floor(result.elapsedSeconds)}s.csv`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Simulation snapshot exported.');
}

document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!target) return;
  if (target.dataset.workspace === 'flat' || target.dataset.workspace === 'lab' || target.dataset.workspace === 'study') { selectWorkspace(target.dataset.workspace); return; }
  if (isSeparateWorkspaceControl(target)) return;
  if (target.hasAttribute('data-close')) { target.closest<HTMLDialogElement>('dialog')?.close(); return; }
  if (target.dataset.tab) selectTab(target.dataset.tab);
  if (target.dataset.room) selectRoom(target.dataset.room);
  if (target.dataset.mode) { view.mode = target.dataset.mode as ViewMode; updateOverlay(); }
  if (target.dataset.camera) {
    camera = target.dataset.camera as 'perspective' | 'top';
    scene?.setCamera(camera);
    document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.camera === camera)));
  }
  if (target.dataset.preset) {
    loadScenario(target.dataset.preset);
  }
  if (target.dataset.bulk) {
    const group = target.dataset.bulk as 'windows' | 'doors';
    for (const id of Object.keys(conditions[group])) conditions[group][id] = target.dataset.value === 'true';
    markCustom(true);
  }
  switch (target.dataset.action) {
    case 'build': $<HTMLDialogElement>('#build-dialog').showModal(); break;
    case 'about': $<HTMLDialogElement>('#about-dialog').showModal(); break;
    case 'help': $<HTMLDialogElement>('#help-dialog').showModal(); break;
    case 'optimise': runOptimiser(); break;
    case 'apply-optimiser': {
      if (!optimiserReport || JSON.stringify(conditions) !== optimiserInput) { invalidateOptimiser(); break; }
      const report = optimiserReport;
      const layout = report.layouts[selectedLayout];
      replaceConditions(layout.conditions, true); emitControl();
      optimiserReport = report; optimiserInput = JSON.stringify(conditions); appliedLayout = selectedLayout;
      renderOptimiserReport();
      (document.getElementById('optimiser-alternative') ?? $('#run-optimiser')).focus();
      notify('Suggested layout applied. Simulation restarted for this arrangement.');
      break;
    }
    case 'readings': renderTable(); $<HTMLDialogElement>('#readings-dialog').showModal(); break;
    case 'export': exportCsv(); break;
    case 'play':
      invalidateGpuStep();
      playing = !playing;
      target.innerHTML = `${icon(playing ? 'pause' : 'play')}<span>${playing ? 'Pause' : 'Resume'}</span>`;
      $('#play-status').textContent = playing ? 'Simulation running' : 'Simulation paused';
      $('.running-dot').classList.toggle('paused', !playing);
      break;
    case 'reset':
      invalidateGpuStep();
      result = createSimulation(conditions); history = []; lastSample = -1; renderReadings(); updateScene();
      notify('Readings and time reset. Your controls are unchanged.'); break;
    case 'reset-weather': {
      const preset = PRESETS.find(item => item.id === conditions.scenarioId) ?? PRESETS[0];
      for (const field of ['outdoorTemperature', 'outdoorPm25', 'windSpeed', 'humidity', 'timeOfDay'] as const) conditions[field] = preset.conditions[field];
      delete conditions.windFrom;
      markCustom(true);
      notify('Scenario outdoor conditions restored. Your openings, devices and readings are unchanged.');
      break;
    }
    case 'reset-camera': scene?.resetCamera(); camera = 'perspective'; document.querySelectorAll<HTMLButtonElement>('[data-camera]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.camera === camera))); break;
    case 'screenshot':
      if (!scene) { notify('The 3D model is still loading.'); break; }
      try { download(scene.screenshot(), 'heatsim-model.png'); notify('Model image downloaded.'); }
      catch { notify('Image export is unavailable in this browser. You can use a screen capture.'); }
      break;
  }
});
document.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (isSeparateWorkspaceControl(input)) return;
  if (input.type === 'range' && input.dataset.deviceKey) { editDevice(input.dataset.deviceKey, Number(input.value)); return; }
  if (!input.dataset.field) return;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const field = input.dataset.field as 'outdoorTemperature' | 'outdoorPm25' | 'humidity' | 'windSpeed' | 'timeOfDay' | 'acSetpoint';
  conditions[field] = Math.min(Number(input.max), Math.max(Number(input.min), value));
  markCustom(true);
});
document.addEventListener('change', event => {
  const input = event.target as HTMLInputElement;
  if (isSeparateWorkspaceControl(input)) return;
  if (input.id === 'outdoor-aqi') {
    const concentration = usAqiEquivalentToPm25(input.valueAsNumber);
    if (concentration === null) { syncControls(); notify('Enter a whole-number US EPA PM2.5 index equivalent from 0 to 500.'); return; }
    if (conditions.outdoorPm25 !== concentration) { conditions.outdoorPm25 = concentration; markCustom(true); }
    else syncControls();
    return;
  }
  if (input.dataset.weatherNumber) {
    const field = input.dataset.weatherNumber as 'outdoorTemperature' | 'windSpeed' | 'outdoorPm25';
    const value = input.valueAsNumber;
    if (!Number.isFinite(value)) { syncControls(); notify(`Enter a number between ${input.min} and ${input.max}.`); return; }
    const bounded = Number(Math.min(Number(input.max), Math.max(Number(input.min), value)).toFixed(1));
    if (conditions[field] !== bounded) { conditions[field] = bounded; markCustom(true); }
    else syncControls();
    return;
  }
  if (input.id === 'windFrom') {
    if (input.value === '') delete conditions.windFrom;
    else if (['N', 'E', 'S', 'W'].includes(input.value)) conditions.windFrom = input.value as Conditions['windFrom'];
    else return;
    markCustom(true); return;
  }
  if (input.id === 'room-select') selectRoom(input.value);
  if (input.id === 'simulation-speed') {
    speed = Number(input.value);
    $('#speed-description').textContent = speed === 60 ? '1 simulated minute' : `${speed} simulated second${speed === 1 ? '' : 's'}`;
  }
  if (input.id === 'optimiser-alternative') { selectedLayout = Number(input.value); renderOptimiserReport(); $('#optimiser-alternative').focus(); }
  if (input.id === 'optimiser-budget' || input.id === 'optimiser-openings') invalidateOptimiser();
  if (input.dataset.control) {
    applyHardwareControl(input.dataset.control as 'window' | 'door' | 'device', input.dataset.id!, input.checked);
    emitControl();
  }
  if (input.dataset.deviceKey && input.type !== 'range') editDevice(input.dataset.deviceKey, input.type === 'checkbox' ? input.checked : input.value);
  if (input.dataset.view) { view[input.dataset.view as 'cutaway' | 'labels' | 'dimensions'] = input.checked; updateScene(); }
});
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
}));
$('.control-tabs').addEventListener('keydown', event => {
  const keyEvent = event as KeyboardEvent;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(keyEvent.key)) return;
  keyEvent.preventDefault();
  const tabs = ['environment', 'room', 'devices'];
  const index = tabs.findIndex(tab => $(`#tab-${tab}`).getAttribute('aria-selected') === 'true');
  const tab = keyEvent.key === 'Home' ? tabs[0] : keyEvent.key === 'End' ? tabs[2] : tabs[(index + (keyEvent.key === 'ArrowRight' ? 1 : 2)) % tabs.length];
  selectTab(tab); $(`#tab-${tab}`).focus();
});
document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  const target = event.target as HTMLElement;
  if (target.matches('input, select, textarea, [contenteditable="true"]')) return;
  if (document.querySelector('dialog[open]')) {
    if (event.key.toLowerCase() === 'h' && $<HTMLDialogElement>('#help-dialog').open) $<HTMLDialogElement>('#help-dialog').close();
    return;
  }
  if (workspace !== 'flat') return;
  if (target.closest('button, a, summary') && ['Enter', ' '].includes(event.key)) return;
  const digit = event.code.match(/^Digit([1-9])$/)?.[1];
  if (digit) {
    const opening = openingForKey(`${event.shiftKey ? 'DOOR' : 'WIN'}${digit}`);
    if (opening) { applyHardwareControl(opening.kind, opening.id, !conditions[opening.kind === 'window' ? 'windows' : 'doors'][opening.id]); emitControl(); notify(`${opening.kind === 'window' ? 'Window' : 'Door'} ${digit} updated.`); }
    event.preventDefault(); return;
  }
  const scenarioIndex = 'qwerty'.indexOf(event.key.toLowerCase());
  if (scenarioIndex >= 0 && PRESETS[scenarioIndex]) { loadScenario(PRESETS[scenarioIndex].id); event.preventDefault(); return; }
  const fan = conditions.portableFan ?? { on: false, slot: 0, angleDeg: 90, speed: 2 };
  const purifier = conditions.purifier ?? { on: false, slot: 0 };
  switch (event.key.toLowerCase()) {
    case 'f': editDevice('fanOn', !fan.on); break;
    case 'p': editDevice(event.shiftKey ? 'purifierSlot' : 'purifierOn', event.shiftKey ? (purifier.slot + 1) % PURIFIER_SLOTS.length : !purifier.on); break;
    case 'a': editDevice('acOn', !$<HTMLInputElement>('[data-device-key="acOn"]').checked); break;
    case '[': editDevice('fanAngle', fan.angleDeg - 15); break;
    case ']': editDevice('fanAngle', fan.angleDeg + 15); break;
    case ',': editDevice('fanSlot', (fan.slot + FAN_SLOTS.length - 1) % FAN_SLOTS.length); break;
    case '.': editDevice('fanSlot', (fan.slot + 1) % FAN_SLOTS.length); break;
    case '-': editDevice('fanSpeed', fan.speed - 1); break;
    case '=': editDevice('fanSpeed', fan.speed + 1); break;
    case ' ': $('[data-action="play"]').click(); break;
    case 'backspace': $('[data-action="reset"]').click(); break;
    case 'c': $('#connect-hardware').click(); break;
    case 'h': $<HTMLDialogElement>('#help-dialog').showModal(); break;
    case 'o': selectTab('devices'); $('#run-optimiser').click(); break;
    case 'enter': document.getElementById('apply-optimiser')?.click(); break;
    default: return;
  }
  event.preventDefault();
});

checkControlMappings(); renderRoomControls(); syncControls(); renderReadings();
createScene($('#scene'), selectRoom, (kind, slotId) => {
  if (workspace === 'flat') editDevice(kind === 'fan' ? 'fanSlot' : 'purifierSlot', slotId);
}).then(controller => {
  scene = controller;
  $('#scene-loading').remove();
  scene.setPortableDraggingEnabled(workspace === 'flat');
  scene.setThermalVent(workspace === 'lab' ? thermalVent : null);
  updateScene();
}).catch(error => {
  console.error('Unable to initialize 3D scene', error);
  $('#scene-loading').innerHTML = `${icon('plan')}<strong>The 3D view could not start</strong><span>Try desktop Chrome with graphics acceleration enabled. Controls and the printable floor plan still work.</span><a class="button secondary" href="/build-pack/index.html" target="_blank" rel="noopener">Open printable floor plan</a>`;
});
function invalidateGpuStep(): void {
  simulationRevision++;
  gpuPendingSeconds = 0;
}
function useCpuFallback(error: unknown): void {
  const failed = gpu;
  gpu = null;
  invalidateGpuStep();
  failed?.dispose();
  $('#simulation-engine').textContent = 'CPU · 2D';
  console.warn('WebGPU unavailable; continuing on CPU', error);
  notify('GPU processing stopped. The simulation continues on CPU with your current readings.');
}
function advanceGpu(seconds: number): void {
  gpuPendingSeconds = Math.min(gpuPendingSeconds + seconds, 15);
  if (gpuBusy || !gpu || gpuPendingSeconds <= 0) return;
  const engine = gpu;
  const previous = result;
  const revision = simulationRevision;
  const captured = readConditions();
  const duration = gpuPendingSeconds;
  gpuPendingSeconds = 0;
  gpuBusy = true;
  void Promise.resolve().then(() => engine.step(previous, captured, duration)).then(next => {
    if (gpu !== engine || revision !== simulationRevision || result !== previous || !playing || document.hidden || workspace !== 'flat' || disposed) return;
    if (![next.averageTemperature, next.averagePm25, next.powerWatts, next.elapsedSeconds].every(Number.isFinite)) throw new Error('Invalid GPU readings');
    result = next;
    $('#simulation-engine').textContent = engine.label;
  }).catch(error => {
    if (gpu === engine && !disposed) useCpuFallback(error);
  }).finally(() => { gpuBusy = false; });
}
void createPlanGpu().then(engine => {
  if (disposed) { engine.dispose(); return; }
  gpu = engine;
  engine.onLost = reason => { if (gpu === engine && !disposed) useCpuFallback(reason); };
}).catch(() => {});

function animate(time: number): void {
  const delta = Math.min((time - previousTime) / 1000, 0.25);
  previousTime = time;
  if (playing && !document.hidden && workspace === 'flat') {
    try {
      if (gpu) advanceGpu(delta * speed);
      else result = stepSimulation(result, conditions, delta * speed);
      if (![result.averageTemperature, result.averagePm25, result.powerWatts].every(Number.isFinite)) {
        result = createSimulation(conditions);
        invalidateGpuStep();
        notify('Simulation reset after an unstable reading. Your controls are unchanged.');
      }
    } catch (error) {
      console.error('Simulation paused after an error', error);
      playing = false;
      $('[data-action="play"]').innerHTML = `${icon('play')}<span>Resume</span>`;
      $('#play-status').textContent = 'Simulation paused';
      $('.running-dot').classList.add('paused');
      notify('Simulation paused. Reset the readings, then resume. Your controls are unchanged.');
    }
  }
  if (workspace !== 'study' && time - lastPaint > 250) { renderReadings(); updateScene(); lastPaint = time; }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
document.addEventListener('visibilitychange', () => { if (document.hidden) invalidateGpuStep(); });
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  disposed = true;
  invalidateGpuStep();
  gpu?.dispose();
  gpu = null;
  coolingLab?.dispose();
  contractorStudy?.dispose();
  scene?.dispose();
  optimiser.dispose();
});
