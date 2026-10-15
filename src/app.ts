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
import { PRIMARY_STANDING_FAN_ID, MAX_STANDING_FANS, STANDING_FAN_CLEARANCE_M, PORTABLE_PURIFIER_CLEARANCE_M, resolveStandingFans, validateStandingFanPosition, findStandingFanPosition } from './standing-fans';
import { openingForKey } from './config/mapping';
import { createOptimiser, type OptimiserReport, type OptimiserBudget } from './optimiser';
import { describeAdviceChanges, describeAdviceOutcome, hardwareOwnedControlsMatch } from './homeowner-advice';
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
  chevron: '<path d="m6 9 6 6 6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
};
const icon = (name: string, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name] ?? icons.house}</svg>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing interface element: ${selector}`);
  return element;
};
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

const bedroom3PurifierSlot = PURIFIER_SLOTS.findIndex(slot => slot.room === 'bedroom3');
let conditions: Conditions = structuredClone(PRESETS[0]?.conditions ?? defaultConditions());
if (bedroom3PurifierSlot >= 0) conditions.purifier = { on: conditions.purifier?.on ?? false, slot: bedroom3PurifierSlot };
let result = createSimulation(conditions);
let view = { ...defaultView, selectedRoom: 'living' as string | null };
let scene: SceneController | null = null;
let fallbackPlan = false;
let selectedStandingFan = PRIMARY_STANDING_FAN_ID;
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
let undoAdvice: { before: Conditions; applied: string } | null = null;
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
    <span class="brand-description">Home airflow simulator</span>
    <div class="header-actions"><button class="simulation-status" data-action="about">Simulated, not measured</button><span id="model-connection-chip" hidden>Model connected</span><details id="more-menu" class="more-menu"><summary>More ${icon('chevron')}</summary><div class="more-content"><button class="button text-button" data-action="guide">How to use HeatSim</button><button class="button text-button" data-action="build">Build the cardboard model</button><button class="button text-button" data-action="readings">All room readings</button><button class="button text-button" data-action="export">Export readings (CSV)</button><button class="button text-button" data-action="screenshot">Download map image</button><details id="science-settings"><summary>Science views</summary><label class="option-check"><input id="science-views" type="checkbox">Show pressure and validation</label><div id="science-status"></div></details><div id="hardware-menu-slot"></div><button class="button text-button" data-action="about">How this model works</button><button class="button text-button" data-action="help">Keyboard shortcuts</button></div></details></div>
  </header>
  <main>
    <div class="workspace-heading workspace-navigation"><nav class="segmented" aria-label="HeatSim workspace"><button data-workspace="flat" aria-controls="flat-workspace" aria-pressed="true">${icon('house')}My flat</button><button data-workspace="lab" aria-controls="cooling-lab-workspace" aria-pressed="false">${icon('wind')}Window fan test</button><button data-workspace="study" aria-controls="contractor-study-workspace" aria-pressed="false">${icon('plan')}Compare floor plans</button></nav><button class="text-link start-guide-link" data-action="guide">How to use HeatSim</button></div>
    <section id="flat-workspace" aria-label="Flat simulation">
    <div class="question-bar"><h1 class="sr-only">My flat</h1><label for="day-select">It’s a <select id="day-select" aria-label="Choose the day">${PRESETS.map(preset => `<option value="${preset.id}" ${preset.id === 'validation' ? 'hidden' : ''}>${escape(preset.name)}</option>`).join('')}</select><span> in your 4-room flat.</span></label><span id="custom-day-note" hidden>Custom settings</span><div id="playback-slot"></div></div>
    <div class="workspace">
      <section class="model-panel" aria-label="Interactive apartment model">
        <div class="model-toolbar"><div class="segmented overlay-modes" role="group" aria-label="Model overlay">
          ${(['model', 'temperature', 'airflow', 'pressure', 'pm25'] as ViewMode[]).map(mode => `<button data-mode="${mode}" ${mode === 'pressure' ? 'hidden' : ''} aria-pressed="${mode === 'model'}">${({ model: 'Model', temperature: 'Heat', airflow: 'Air movement', pressure: 'Pressure', pm25: 'Haze' })[mode]}</button>`).join('')}
        </div></div>
        <div id="scene" class="scene" aria-label="3D apartment. Drag to orbit, scroll to zoom. Use room selector for keyboard access."><div id="scene-loading" class="scene-message" role="status"><span class="loading-mark">${icon('cube')}</span><strong>Setting up your home</strong><span>Preparing the 3D floor plan…</span></div></div>
        <div class="model-title"><span id="view-label">Your home, in perspective</span><p id="view-description">Select a room to explore its controls. Arrows show airflow; none appear in still air.</p></div>
        <div class="view-tools"><div class="segmented camera-modes" role="group" aria-label="Camera view"><button data-camera="perspective" aria-pressed="true">${icon('cube')}<span>Isometric</span></button><button data-camera="top" aria-pressed="false">${icon('plan')}<span>Floor plan</span></button></div><button class="icon-button" data-action="reset-camera" title="Reset view" aria-label="Reset camera view">${icon('reset')}</button></div>
        <details class="view-disclosure"><summary>View</summary><div class="view-options" aria-label="Model display options"><label><input type="checkbox" data-view="cutaway" checked>Cutaway</label><label><input type="checkbox" data-view="labels" checked>Room labels</label><label><input type="checkbox" data-view="dimensions">Dimensions</label></div></details>
        <div class="model-legend" id="model-legend" hidden></div>

      </section>
      <aside class="control-panel" id="controls" aria-labelledby="manual-controls-title" tabindex="-1"><div class="manual-controls-heading"><h2 id="manual-controls-title">Make your own changes</h2><p>Adjust a room, place devices or set the weather.</p></div>
        <div class="control-tabs" role="tablist" aria-label="Control section"><button role="tab" id="tab-room" aria-controls="panel-room" aria-selected="true" data-tab="room">Windows & doors</button><button role="tab" id="tab-devices" aria-controls="panel-devices" aria-selected="false" tabindex="-1" data-tab="devices">Devices</button><button role="tab" id="tab-environment" aria-controls="panel-environment" aria-selected="false" tabindex="-1" data-tab="environment">Weather</button></div>
        <div class="control-scroll">
          <section id="panel-environment" role="tabpanel" aria-labelledby="tab-environment" hidden>
            <div class="section-heading"><h2>Try a scenario</h2><span id="scenario-label">Normal day</span></div>
            <div class="scenario-grid">${PRESETS.map((preset, index) => `<button class="scenario-button" data-preset="${escape(preset.id)}" ${preset.id === 'validation' ? 'hidden' : ''} aria-pressed="false"><span class="scenario-symbol">${icon(index === 1 ? 'wind' : index === 2 ? 'house' : index === 3 ? 'info' : 'sun')}</span><span>${escape(preset.name)}</span></button>`).join('')}</div>
            <p class="section-note" id="scenario-description">Change the conditions, then watch the rooms respond over time.</p>
            <details id="manual-weather" class="manual-disclosure"><summary>Set my own weather</summary><div class="disclosure-body">
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
            <p class="section-note">Outdoor values are what you set here. No sensors or live weather. Choosing another day clears weather overrides.</p></div></details>

          </section>
          <section id="panel-room" role="tabpanel" aria-labelledby="tab-room">
            <div class="section-divider"></div><div class="section-heading"><h2>Whole-home openings</h2><span id="window-count"></span></div>
            <div class="button-pair"><button class="button secondary" data-bulk="windows" data-value="true">Open windows</button><button class="button secondary" data-bulk="windows" data-value="false">Close windows</button></div>
            <div class="button-pair"><button class="button text-button" data-bulk="doors" data-value="true">Open all doors</button><button class="button text-button" data-bulk="doors" data-value="false">Close all doors</button></div>
            <p class="section-note">Opening windows exchanges indoor air with outdoors. On hazy days, this can bring particles inside.</p>
            <label class="field-label" for="room-select">Select a room</label><select id="room-select">${model.rooms.map(room => `<option value="${room.name}" ${room.name === 'living' ? 'selected' : ''}>${roomLabel(room.name)}</option>`).join('')}</select>
            <div id="room-detail"></div>
          </section>
          <section id="panel-devices" role="tabpanel" aria-labelledby="tab-devices" hidden>
            <h2 class="section-title">Place your devices</h2><p class="section-note">Drag standing fans onto clear floor space, or use the position controls. Each powered fan contributes to simulated airflow and electricity.</p>
            <h3 class="control-group-title">Standing fans <span id="standing-fan-count">1 / 8</span></h3>
            <div class="standing-fan-editor">
              <label class="field-label" for="standing-fan-select">Fan to adjust</label><select id="standing-fan-select" class="device-select"><option value="primary">Main fan</option></select>
              <div class="button-pair standing-fan-actions"><button id="standing-fan-add" class="button secondary" data-action="add-standing-fan">Add fan</button><button id="standing-fan-remove" class="button text-button" data-action="remove-standing-fan" disabled>Remove fan</button></div>
              <div id="primary-fan-controls">
                <label class="toggle-control"><span>Main fan power <kbd>F</kbd><small id="fan-state">Off</small></span><input type="checkbox" data-device-key="fanOn" aria-label="Portable fan power"><span class="switch-track" aria-hidden="true"></span></label>
                <label class="field-label" for="fan-speed">Fan speed</label><select id="fan-speed" class="device-select" data-device-key="fanSpeed"><option value="0">Stopped</option><option value="1">Low</option><option value="2" selected>Medium</option><option value="3">High</option></select>
              </div>
              <div id="additional-fan-controls" hidden>
                <label class="toggle-control"><span>Selected fan power<small id="standing-fan-power-state">Off</small></span><input id="standing-fan-on" type="checkbox"><span class="switch-track" aria-hidden="true"></span></label>
                <label class="field-label" for="standing-fan-speed">Fan speed</label><select id="standing-fan-speed" class="device-select"><option value="0">Stopped</option><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select>
              </div>
              <div class="standing-fan-heading-row"><label class="field-label" for="standing-fan-heading">Direction (degrees)</label><input id="standing-fan-heading" class="device-select" type="number" min="0" max="359" step="1" aria-describedby="standing-fan-direction-note"></div>
              <p class="section-note" id="standing-fan-direction-note">Air blows towards 0° north, 90° east, 180° south or 270° west.</p>
              <label class="field-label spaced" for="standing-fan-room">Move to a room</label><select id="standing-fan-room" class="device-select">${model.rooms.map(room => `<option value="${room.name}">${roomLabel(room.name)}</option>`).join('')}</select>
              <details id="standing-fan-position" class="standing-fan-detail"><summary>Exact floor position</summary><p class="section-note">Metres from the plan’s northwest origin: X east, Z south.</p><div class="standing-fan-coordinates"><label for="standing-fan-x">X (m)<input id="standing-fan-x" class="device-select" type="number" step="0.01" min="${model.bounds.min[0]}" max="${model.bounds.max[0]}"></label><label for="standing-fan-z">Z (m)<input id="standing-fan-z" class="device-select" type="number" step="0.01" min="${model.bounds.min[2]}" max="${model.bounds.max[2]}"></label></div><button id="standing-fan-place" class="button secondary full-width" data-action="place-standing-fan">Set position</button></details>
              <details id="fan-presets" class="standing-fan-detail"><summary>Main fan presets & shortcuts</summary><p class="section-note">Presets replace the main fan’s free position and direction. Keyboard F, position and angle shortcuts always adjust the main fan.</p><label class="field-label spaced" for="fan-slot">Preset position</label><select id="fan-slot" class="device-select" data-device-key="fanSlot">${FAN_SLOTS.map((slot, index) => `<option value="${index}">${index + 1}. ${roomLabel(slot.room)}</option>`).join('')}</select><label class="range-control spaced" for="fan-angle"><span>Direction within preset<output id="fan-angle-value">90°</output></span><input id="fan-angle" type="range" min="0" max="180" step="15" value="90" data-device-key="fanAngle"><span class="range-limits"><span>0°</span><span>180°</span></span></label></details>
              <p id="standing-fan-status" class="section-note" role="status" aria-live="polite">Up to 8 standing fans. Keep walls, furniture and doorways clear.</p>
            </div>
            <h3 class="control-group-title">Air purifier <kbd>P</kbd></h3>
            <label class="toggle-control"><span>Purifier power<small id="purifier-state">Off</small></span><input type="checkbox" data-device-key="purifierOn" aria-label="Portable purifier power"><span class="switch-track" aria-hidden="true"></span></label>
            <label class="field-label spaced" for="purifier-slot">Position</label><select id="purifier-slot" class="device-select" data-device-key="purifierSlot">${PURIFIER_SLOTS.map((slot, index) => `<option value="${index}">${index + 1}. ${roomLabel(slot.room)}${index === 4 || index === bedroom3PurifierSlot ? ' corner' : ''}</option>`).join('')}</select><p class="section-note">The physical D5 switch controls the Bedroom 3 corner purifier: held down is on; released is off. You can also use these controls without a board.</p>
            <h3 class="control-group-title">Air conditioning <kbd>A</kbd></h3>
            <label class="toggle-control"><span>AC power<small id="ac-state">Off</small></span><input type="checkbox" data-device-key="acOn" aria-label="Air conditioning power"><span class="switch-track" aria-hidden="true"></span></label>
            <label class="field-label spaced" for="ac-unit">Room to cool</label><select id="ac-unit" class="device-select" data-device-key="acUnit">${Object.keys(deviceRoom).filter(id => id.startsWith('ac_')).map(id => `<option value="${id}">${roomLabel(deviceRoom[id])}</option>`).join('')}</select>
            <div class="spaced">${range('acSetpoint', 'Set temperature', 18, 30, 0.5, '°C')}</div>
            <section id="optimiser-panel" aria-label="What to try"><div class="advice-heading"><h2>What to try</h2><span class="simulated-tag">SIMULATED</span></div><p id="advice-room-context" class="advice-context">Explore a change for your home.</p><details id="advice-settings"><summary>Devices to test</summary><label class="field-label" for="optimiser-budget">Available devices</label><select id="optimiser-budget" class="device-select"><option value="fan">Fan only</option><option value="fan+purifier" selected>Fan + purifier</option><option value="fan+purifier+ac">Fan + purifier + AC</option></select><label class="option-check"><input id="optimiser-openings" type="checkbox" checked>Also suggest windows and doors</label><p class="section-note">Added fans stay fixed. Suggestions test preset positions for the main fan.</p></details><button class="button primary full-width" id="run-optimiser" data-action="optimise" aria-keyshortcuts="O" title="Suggest changes (O)">Suggest changes</button><div id="optimiser-result" aria-live="polite"><p class="section-note">Pick a day, then suggest changes. We’ll test fan, purifier and opening combinations and show what helped most.</p></div><p class="advice-honesty">A rough simulation to compare ideas, not a measurement or health advice.</p></section>
          </section>
          <details class="hardware-section"><summary>${icon('usb')}Connect physical model (USB)<span class="details-plus">+</span></summary><div id="hardware-controls"><p class="hardware-state"><span class="status-dot"></span><strong>SSTuino not connected</strong></p><p class="section-note">Everything works with the on-screen controls and keyboard. When your model is ready, connect USB to use its switches and buttons.</p><button class="button secondary full-width" id="connect-hardware" type="button">Connect SSTuino</button><p class="hardware-help" id="hardware-status" role="status">USB serial works in desktop Chrome or Edge.</p></div></details>
        </div>
        <div class="simulation-controls"><div class="simulation-clock"><span class="running-dot"></span><span id="play-status">Simulation running</span><output id="elapsed-time" aria-label="Elapsed simulated time" title="Elapsed simulated time">00:00:00</output></div><div class="playback-row"><button class="button play-button" data-action="play">${icon('pause')}<span>Pause</span></button><select id="simulation-speed" aria-label="Simulation speed"><option value="1">1× speed</option><option value="30" selected>30× speed</option><option value="60">60× speed</option></select><button class="icon-button" data-action="reset" aria-label="Reset simulation time and readings" title="Reset readings">${icon('reset')}</button></div><p class="speed-help">Target: 1 real second = <span id="speed-description">30 simulated seconds</span>. Actual progress may slow on busy devices.</p><p id="simulation-engine" role="status">CPU · 2D</p></div>
      </aside>
    </div>
    <section class="results-panel" aria-label="Simulated room readings">
      <div class="rooms-heading"><h2>Rooms</h2><span class="simulated-tag">SIMULATED</span><span id="room-sort-label">Warmest first</span></div>
      <div class="room-readings" aria-label="Select a room">${primaryRooms.map(room => `<div class="room-row" data-room-row="${room}"><button class="room-reading ${room === 'living' ? 'selected' : ''}" data-room="${room}" aria-pressed="${room === 'living'}"><span>${roomLabel(room)}</span><strong id="reading-${room}">—</strong><span class="room-reading-detail" id="airflow-${room}">—</span></button>${room === 'bedroom3' ? `<details id="bedroom3-purifier-monitor" class="bedroom-monitor" aria-label="Bedroom 3 simulated air quality"><summary><span id="bedroom3-purifier-status"></span> · PM2.5 <output id="bedroom3-pm25">—</output></summary><p>SIMULATED · ${escape(US_PM25_AQI_EQUIVALENT_LABEL)}: <output id="bedroom3-aqi-equivalent">—</output>. ${escape(US_PM25_AQI_EQUIVALENT_NOTE)} Particle levels respond gradually. D5 held down turns the Bedroom 3 purifier on; releasing it turns it off.</p><p><strong>Bedroom 3 windows</strong><br><output id="bedroom3-window-status"></output></p><button class="button secondary full-width" id="bedroom3-window-toggle" data-action="bedroom3-windows">Open both windows</button><p>D4 toggles both windows together. The individual controls remain independent.</p></details>` : ''}</div>`).join('')}</div>
      <button class="text-link show-all-rooms" data-action="show-all-rooms" aria-expanded="false">Show all rooms</button>
      <div class="flat-summary">Whole flat: <strong id="mean-temperature">—</strong> · PM2.5 <strong id="mean-pm25">—</strong> · <strong id="power">—</strong></div>
      <details class="reading-detail"><summary>Comfort & electricity</summary><span id="feels-like">Feels like —</span> · <span id="energy">0.000 kWh used</span><svg id="temperature-history" viewBox="0 0 160 32" aria-label="Average temperature trend" role="img"><path d="M0 24H160"/></svg></details>
    </section>
    </section>
    <section id="cooling-lab-workspace" aria-labelledby="cooling-lab-title" hidden>
      <div class="workspace-heading"><div><h1 id="cooling-lab-title" tabindex="-1">Window fan test</h1><p>Does a window fan help this room? Compare fan off and on under the same weather.</p></div><button class="button secondary" data-workspace="flat">Back to my flat</button></div>
      <div id="cooling-lab-mount" tabindex="-1"></div>
    </section>
    <section id="contractor-study-workspace" aria-labelledby="contractor-study-title" hidden>
      <div class="workspace-heading"><div><h1 id="contractor-study-title" tabindex="-1">Compare floor plans</h1><p>Compare homes under the same weather before you renovate or move.</p></div><button class="button secondary" data-workspace="flat">Back to my flat</button></div>
      <div id="contractor-study-mount" tabindex="-1"></div>
    </section>
    <footer class="app-footer"><p>${icon('info')}Qualitative toy CFD. Simulated conditions, no sensors.</p><button class="text-link" data-action="about">How this model works</button><button class="text-link" data-action="help">Keyboard shortcuts</button></footer>
  </main>
  <dialog id="build-dialog" class="build-dialog" aria-labelledby="build-dialog-title"><div class="dialog-heading"><div><span class="dialog-kicker">From screen to cardboard</span><h2 id="build-dialog-title">Your physical build pack</h2></div><button class="icon-button" data-close aria-label="Close build guide">${icon('close')}</button></div><div class="build-content"><div class="build-plan"><img src="/build-pack/floor-plan.svg" alt="Dimensioned HDB four-room floor plan at 1:65 scale"><span>Print at 100% / Actual size. Do not fit to page.</span></div><div class="build-details"><p class="build-intro">A full floor plan that fits comfortably inside your 15 × 20 cm limit, on an A4 base.</p><dl class="build-specs"><div><dt>Building footprint</dt><dd>187.69 × 118.46 mm</dd></div><div><dt>Wall height</dt><dd>40 mm</dd></div><div><dt>Model scale</dt><dd>1:65</dd></div><div><dt>Cardboard throughout</dt><dd>3 mm · no roof</dd></div><div><dt>Material needed</dt><dd>2 A4 sheets total</dd></div><div><dt>A4 cardboard base</dt><dd>210 × 297 mm</dd></div></dl><a class="button primary full-width" href="/build-pack/index.html" target="_blank" rel="noopener">${icon('plan')}Open the complete build guide ${icon('external')}</a><div class="build-downloads"><a href="/build-pack/all-walls-stock.svg" download>${icon('download')}All 13 walls · one A4 sheet</a><a href="/build-pack/floor-plan.svg" download>${icon('download')}Floor plan SVG</a><a href="/build-pack/cut-list.csv" download>${icon('download')}Wall cut list CSV</a><a href="/build-pack/dimensions.json" download>${icon('download')}All dimensions JSON</a></div><p class="section-note">Build the walls first. Place servos and the SSTuino beside the building on the spare base area. Check the actual parts before cutting mounting holes.</p><p class="section-note">Representative 4-room layout, not an official HDB construction drawing.</p></div></div></dialog>
  <dialog id="readings-dialog" class="readings-dialog" aria-labelledby="readings-dialog-title"><div class="dialog-heading"><div><span class="dialog-kicker">Every room, at a glance</span><h2 id="readings-dialog-title">Room readings</h2></div><button class="icon-button" data-close aria-label="Close room readings">${icon('close')}</button></div><p class="dialog-note">Illustrative values at <span id="readings-time"></span>. These are not sensor measurements.</p><div class="readings-table-wrap"><table><thead><tr><th>Room</th><th>Temperature</th><th>Feels like</th><th>Air speed</th><th>PM2.5</th></tr></thead><tbody id="readings-table"></tbody></table></div><button class="button secondary" data-action="export">${icon('download')}Export this snapshot</button></dialog>
  <dialog id="about-dialog" class="about-dialog" aria-labelledby="about-dialog-title"><div class="dialog-heading"><h2 id="about-dialog-title">A model for asking “what if?”</h2><button class="icon-button" data-close aria-label="Close explanation">${icon('close')}</button></div><p>${escape(SIMULATION_NOTE)}</p><p>Change a scenario or a control, then let simulated time pass. Temperature and particles respond gradually. Fans move air and change perceived comfort; air conditioning cools rooms and uses electricity.</p><p>The pressure view shows the 2D solver’s relative pressure potential, normalised from −1 to +1 within the current layout. It is a dimensionless simulated index, not pressure in pascals (Pa). Colours show relative differences within one arrangement; airflow arrows show the solved direction of travel.</p><p>The 3D view and cardboard plans use the same floor-plan geometry. Cutaway walls, overlays and camera changes only change the view.</p><p>Use this to compare ideas for your presentation. It is not a building assessment or a source of measured indoor air quality.</p></dialog>
  <dialog id="help-dialog" class="help-dialog" aria-labelledby="help-dialog-title"><div class="dialog-heading"><div><span class="dialog-kicker">Presentation controls</span><h2 id="help-dialog-title">Keep the demo in your hands</h2></div><button class="icon-button" data-close aria-label="Close keyboard help">${icon('close')}</button></div><div class="keyboard-help"><p><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><span>Bedroom 3 north / living south / living east / Bedroom 3 east window</span></p><p><kbd>Shift</kbd> + <kbd>1</kbd><kbd>2</kbd><span>Main door / Bedroom 3 door</span></p><p><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd><kbd>T</kbd><kbd>Y</kbd><span>The six scenarios, in order</span></p><p><kbd>F</kbd><kbd>A</kbd><kbd>P</kbd><span>Fan / AC / purifier power</span></p><p><kbd>[</kbd><kbd>]</kbd><span>Fan direction ±15°</span></p><p><kbd>,</kbd><kbd>.</kbd><span>Previous / next fan position</span></p><p><kbd>−</kbd><kbd>=</kbd><span>Decrease / increase fan speed</span></p><p><kbd>Shift</kbd> + <kbd>P</kbd><span>Next purifier position</span></p><p><kbd>O</kbd><kbd>Enter</kbd><span>Compare layouts / apply suggestion</span></p><p><kbd>Space</kbd><kbd>Backspace</kbd><span>Pause / reset simulation</span></p><p><kbd>C</kbd><kbd>H</kbd><span>Connect SSTuino / show this help</span></p></div><p class="section-note">Tab moves between accessible controls. Shortcuts pause while you use a form field or dialog. D4 on the physical model toggles both Bedroom 3 windows; D5 controls its purifier. Unmapped keys do nothing.</p></dialog>
  <dialog id="guide-dialog" class="guide-dialog" aria-labelledby="guide-title"><div class="dialog-heading"><h2 id="guide-title">Try one change at a time</h2><button class="icon-button" data-close aria-label="Close getting started">${icon('close')}</button></div><ol class="getting-started"><li><strong>Choose the day.</strong><p>Pick heat, haze or a cooler evening. Weather is a scenario you set, not a live feed.</p></li><li><strong>Explore your rooms.</strong><p>Select a room on the map or in the room list. Openings and devices are below the map.</p></li><li><strong>Compare an idea.</strong><p>Suggest changes tests arrangements from the same starting conditions. Review the trade-offs, then Apply. Undo is available until another setting changes.</p></li></ol><p class="section-note">Qualitative toy CFD. Use the simulation to compare ideas, not as a measurement or building assessment.</p><button class="button primary" data-close>Explore my flat</button></dialog>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>`;

const adviceRail = document.createElement('aside');
adviceRail.className = 'advice-rail';
adviceRail.setAttribute('aria-label', 'Suggestions and room readings');
adviceRail.append($('#optimiser-panel'), $('.results-panel'));
const manualLink = document.createElement('a');
manualLink.className = 'manual-controls-link';
manualLink.href = '#controls';
manualLink.textContent = 'Adjust windows, devices & weather';
manualLink.addEventListener('click', () => { $('#controls').focus({ preventScroll: true }); });
adviceRail.append(manualLink);
$('#flat-workspace .workspace').append(adviceRail);
$('#flat-workspace').append($('#controls'));
$('#playback-slot').append($('.simulation-controls'));
$('#science-status').append($('#simulation-engine'), $('.speed-help'));
$('#hardware-menu-slot').append($('.hardware-section'));
for (const heading of Array.from($('#panel-devices').querySelectorAll('h3'))) {
  const group = document.createElement('div');
  group.className = 'device-group';
  heading.before(group);
  let item: Element | null = heading;
  while (item && (item === heading || item.tagName !== 'H3')) {
    const next: Element | null = item.nextElementSibling;
    group.append(item);
    item = next;
  }
}


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
  $('#room-detail').innerHTML = `<div class="selected-room-info"><span>${room.area_m2.toFixed(1)} m² floor area</span></div><div class="selected-room-reading"><strong id="selected-temperature">—</strong><span id="selected-comfort">Estimated room conditions</span></div><h3 class="control-group-title">Windows & doors</h3>${windows.concat(doors).map(box => toggleControl(box.type as 'window' | 'door', box.name, openingLabel(box), box.type === 'window' ? conditions.windows[box.name] : conditions.doors[box.name])).join('') || '<p class="section-note">This space connects through adjacent rooms. Select a neighbouring room to change its openings.</p>'}<h3 class="control-group-title">Room devices</h3>${devices.map(id => toggleControl('device', id, id.startsWith('fan_') ? 'Ceiling fan' : id.startsWith('ac_') ? 'Air conditioning' : 'Air purifier', conditions.devices[id])).join('') || '<p class="section-note">No powered devices in this room.</p>'}<p class="section-note room-note">Door and window states also respond to a connected physical model.</p>`;
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
  $<HTMLSelectElement>('#day-select').value = conditions.scenarioId ?? 'baseline';
  $('#custom-day-note').hidden = activePreset !== '';
  if (conditions.scenarioId === 'validation') {
    $<HTMLInputElement>('#science-views').checked = true;
    document.querySelectorAll<HTMLElement>('[data-mode="pressure"], [data-preset="validation"], #day-select option[value="validation"]').forEach(element => { element.hidden = false; });
  }
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
  syncStandingFanControls();
}
function standingFanName(id: string): string {
  return id === PRIMARY_STANDING_FAN_ID ? 'Main fan' : /^fan-\d+$/.test(id) ? `Fan ${id.slice(4)}` : id;
}
function standingFanStatus(message: string): void {
  $('#standing-fan-status').textContent = message;
}
function syncStandingFanControls(): void {
  const fans = resolveStandingFans(conditions);
  if (!fans.some(fan => fan.id === selectedStandingFan)) selectedStandingFan = fans[0]?.id ?? PRIMARY_STANDING_FAN_ID;
  const selected = fans.find(fan => fan.id === selectedStandingFan);
  const select = $<HTMLSelectElement>('#standing-fan-select');
  const options = fans.map(fan => `<option value="${escape(fan.id)}">${escape(standingFanName(fan.id))} · ${escape(roomLabel(fan.room))}${fan.on && fan.speed > 0 ? '' : ' · off'}</option>`).join('');
  if (select.innerHTML !== options) select.innerHTML = options;
  select.value = selectedStandingFan;
  $('#standing-fan-count').textContent = `${fans.length} / ${MAX_STANDING_FANS}`;
  $<HTMLButtonElement>('#standing-fan-add').disabled = fans.length >= MAX_STANDING_FANS;
  $<HTMLButtonElement>('#standing-fan-remove').disabled = !selected || selected.isPrimary;
  $('#primary-fan-controls').hidden = !selected?.isPrimary;
  $('#additional-fan-controls').hidden = Boolean(selected?.isPrimary);
  $('#fan-presets').hidden = !selected?.isPrimary;
  if (!selected) return;
  $<HTMLInputElement>('#standing-fan-on').checked = selected.on;
  $('#standing-fan-power-state').textContent = selected.on ? (selected.speed > 0 ? 'On' : 'On · speed stopped') : 'Off';
  $<HTMLSelectElement>('#standing-fan-speed').value = String(selected.speed);
  $<HTMLInputElement>('#standing-fan-heading').value = String(Math.round(selected.angleDeg));
  $<HTMLSelectElement>('#standing-fan-room').value = selected.room;
  $<HTMLInputElement>('#standing-fan-x').value = selected.x.toFixed(2);
  $<HTMLInputElement>('#standing-fan-z').value = selected.z.toFixed(2);
  scene?.setSelectedStandingFan(selectedStandingFan);
  const overlap = fans.some((fan, index) => fans.slice(index + 1).some(other => Math.hypot(fan.x - other.x, fan.z - other.z) < 2 * STANDING_FAN_CLEARANCE_M - 1e-8));
  const purifier = conditions.purifier && PURIFIER_SLOTS[conditions.purifier.slot];
  const purifierOverlap = purifier && fans.some(fan => Math.hypot(fan.x - purifier.x, fan.z - purifier.z) < STANDING_FAN_CLEARANCE_M + PORTABLE_PURIFIER_CLEARANCE_M - 1e-8);
  if (overlap || purifierOverlap) standingFanStatus('A physical preset overlaps another device. Both stay in the simulation; move a fan to clear space.');
  else if ($('#standing-fan-status').textContent?.startsWith('A physical preset overlaps')) standingFanStatus('The devices are clear of one another.');
}
function selectStandingFan(id: string): void {
  if (!resolveStandingFans(conditions).some(fan => fan.id === id)) return;
  selectedStandingFan = id;
  syncStandingFanControls();
}
function addStandingFan(): void {
  if (resolveStandingFans(conditions).length >= MAX_STANDING_FANS) return;
  conditions.portableFan ??= { on: false, slot: 0, angleDeg: 90, speed: 2 };
  const preferred = view.selectedRoom ?? 'living';
  let position = findStandingFanPosition(preferred, conditions);
  if (!position) for (const room of model.rooms) {
    position = findStandingFanPosition(room.name, conditions);
    if (position) break;
  }
  if (!position) { standingFanStatus('There is no clear floor space for another fan. Move or remove a fan first.'); return; }
  const occupied = new Set((conditions.standingFans ?? []).map(fan => fan.id));
  let number = 2;
  while (occupied.has(`fan-${number}`)) number++;
  const id = `fan-${number}`;
  conditions.standingFans = [...(conditions.standingFans ?? []), { id, ...position, on: true, speed: 2, angleDeg: 0 }];
  selectedStandingFan = id;
  markCustom(true); renderReadings();
  standingFanStatus(`${standingFanName(id)} added and on. Adjust its direction or drag it to clear floor space.`);
  $('#standing-fan-select').focus();
}
function removeStandingFan(): void {
  if (selectedStandingFan === PRIMARY_STANDING_FAN_ID) return;
  const id = selectedStandingFan;
  conditions.standingFans = (conditions.standingFans ?? []).filter(fan => fan.id !== id);
  selectedStandingFan = PRIMARY_STANDING_FAN_ID;
  markCustom(true); renderReadings();
  standingFanStatus(`${standingFanName(id)} removed.`);
  $('#standing-fan-select').focus();
}
function moveStandingFan(id: string, x: number, z: number): void {
  const fan = resolveStandingFans(conditions).find(item => item.id === id);
  if (!fan) return;
  const placement = validateStandingFanPosition(x, z, conditions, id);
  if (!placement.valid) { standingFanStatus(placement.reason); return; }
  if (Math.hypot(fan.x - x, fan.z - z) < 1e-8) return;
  if (id === PRIMARY_STANDING_FAN_ID) conditions.portableFan!.position = { x, z };
  else conditions.standingFans = conditions.standingFans?.map(item => item.id === id ? { ...item, x, z } : item);
  selectedStandingFan = id;
  markCustom(true); renderReadings();
  standingFanStatus(`${standingFanName(id)} moved to ${roomLabel(placement.room!)}. Current heat and haze readings continue.`);
}
function editStandingFan(control: string, value: number | boolean): void {
  const fan = resolveStandingFans(conditions).find(item => item.id === selectedStandingFan);
  if (!fan) return;
  const numeric = Number(value);
  if (control !== 'standing-fan-on' && (!Number.isFinite(numeric) || (control === 'standing-fan-heading' ? numeric < 0 || numeric > 359 : numeric < 0 || numeric > 3))) {
    syncStandingFanControls(); standingFanStatus('Enter a direction from 0 to 359°, or a speed from 0 to 3.'); return;
  }
  if (fan.isPrimary) {
    if (control === 'standing-fan-heading') conditions.portableFan!.headingDeg = numeric;
    else if (control === 'standing-fan-on') conditions.portableFan!.on = Boolean(value);
    else conditions.portableFan!.speed = numeric;
  } else conditions.standingFans = conditions.standingFans?.map(item => item.id !== fan.id ? item : { ...item,
    ...(control === 'standing-fan-on' ? { on: Boolean(value) } : control === 'standing-fan-heading' ? { angleDeg: numeric } : { speed: numeric }) });
  markCustom(true); renderReadings();
  standingFanStatus(`${standingFanName(fan.id)} updated.`);
}
function placementDisplacesFan(before: Conditions, after: Conditions, movedId?: string): boolean {
  const next = resolveStandingFans(after);
  if (resolveStandingFans(before).some(fan => fan.id !== movedId && !next.some(item => item.id === fan.id && item.x === fan.x && item.z === fan.z))) return true;
  if (movedId) {
    const moved = next.find(fan => fan.id === movedId);
    return Boolean(moved && next.some(fan => fan.id !== movedId && Math.hypot(fan.x - moved.x, fan.z - moved.z) < 2 * STANDING_FAN_CLEARANCE_M - 1e-8));
  }
  const purifier = after.purifier && PURIFIER_SLOTS[after.purifier.slot];
  return Boolean(purifier && next.some(fan => Math.hypot(fan.x - purifier.x, fan.z - purifier.z) < STANDING_FAN_CLEARANCE_M + PORTABLE_PURIFIER_CLEARANCE_M - 1e-8));
}
function updateScene(): void {
  if (workspace === 'study') return;
  const preview = workspace === 'lab' && coolingLab ? coolingLab.readPreviewConditions() : conditions;
  scene?.update(preview, result, view);
  if (fallbackPlan) updateFallbackPlan();
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
  if (!playing) result = stepSimulation(result, conditions, 0);
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
export function applyHardwarePurifier(active: boolean): boolean {
  if (typeof active !== 'boolean' || bedroom3PurifierSlot < 0) return false;
  if (conditions.purifier?.on === active && conditions.purifier.slot === bedroom3PurifierSlot) return true;
  conditions.purifier = { on: active, slot: bedroom3PurifierSlot };
  markCustom();
  renderReadings();
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
  conditions = { ...structuredClone(preset.conditions), doors: conditions.doors, windows: conditions.windows, devices: conditions.devices, portableFan: conditions.portableFan, standingFans: conditions.standingFans, purifier: conditions.purifier, acSetpoint: conditions.acSetpoint };
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
  const previous = structuredClone(conditions);
  const fan = conditions.portableFan ??= { on: false, slot: 0, angleDeg: 90, speed: 2 };
  const purifier = conditions.purifier ??= { on: false, slot: 0 };
  switch (key) {
    case 'fanOn': fan.on = Boolean(value); break;
    case 'fanSlot': fan.slot = Math.max(0, Math.min(FAN_SLOTS.length - 1, Number(value))); delete fan.position; delete fan.headingDeg; break;
    case 'fanAngle': fan.angleDeg = Math.max(0, Math.min(180, Number(value))); delete fan.headingDeg; break;
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
  if ((key === 'fanSlot' || key === 'purifierSlot') && placementDisplacesFan(previous, conditions, key === 'fanSlot' ? PRIMARY_STANDING_FAN_ID : undefined)) {
    conditions = previous; syncControls(); standingFanStatus('That position is occupied by a standing fan. Move it first.'); return;
  }
  markCustom(true);
}

function invalidateOptimiser(): void {
  undoAdvice = null;
  if (optimising) { optimiser.cancel(); optimising = false; }
  $('#optimiser-panel').setAttribute('aria-busy', 'false');
  if (!optimiserInput) return;
  optimiserReport = null; optimiserInput = null; appliedLayout = null;
  $('#run-optimiser').innerHTML = 'Suggest changes';
  $('#run-optimiser').classList.add('primary');
  $('#optimiser-result').innerHTML = '<p class="section-note">The setup changed. Run a new comparison for this arrangement.</p>';
}
function scoreComparison(current: number, suggested: number): string {
  if (current === suggested) return 'Same combined score';
  if (current === 0) return 'Combined score increased from zero';
  const percent = Math.abs((suggested - current) / current * 100).toFixed(1);
  if (percent === '0.0') return 'Same combined score at 0.1% precision';
  return `${percent}% ${suggested < current ? 'lower' : 'higher'} combined score`;
}
function hardwareConnected(): boolean { return $('#hardware-controls').dataset.connection === 'connected'; }
function hardwareAllows(next: Conditions): boolean { return !hardwareConnected() || hardwareOwnedControlsMatch(conditions, next); }
function renderOptimiserReport(): void {
  if (!optimiserReport) return;
  const report = optimiserReport;
  const layout = report.layouts[selectedLayout];
  if (!layout) return;
  const applied = appliedLayout === selectedLayout;
  const actions = describeAdviceChanges(applied ? report.you.conditions : conditions, layout.conditions);
  const comparison = scoreComparison(report.you.J, layout.J);
  const noBetter = layout.J >= report.you.J - 1e-8;
  const permitted = hardwareAllows(layout.conditions);
  const canUndo = undoAdvice !== null && undoAdvice.applied === JSON.stringify(conditions) && hardwareAllows(undoAdvice.before);
  $('#run-optimiser').classList.remove('primary');
  $('#optimiser-result').innerHTML = `<p class="advice-verdict">${applied ? 'These changes are applied.' : noBetter && selectedLayout === 0 ? 'Your starting setup did best among the options we tried.' : noBetter ? 'This alternative has a higher or equal combined score.' : 'Try these changes:'}</p>${actions.length ? `<ul class="advice-actions">${actions.slice(0, 4).map(action => `<li>${escape(action)}</li>`).join('')}</ul>${actions.length > 4 ? `<details class="advice-extra"><summary>+${actions.length - 4} more changes</summary><ul>${actions.slice(4).map(action => `<li>${escape(action)}</li>`).join('')}</ul></details>` : ''}` : '<p class="section-note">Keep your current opening and device settings.</p>'}<p class="advice-outcome"><strong>In the simulation:</strong> Compared with the starting setup, ${escape(describeAdviceOutcome(report.you.result, layout.result))}</p><p class="section-note">Both setups start fresh and run for ${report.simulatedSeconds} simulated seconds. These are whole-flat comparisons.</p><div class="optimiser-result-actions"><button id="apply-optimiser" class="button primary" data-action="apply-optimiser" ${applied || !permitted || !actions.length ? 'disabled' : ''}>${applied ? 'Applied' : 'Apply these changes <kbd>Enter</kbd>'}</button>${undoAdvice ? `<button id="undo-optimiser" class="button secondary" data-action="undo-optimiser" ${canUndo ? '' : 'disabled'}>Undo</button>` : ''}</div>${!permitted || (undoAdvice && !canUndo) ? '<p class="section-note">The connected model controls both Bedroom 3 windows (D4) and its purifier (D5). These switch states are kept, so this conflicting arrangement cannot be applied or restored.</p>' : ''}<details id="advice-score-details" class="advice-score-details"><summary>Other options & how this was scored</summary><div class="optimiser-score"><div>Starting setup<strong>${report.you.J.toFixed(2)}</strong></div><div>Selected option<strong>${layout.J.toFixed(2)}</strong></div></div><p class="optimiser-improvement ${comparison.startsWith('Same') ? 'is-equal' : layout.J > report.you.J ? 'is-worse' : ''}">${comparison}</p><p class="section-note">Score = heat discomfort ${layout.breakdown.heat.toFixed(2)} + haze ${layout.breakdown.haze.toFixed(2)} + power ${layout.breakdown.energy.toFixed(2)}. Heat discomfort includes fan comfort; it is not an air-temperature reading. Scores shown rounded.</p>${report.layouts.length > 1 ? `<label class="field-label" for="optimiser-alternative">Compared alternatives</label><select id="optimiser-alternative" class="device-select">${report.layouts.map((choice, index) => `<option value="${index}" ${index === selectedLayout ? 'selected' : ''}>${index === 0 ? 'Best tested' : `Alternative ${index + 1}`} · score ${choice.J.toFixed(2)}</option>`).join('')}</select>` : ''}<p class="section-note">2D plan-view engine · ${report.evaluations} layouts · ${(report.durationMs / 1000).toFixed(1)} s${report.partial ? ' · time-limited search' : ''}. This illustrative trade-off is not a health or engineering standard.</p></details>`;
}

const optimiser = createOptimiser({
  onProgress(progress) {
    $('#optimiser-result').innerHTML = `<progress class="optimiser-progress" value="${progress.done}" max="${progress.total}" aria-label="Layout comparison progress"></progress><p class="section-note">Testing arrangements… ${progress.done} of about ${progress.total}. The 3D model stays interactive.</p>`;
  },
  onResult(report) {
    optimising = false;
    $('#optimiser-panel').setAttribute('aria-busy', 'false');
    $('#run-optimiser').innerHTML = 'Suggest again';
    if (JSON.stringify(conditions) !== optimiserInput) { invalidateOptimiser(); return; }
    optimiserReport = report; selectedLayout = 0; renderOptimiserReport();
    notify('Comparison ready. Review the layout before applying it.');
  },
  onError(message) {
    optimising = false; optimiserInput = null;
    $('#optimiser-panel').setAttribute('aria-busy', 'false');
    $('#run-optimiser').innerHTML = 'Try comparison again';
    $('#optimiser-result').innerHTML = `<p class="section-note" role="alert">${escape(message)}</p><p class="section-note">Your controls are unchanged. Try again, or choose fewer devices under Devices to test.</p>`;
  },
});
function runOptimiser(): void {
  if (workspace !== 'flat') selectWorkspace('flat');
  if (optimising) { invalidateOptimiser(); $('#optimiser-result').innerHTML = '<p class="section-note">Comparison stopped. Your controls are unchanged. Suggest changes when you’re ready.</p>'; notify('Comparison stopped.'); return; }
  optimiserReport = null; optimiserInput = JSON.stringify(conditions); optimising = true; appliedLayout = null; undoAdvice = null;
  $('#optimiser-panel').setAttribute('aria-busy', 'true');
  $('#run-optimiser').textContent = 'Cancel comparison';
  $('#run-optimiser').classList.add('primary');
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
  const bedroom3 = result.rooms.find(room => room.room === 'bedroom3');
  if (bedroom3) {
    const purifierHere = conditions.purifier?.slot === bedroom3PurifierSlot;
    $('#bedroom3-purifier-status').textContent = purifierHere
      ? `Corner purifier ${conditions.purifier?.on ? 'ON' : 'OFF'}`
      : `Portable purifier is in ${roomLabel(PURIFIER_SLOTS[conditions.purifier?.slot ?? 0]?.room ?? 'living')}`;
    const northOpen = Boolean(conditions.windows.window_bedroom3_1), eastOpen = Boolean(conditions.windows.window_bedroom3_2);
    $('#bedroom3-window-status').textContent = `North ${northOpen ? 'open' : 'closed'} · East ${eastOpen ? 'open' : 'closed'}`;
    $('#bedroom3-window-toggle').textContent = northOpen && eastOpen ? 'Close both windows' : 'Open both windows';
    $('#bedroom3-pm25').textContent = `${bedroom3.pm25.toFixed(1)} µg/m³`;
    const equivalent = pm25ToUsAqiEquivalent(bedroom3.pm25);
    $('#bedroom3-aqi-equivalent').textContent = equivalent === null ? 'Beyond supported scale' : String(equivalent);
  }
  const ranked = result.rooms.filter(room => primaryRooms.includes(room.room)).sort((a, b) => {
    const delta = view.mode === 'pm25' ? b.pm25 - a.pm25 : b.temperature - a.temperature;
    return Math.abs(delta) >= 0.05 ? delta : primaryRooms.indexOf(a.room) - primaryRooms.indexOf(b.room);
  });
  $('#room-sort-label').textContent = view.mode === 'pm25' ? 'Haziest first' : 'Warmest first';
  const top = ranked[0];
  const distinct = top && ranked.some(room => top.temperature - room.temperature >= 0.1);
  $('#advice-room-context').textContent = top ? view.mode === 'pm25' && ranked.some(room => top.pm25 - room.pm25 >= 0.1) ? `${roomLabel(top.room)} has the most haze right now.` : distinct ? `${roomLabel(top.room)} is warmest right now.` : 'The rooms are at similar temperatures.' : 'Explore a change for your home.';
  ranked.forEach((room, index) => {
    const row = $(`[data-room-row="${room.room}"]`);
    row.style.order = String(index);
    row.classList.toggle('room-mobile-extra', index >= 4 && room.room !== 'bedroom3');
  });
  for (const room of result.rooms) {
    const element = document.getElementById(`reading-${room.room}`);
    if (element) {
      element.innerHTML = view.mode === 'pm25' ? `${room.pm25.toFixed(1)}<span>µg/m³</span>` : `${room.temperature.toFixed(1)}<span>°C</span>`;
      const status = view.mode === 'pm25' ? room.pm25 > result.averagePm25 * 1.2 ? 'Hazier than average' : room.pm25 < conditions.outdoorPm25 * 0.8 ? 'Cleaner than outside' : 'PM2.5' : room.room === top?.room && distinct ? 'Warmest' : room.airflow < 0.1 ? 'Still air' : room.airflow >= 0.3 ? 'Breezy' : room.temperature > conditions.outdoorTemperature + 0.5 ? 'Warmer than outside' : `${room.airflow.toFixed(2)} m/s`;
      $(`#airflow-${room.room}`).textContent = status;
      $(`[data-room-row="${room.room}"]`).classList.toggle('room-flagged', view.mode === 'pm25' ? room.pm25 > result.averagePm25 * 1.2 : room.room === top?.room && Boolean(distinct));
    }
    if (room.room === view.selectedRoom) {
      const selected = document.getElementById('selected-temperature');
      if (selected) selected.innerHTML = `${room.temperature.toFixed(1)}<span>°C</span>`;
      const comfort = document.getElementById('selected-comfort');
      if (comfort) comfort.textContent = `Feels like ${room.feelsLike.toFixed(1)}°C · ${room.pm25.toFixed(1)} µg/m³ PM2.5`;
    }
  }
  updateFallbackPlan();
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
  $('#view-description').textContent = `${copy[1]} Arrows show airflow; none appear in still air.`;
  const legend = $('#model-legend');
  legend.hidden = view.mode === 'model';
  legend.className = `model-legend legend-${view.mode}`;
  const labels = { model: ['', ''], temperature: ['24°C', '40°C'], airflow: ['0 m/s', '1.5 m/s'], pressure: ['−1 low', '+1 high'], pm25: ['0', '250 µg/m³'] }[view.mode];
  legend.innerHTML = view.mode === 'pressure'
    ? `<span class="legend-caption">RELATIVE / SIMULATED</span><span>${labels[0]}</span><span class="pressure-scale"><i></i><small>0</small></span><span>${labels[1]}</span>`
    : `<span class="legend-caption">SIMULATED</span><span>${labels[0]}</span><i></i><span>${labels[1]}</span>`;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === view.mode)));
  renderReadings();
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
    ['Portable fan preset angle degrees', String(conditions.portableFan?.angleDeg ?? 90)],
    ['Portable fan speed', String(conditions.portableFan?.speed ?? 2)],
    ['Portable purifier on', String(conditions.purifier?.on ?? false)],
    ['Portable purifier slot (zero-based)', String(conditions.purifier?.slot ?? 0)],
    ['Device power W', result.powerWatts.toFixed(1)],
    ['Energy kWh', result.energyKwh.toFixed(4)],
    [], ['Standing fan', 'Room', 'X m', 'Z m', 'World heading degrees clockwise from north', 'On', 'Speed 0-3'],
    ...resolveStandingFans(conditions).map(fan => [fan.id, roomLabel(fan.room), String(fan.x), String(fan.z), String(fan.angleDeg), String(fan.on), String(fan.speed)]),
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
    case 'add-standing-fan': addStandingFan(); break;
    case 'remove-standing-fan': removeStandingFan(); break;
    case 'place-standing-fan': moveStandingFan(selectedStandingFan, $<HTMLInputElement>('#standing-fan-x').valueAsNumber, $<HTMLInputElement>('#standing-fan-z').valueAsNumber); break;
    case 'guide': openDialog('#guide-dialog', target); break;
    case 'build': openDialog('#build-dialog', target); break;
    case 'about': openDialog('#about-dialog', target); break;
    case 'help': openDialog('#help-dialog', target); break;
    case 'optimise': runOptimiser(); break;
    case 'apply-optimiser': {
      if (!optimiserReport || JSON.stringify(conditions) !== optimiserInput) { invalidateOptimiser(); break; }
      const report = optimiserReport;
      const layout = report.layouts[selectedLayout];
      if (!layout || !hardwareAllows(layout.conditions)) { renderOptimiserReport(); break; }
      const before = readConditions();
      replaceConditions(layout.conditions, true); emitControl();
      // A board can immediately reassert a physical switch; never retain an undo across that change.
      if (JSON.stringify(conditions) !== JSON.stringify(layout.conditions)) break;
      optimiserReport = report; optimiserInput = JSON.stringify(conditions); appliedLayout = selectedLayout;
      undoAdvice = { before, applied: optimiserInput };
      renderOptimiserReport();
      $('#undo-optimiser').focus();
      notify('Changes applied. Undo is available until you change another setting.');
      break;
    }
    case 'undo-optimiser': {
      const undo = undoAdvice, report = optimiserReport;
      if (!undo || !report || undo.applied !== JSON.stringify(conditions)) { invalidateOptimiser(); break; }
      if (!hardwareAllows(undo.before)) { renderOptimiserReport(); break; }
      replaceConditions(undo.before, true); emitControl();
      if (JSON.stringify(conditions) !== JSON.stringify(undo.before)) break;
      optimiserReport = report; optimiserInput = JSON.stringify(conditions); appliedLayout = null;
      renderOptimiserReport();
      const apply = $<HTMLButtonElement>('#apply-optimiser');
      (apply.disabled ? $('#run-optimiser') : apply).focus();
      notify('Previous settings restored. Readings restarted; elapsed history was not restored.');
      break;
    }
    case 'show-all-rooms': {
      const expanded = target.getAttribute('aria-expanded') !== 'true';
      target.setAttribute('aria-expanded', String(expanded));
      target.textContent = expanded ? 'Show fewer rooms' : 'Show all rooms';
      $('.room-readings').classList.toggle('show-all', expanded);
      break;
    }
    case 'readings': renderTable(); openDialog('#readings-dialog', target); break;
    case 'export': exportCsv(); break;
    case 'play':
      invalidateGpuStep();
      playing = !playing;
      target.innerHTML = `${icon(playing ? 'pause' : 'play')}<span>${playing ? 'Pause' : 'Resume'}</span>`;
      $('#play-status').textContent = playing ? 'Simulation running' : 'Simulation paused';
      $('.running-dot').classList.toggle('paused', !playing);
      renderReadings();
      break;
    case 'reset':
      invalidateGpuStep();
      result = createSimulation(conditions); history = []; lastSample = -1; renderReadings(); updateScene();
      notify('Readings and time reset. Your controls are unchanged.'); break;
    case 'bedroom3-windows': {
      const open = !(conditions.windows.window_bedroom3_1 && conditions.windows.window_bedroom3_2);
      conditions.windows.window_bedroom3_1 = open;
      conditions.windows.window_bedroom3_2 = open;
      markCustom(true); renderReadings();
      notify(`Both Bedroom 3 windows ${open ? 'opened' : 'closed'}.`);
      break;
    }
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
  if (input.id === 'standing-fan-select') { selectStandingFan(input.value); return; }
  if (input.id === 'standing-fan-room') {
    const position = findStandingFanPosition(input.value, conditions, selectedStandingFan);
    if (position) moveStandingFan(selectedStandingFan, position.x, position.z);
    else { syncStandingFanControls(); standingFanStatus('No clear position is available in that room. Try another room or move a fan first.'); }
    return;
  }
  if (['standing-fan-on', 'standing-fan-speed', 'standing-fan-heading'].includes(input.id)) { editStandingFan(input.id, input.type === 'checkbox' ? input.checked : input.id === 'standing-fan-heading' ? input.valueAsNumber : Number(input.value)); return; }
  if (input.id === 'day-select') { loadScenario(input.value); return; }
  if (input.id === 'science-views') {
    document.querySelectorAll<HTMLElement>('[data-mode="pressure"], [data-preset="validation"], #day-select option[value="validation"]').forEach(element => { element.hidden = !input.checked; });
    if (!input.checked) {
      if (flatViewMode === 'pressure') flatViewMode = 'model';
      if (view.mode === 'pressure') { view.mode = 'model'; updateOverlay(); }
    }
    return;
  }
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
  if (input.id === 'optimiser-alternative') { selectedLayout = Number(input.value); renderOptimiserReport(); $<HTMLDetailsElement>('#advice-score-details').open = true; $('#optimiser-alternative').focus(); }
  if (input.id === 'optimiser-budget' || input.id === 'optimiser-openings') invalidateOptimiser();
  if (input.dataset.control) {
    applyHardwareControl(input.dataset.control as 'window' | 'door' | 'device', input.dataset.id!, input.checked);
    emitControl();
  }
  if (input.dataset.deviceKey && input.type !== 'range') editDevice(input.dataset.deviceKey, input.type === 'checkbox' ? input.checked : input.value);
  if (input.dataset.view) { view[input.dataset.view as 'cutaway' | 'labels' | 'dimensions'] = input.checked; updateScene(); }
});
const dialogLaunchers = new WeakMap<HTMLDialogElement, HTMLElement>();
function openDialog(selector: string, launcher: HTMLElement): void {
  const dialog = $<HTMLDialogElement>(selector);
  dialogLaunchers.set(dialog, launcher.closest('#more-menu') ? $('#more-menu > summary') : launcher);
  $<HTMLDetailsElement>('#more-menu').open = false;
  dialog.showModal();
}
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => dialog.addEventListener('close', () => {
  const launcher = dialogLaunchers.get(dialog);
  requestAnimationFrame(() => { if (launcher?.isConnected && launcher.getClientRects().length) launcher.focus(); });
}));
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
  const tabs = ['room', 'devices', 'environment'];
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
    case 'c': $<HTMLDetailsElement>('#more-menu').open = true; $<HTMLDetailsElement>('.hardware-section').open = true; $('#connect-hardware').click(); break;
    case 'h': openDialog('#help-dialog', target); break;
    case 'o': $('#run-optimiser').click(); $('#run-optimiser').focus(); break;
    case 'enter': document.getElementById('apply-optimiser')?.click(); break;
    default: return;
  }
  event.preventDefault();
});

const hardwareObserver = new MutationObserver(() => {
  $('#model-connection-chip').hidden = !hardwareConnected();
  if (optimiserReport) renderOptimiserReport();
});
hardwareObserver.observe($('#hardware-controls'), { attributes: true, attributeFilter: ['data-connection'] });
document.addEventListener('click', event => {
  const menu = $<HTMLDetailsElement>('#more-menu');
  if (!menu.contains(event.target as Node)) menu.open = false;
});
$('#more-menu').addEventListener('keydown', event => {
  if ((event as KeyboardEvent).key === 'Escape') { $<HTMLDetailsElement>('#more-menu').open = false; $('#more-menu > summary').focus(); }
});
checkControlMappings(); renderRoomControls(); syncControls(); renderReadings();
createScene($('#scene'), selectRoom, (kind, slotId) => {
  if (workspace === 'flat') editDevice(kind === 'fan' ? 'fanSlot' : 'purifierSlot', slotId);
}, {
  onMove: (id, x, z) => { if (workspace === 'flat') moveStandingFan(id, x, z); },
  onSelect: id => { if (workspace === 'flat') { selectStandingFan(id); selectTab('devices'); } },
}).then(controller => {
  scene = controller;
  $('#scene-loading').remove();
  scene.setPortableDraggingEnabled(workspace === 'flat');
  scene.setThermalVent(workspace === 'lab' ? thermalVent : null);
  updateScene();
}).catch(error => {
  console.error('Unable to initialize 3D scene', error);
  mountFallbackPlan();
});
function mountFallbackPlan(): void {
  fallbackPlan = true;
  $('.model-panel').classList.add('has-plan-fallback');
  const bounds = model.bounds;
  const width = bounds.max[0] - bounds.min[0], depth = bounds.max[2] - bounds.min[2];
  const rect = (box: { min: number[]; max: number[] }) => `x="${box.min[0]}" y="${box.min[2]}" width="${box.max[0] - box.min[0]}" height="${box.max[2] - box.min[2]}"`;
  $('#scene').insertAdjacentHTML('beforeend', `<svg id="flat-plan-fallback" viewBox="${bounds.min[0] - .25} ${bounds.min[2] - .25} ${width + .5} ${depth + .5}" role="group" aria-label="Interactive 2D apartment plan"><defs><marker id="fallback-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#184c43"/></marker></defs>${model.rooms.map(room => `<g class="fallback-room" data-fallback-room="${room.name}" role="button" tabindex="0" aria-label="Select ${escape(roomLabel(room.name))}"><title>${escape(roomLabel(room.name))}</title><rect ${rect(room)}/></g>`).join('')}<g class="fallback-walls" aria-hidden="true">${model.boxes.filter(box => box.type === 'wall').map(box => `<rect ${rect(box)}/>`).join('')}</g><g class="fallback-openings" aria-hidden="true">${model.boxes.filter(box => box.type === 'window' || box.type === 'door').map(box => `<rect ${rect(box)} data-fallback-opening="${box.name}"/>`).join('')}</g><g id="fallback-flow" aria-hidden="true"></g><g class="fallback-labels" aria-hidden="true">${model.rooms.filter(room => primaryRooms.includes(room.name)).map(room => `<text x="${(room.min[0] + room.max[0]) / 2}" y="${(room.min[2] + room.max[2]) / 2 - .08}"><tspan>${escape(roomLabel(room.name))}</tspan><tspan x="${(room.min[0] + room.max[0]) / 2}" dy=".48" data-fallback-reading="${room.name}"></tspan></text>`).join('')}</g></svg>`);
  $('#scene-loading').className = 'fallback-notice';
  $('#scene-loading').innerHTML = '<strong>2D plan</strong><span>3D graphics are unavailable. Room selection and the simulation still work.</span><a href="/build-pack/floor-plan.svg" target="_blank" rel="noopener">Printable plan</a>';
  document.querySelectorAll<HTMLButtonElement>('[data-camera], [data-action="reset-camera"]').forEach(button => { button.disabled = true; });
  $('.view-disclosure').hidden = true;
  $('#scene').addEventListener('click', event => {
    const room = (event.target as Element).closest<SVGGElement>('[data-fallback-room]');
    if (room && workspace === 'flat') selectRoom(room.dataset.fallbackRoom ?? null);
  });
  $('#scene').addEventListener('keydown', event => {
    const key = event as KeyboardEvent;
    const room = (key.target as Element).closest<SVGGElement>('[data-fallback-room]');
    if (room && workspace === 'flat' && (key.key === 'Enter' || key.key === ' ')) { key.preventDefault(); key.stopPropagation(); selectRoom(room.dataset.fallbackRoom ?? null); }
  });
  updateFallbackPlan();
}
function updateFallbackPlan(): void {
  if (!fallbackPlan || workspace === 'study') return;
  const preview = workspace === 'lab' && coolingLab ? coolingLab.readPreviewConditions() : conditions;
  const isPreview = workspace === 'lab';
  $('#view-label').textContent = isPreview ? '2D position preview' : 'Your flat, room by room';
  $('#view-description').textContent = isPreview ? 'Window fan test values appear in its results.' : view.mode === 'pressure' ? 'Pressure colours need the 3D view. Room temperatures shown. Arrows show airflow; none appear in still air.' : 'Room averages. Arrows show airflow; none appear in still air.';
  for (const room of result.rooms) {
    const group = document.querySelector<SVGGElement>(`[data-fallback-room="${room.room}"]`);
    if (group) {
      group.classList.toggle('selected', !isPreview && room.room === view.selectedRoom);
      group.setAttribute('aria-pressed', String(!isPreview && room.room === view.selectedRoom));
      group.setAttribute('tabindex', isPreview ? '-1' : '0');
      group.setAttribute('aria-disabled', String(isPreview));
    }
    const text = document.querySelector<SVGElement>(`[data-fallback-reading="${room.room}"]`);
    if (text) text.textContent = isPreview ? '' : view.mode === 'pm25' ? `${room.pm25.toFixed(1)} µg/m³` : view.mode === 'airflow' ? `${room.airflow.toFixed(2)} m/s` : `${room.temperature.toFixed(1)}°C`;
  }
  document.querySelectorAll<SVGElement>('[data-fallback-opening]').forEach(opening => {
    const id = opening.dataset.fallbackOpening!;
    opening.classList.toggle('is-open', Boolean(preview.windows[id] ?? preview.doors[id]));
  });
  const field = result.field;
  const arrows: string[] = [];
  if (field && !isPreview) {
    const valid = (x: number, z: number) => {
      const ix = Math.floor((x - field.origin[0]) / field.dx), iz = Math.floor((z - field.origin[1]) / field.dx);
      return ix >= 0 && iz >= 0 && ix < field.nx && iz < field.nz && field.cellType[ix + iz * field.nx] === 0;
    };
    for (let iz = 2; iz < field.nz; iz += 4) for (let ix = 2; ix < field.nx; ix += 4) {
      const index = ix + iz * field.nx, u = field.ux[index], v = field.uz[index], speed = Math.hypot(u, v);
      if (field.cellType[index] !== 0 || !Number.isFinite(speed) || speed < .015) continue;
      const x = field.origin[0] + (ix + .5) * field.dx, z = field.origin[1] + (iz + .5) * field.dx;
      const dx = u / speed * .32, dz = v / speed * .32;
      if (![.25, .5, .75, 1].every(t => valid(x + dx * t, z + dz * t))) continue;
      arrows.push(`<line x1="${x}" y1="${z}" x2="${x + dx}" y2="${z + dz}"/>`);
    }
  }
  $('#fallback-flow').innerHTML = arrows.join('');
  // The fallback presents actual room means, not a substitute scalar-field colour map.
  $('#model-legend').hidden = true;
}
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
      else result = stepSimulation(result, conditions, Math.min(delta * speed, 1));
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
  hardwareObserver.disconnect();
});
