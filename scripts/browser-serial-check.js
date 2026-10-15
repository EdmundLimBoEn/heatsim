// Run with gstack browse eval scripts/browser-serial-check.js against a fresh Vite page.
// Read window.heatSimSerialResult after status changes from running.
(async () => {
  const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1)?.name;
  if (!appUrl) throw new Error('Run against the Vite development server');
  const app = await import(appUrl);
  const { pm25ToUsAqiEquivalent } = await import('/src/air-quality.ts');
  const checks = [], writes = [], observations = {};
  window.heatSimSerialResult = { status: 'running', checks, writes, observations };
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const key = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true }));
  let stream;
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const send = line => stream.enqueue(encoder.encode(`${line}\n`));
  const port = {
    readable: new ReadableStream({ start(controller) { stream = controller; } }),
    writable: new WritableStream({ write(bytes) {
      const line = decoder.decode(bytes).trim(); writes.push(line);
      if (line === 'HELLO') send('HELLO:HEATSIM/1');
      else if (line === 'PING') send('PONG');
      else if (line === 'GET:ALL') { send('WIN1:0'); send('DOOR2:0'); send('SCN:6'); send('PUR:OFF'); send('END'); }
      else send(line);
    } }),
    async open(options) { assert(options.baudRate === 115200, 'Uses protocol baud rate'); },
    async close() {},
  };
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'serial');
  const saved = app.readConditions();
  const wasPlaying = document.querySelector('#play-status').textContent.includes('running');
  const speed = document.querySelector('#simulation-speed'), savedSpeed = speed.value;
  const setPlaying = value => { if (document.querySelector('#play-status').textContent.includes('running') !== value) document.querySelector('[data-action="play"]').click(); };
  const button = document.querySelector('#connect-hardware');
  try {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => port, getPorts: async () => [] } });
    app.loadScenario('haze_outside');
    const startup = app.readConditions();
    startup.purifier = { on: true, slot: 0 };
    startup.portableFan = { on: true, slot: 2, angleDeg: 75, speed: 2 };
    app.replaceConditions(startup);
    button.disabled = false; button.click();
    await wait(1800);
    assert(writes.includes('HELLO') && writes.includes('GET:ALL'), 'Handshake requests board state');
    assert(app.readConditions().scenarioId === 'validation' && !app.readConditions().doors.door_bedroom3, 'Hardware scenario preserves authoritative closed door');
    assert(document.querySelector('#hardware-status').textContent.includes('protocol v1'), 'Mock handshake reaches connected state');
    assert(!app.readConditions().purifier.on && app.readConditions().purifier.slot === 2 && JSON.stringify(app.readConditions().portableFan) === JSON.stringify(startup.portableFan), 'Startup PUR state selects the Bedroom 3 corner without changing the fan');
    const count = writes.filter(line => line.startsWith('WIN1:')).length;
    key(); await wait(100);
    assert(app.readConditions().windows.window_bedroom3_1 && writes.filter(line => line.startsWith('WIN1:')).length === count + 1, 'Keyboard sends one command and echo does not loop');
    const beforeIncoming = writes.length;
    send('WIN1:0'); await wait(100);
    assert(!app.readConditions().windows.window_bedroom3_1 && writes.length === beforeIncoming, 'Incoming switch changes app without an outgoing echo');
    const beforeBadInput = JSON.stringify(app.readConditions());
    send('WIN1:<script>'); send('FANANG:999'); send('FANPOS:9'); send('SCN:99');
    await wait(100);
    assert(JSON.stringify(app.readConditions()) === beforeBadInput, 'Invalid or unmapped ranges cannot alter model');
    const windy = app.readConditions();
    windy.windFrom = 'E'; windy.portableFan.on = true;
    app.replaceConditions(windy);
    const controlsBeforeScenario = JSON.stringify([windy.windows, windy.doors, windy.devices, windy.portableFan]);
    const scenarioWrites = writes.filter(line => line.startsWith('SCN:')).length;
    send('SCN:6'); await wait(100);
    const restored = app.readConditions();
    assert(restored.windFrom === undefined, 'Same hardware scenario clears a manual wind direction');
    assert(JSON.stringify([restored.windows, restored.doors, restored.devices, restored.portableFan]) === controlsBeforeScenario, 'Hardware weather reset preserves openings and devices');
    setPlaying(true); await wait(500); setPlaying(false); await wait(300);
    const clock = document.querySelector('#elapsed-time').textContent;
    const energy = document.querySelector('#energy').textContent;
    send('SCN:6'); await wait(300);
    assert(clock !== '00:00:00' && document.querySelector('#elapsed-time').textContent === clock && document.querySelector('#energy').textContent === energy, 'Repeated hardware scenario preserves completed time and energy');
    assert(writes.filter(line => line.startsWith('SCN:')).length === scenarioWrites, 'Hardware scenario reset and duplicate do not echo');

    const beforeInvalidPurifier = JSON.stringify(app.readConditions());
    assert(app.applyHardwarePurifier('ON') === false && JSON.stringify(app.readConditions()) === beforeInvalidPurifier, 'Purifier hardware API rejects non-boolean input');
    app.applyHardwarePurifier(false);
    assert(JSON.stringify(app.readConditions()) === beforeInvalidPurifier, 'Repeated purifier state is idempotent');

    app.loadScenario('haze_outside');
    await wait(100);
    const sealed = app.readConditions();
    for (const id of Object.keys(sealed.windows)) sealed.windows[id] = false;
    for (const id of Object.keys(sealed.doors)) sealed.doors[id] = false;
    for (const id of Object.keys(sealed.devices)) sealed.devices[id] = false;
    sealed.purifier = { on: false, slot: 0 };
    sealed.outdoorTemperature = 32.5; sealed.outdoorPm25 = 200; sealed.windSpeed = 2; sealed.windFrom = 'N';
    app.replaceConditions(sealed, true);
    speed.value = '60'; speed.dispatchEvent(new Event('change', { bubbles: true }));
    const pm = () => Number.parseFloat(document.querySelector('#bedroom3-pm25').textContent);
    const aqi = () => Number.parseInt(document.querySelector('#bedroom3-aqi-equivalent').textContent, 10);
    const clockText = () => document.querySelector('#elapsed-time').textContent;
    const withoutPurifier = conditions => { const copy = structuredClone(conditions); delete copy.purifier; return JSON.stringify(copy); };
    const pausedPm = pm(), pausedClock = clockText(), pausedEnergy = document.querySelector('#energy').textContent;
    const beforePurifierWrites = writes.filter(line => line.startsWith('PUR:')).length;
    send('PUR:ON'); await wait(100);
    assert(app.readConditions().purifier.on && app.readConditions().purifier.slot === 2 && document.querySelector('#bedroom3-purifier-status').textContent.includes('ON'), 'PUR ON activates the Bedroom 3 corner purifier and its visible status');
    assert(withoutPurifier(app.readConditions()) === withoutPurifier(sealed), 'PUR ON preserves the fan, weather, openings and all other conditions');
    assert(pm() === pausedPm && clockText() === pausedClock && document.querySelector('#energy').textContent === pausedEnergy, 'Purifier activation preserves paused fields, clock and energy');
    send('PUR:ON'); await wait(100);
    assert(writes.filter(line => line.startsWith('PUR:')).length === beforePurifierWrites && pm() === pausedPm && clockText() === pausedClock, 'Duplicate PUR messages neither reset readings nor echo');
    const monitorText = document.querySelector('#bedroom3-purifier-monitor').textContent;
    assert(monitorText.includes('SIMULATED') && monitorText.includes('24-hour') && monitorText.includes('Not Singapore PSI'), 'Bedroom 3 monitor labels simulated PM and its index-equivalent limits');
    assert(document.querySelector('#purifier-slot option[value="2"]').textContent.includes('Bedroom 3 corner'), 'Keyboard-accessible position selector names the Bedroom 3 corner');
    const samples = [pausedPm];
    setPlaying(true);
    for (let i = 0; i < 3; i++) { await wait(450); samples.push(pm()); }
    setPlaying(false); await wait(300);
    observations.sealedBedroom3Pm25 = samples;
    assert(samples.every(Number.isFinite) && samples[3] > 0 && samples.slice(1).every((value, index) => value < samples[index]), 'Sealed Bedroom 3 PM falls gradually across live samples without jumping to zero');
    const displayedPm = pm(), displayedAqi = aqi();
    assert(displayedAqi >= pm25ToUsAqiEquivalent(Math.max(0, displayedPm - 0.051)) && displayedAqi <= pm25ToUsAqiEquivalent(displayedPm + 0.051), 'Bedroom 3 index equivalent agrees with the live room PM within display rounding');
    assert(clockText() !== pausedClock, 'Room air-quality changes advance with simulation time');
    const offPm = pm(), offClock = clockText();
    send('PUR:OFF'); await wait(100);
    assert(!app.readConditions().purifier.on && app.readConditions().purifier.slot === 2 && document.querySelector('#bedroom3-purifier-status').textContent.includes('OFF'), 'PUR OFF keeps the purifier in the Bedroom 3 corner');
    assert(pm() === offPm && clockText() === offClock && withoutPurifier(app.readConditions()) === withoutPurifier(sealed), 'PUR OFF preserves room fields, elapsed time and other controls');
    setPlaying(true); await wait(500); setPlaying(false); await wait(300);
    assert(Math.abs(pm() - offPm) <= 0.2, 'Switching OFF stops removal in sealed Bedroom 3 without restoring its starting pollution');

    send('PUR:ON'); send('WIN1:1'); send('DOOR2:1'); send('DOOR1:1');
    app.applyHardwareControl('window', 'window_bedroom3_2', true);
    await wait(100);
    assert(app.readConditions().windows.window_bedroom3_1 && app.readConditions().doors.door_bedroom3 && app.readConditions().doors.main_door && app.readConditions().purifier.on, 'Window and door switch controls remain live alongside purifier power');
    const beforeDirtyAir = pm(), beforeDirtyClock = clockText();
    setPlaying(true); await wait(1200); setPlaying(false); await wait(300);
    observations.dirtyAirBedroom3Pm25 = [beforeDirtyAir, pm()];
    assert(pm() > beforeDirtyAir + 5 && clockText() !== beforeDirtyClock, 'Dirty incoming air can worsen Bedroom 3 PM while the purifier remains on');
    assert(JSON.stringify(app.readConditions().portableFan) === JSON.stringify(sealed.portableFan), 'All purifier and opening messages leave the fan configuration untouched');

    send('WIN1:0'); await wait(100);
    setPlaying(wasPlaying);
    stream.close(); await wait(100);
    assert(document.querySelector('#hardware-controls').dataset.connection === 'disconnected', 'USB removal is handled');
    key();
    assert(app.readConditions().windows.window_bedroom3_1, 'Standalone controls work after disconnect');
  } finally {
    if (document.querySelector('#hardware-controls').dataset.connection === 'connected') { button.click(); await wait(100); }
    if (descriptor) Object.defineProperty(navigator, 'serial', descriptor); else delete navigator.serial;
    app.replaceConditions(saved, true);
    speed.value = savedSpeed; speed.dispatchEvent(new Event('change', { bubbles: true }));
    setPlaying(wasPlaying);
  }
  return window.heatSimSerialResult = { status: 'passed', checks, writes, observations };
})().catch(error => {
  window.heatSimSerialResult = { ...window.heatSimSerialResult, status: 'failed', error: error.message };
})
