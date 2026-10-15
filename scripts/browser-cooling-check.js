// Run with gstack browse eval scripts/browser-cooling-check.js on a freshly loaded app.
window.heatSimCoolingCheck = { status: 'running' };
(async () => {
  const checks = [], workers = [], errors = [];
  const element = selector => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const assert = (condition, label) => {
    if (!condition) throw new Error(label);
    checks.push(label);
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (condition, label, limit = 30000) => {
    const started = performance.now();
    while (!condition()) {
      if (performance.now() - started >= limit) throw new Error(`${label}: ${element('#cl-status').textContent}`);
      await wait(25);
    }
  };
  const click = selector => element(selector).click();
  const key = (target, value, code) => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, code, bubbles: true }));
  const change = (selector, value) => {
    const node = element(selector);
    node.value = String(value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const check = (selector, checked) => {
    const node = element(selector);
    if (node.disabled) throw new Error(`Cannot change disabled ${selector}`);
    node.checked = checked;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-8 * Math.max(1, Math.abs(expected)), label);
  const OriginalWorker = window.Worker;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  let failWorker = false, download, controlEvents = 0;
  const onError = event => errors.push(event.message ?? String(event.reason));
  const onControl = () => controlEvents++;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  window.addEventListener('heatsim:control', onControl);
  window.Worker = new Proxy(OriginalWorker, {
    construct(target, args) {
      if (failWorker) throw new Error('QA injected worker startup failure');
      const worker = Reflect.construct(target, args);
      const record = { messages: [], terminated: false };
      workers.push(record);
      worker.addEventListener('message', event => record.messages.push(event.data));
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => { record.terminated = true; terminate(); };
      return worker;
    },
  });
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:')) download = { url: this.href, name: this.download };
    else originalAnchorClick.call(this);
  };
  let heartbeatTimer;
  try {
    const model = element('.model-panel');
    const canvas = model.querySelector('canvas');
    if (!element('#play-status').textContent.includes('running')) click('[data-action="play"]');
    click('[data-mode="pressure"]');
    click('[data-workspace="lab"]');
    assert(!element('#cooling-lab-workspace').hidden && element('#flat-workspace').hidden, 'Cooling Lab opens without a board');
    assert(element('[data-lab-model-slot]').contains(model) && model.querySelector('canvas') === canvas, 'Lab reuses the same model node and canvas');
    assert(element('#cl-export').disabled, 'No comparison export is enabled before a run');
    await wait(300);
    const heldClock = element('#elapsed-time').textContent;
    await wait(350);
    assert(element('#elapsed-time').textContent === heldClock && element('#play-status').textContent.includes('running'), 'Lab suspends the apartment clock while preserving its playback setting');
    const controlsBefore = controlEvents;
    for (const [value, code] of [['f', 'KeyF'], ['q', 'KeyQ'], ['1', 'Digit1'], [' ', 'Space']]) key(document.body, value, code);
    element('#cl-flow').focus();
    key(element('#cl-flow'), '1', 'Digit1');
    assert(controlEvents === controlsBefore, 'Lab and form focus suppress apartment shortcuts');

    click('#cl-run');
    const cancelled = workers.at(-1);
    click('#cl-cancel');
    await wait(60);
    assert(cancelled?.terminated && !element('#cl-run').disabled && element('#cl-export').disabled, 'Cancel terminates work and keeps results unavailable');

    const originalFlow = element('#cl-flow').value;
    click('#cl-run');
    const invalidated = workers.at(-1);
    change('#cl-flow', Number(originalFlow) + 10);
    await wait(60);
    assert(invalidated?.terminated && !element('#cl-run').disabled && element('#cl-export').disabled, 'Changing a setting cancels work and invalidates old results');
    change('#cl-flow', originalFlow);

    let ticks = 0, maxHeartbeatGap = 0, previousTick = performance.now();
    heartbeatTimer = setInterval(() => {
      const now = performance.now();
      maxHeartbeatGap = Math.max(maxHeartbeatGap, now - previousTick);
      previousTick = now; ticks++;
    }, 20);
    const started = performance.now();
    click('#cl-run');
    const completed = workers.at(-1);
    await until(() => completed.messages.some(message => message.type === 'result') && !element('#cl-export').disabled, 'Comparison did not finish');
    clearInterval(heartbeatTimer);
    const report = completed.messages.find(message => message.type === 'result').result;
    assert(report.durationSeconds === 1200, 'Default comparison advances both runs for 20 simulated minutes');
    assert(ticks > 0 && maxHeartbeatGap < 1000, 'Main-thread heartbeat stays responsive during the real worker run');
    assert(report.off.samples.length === report.on.samples.length && report.off.samples.length <= 121, 'Both traces have matching bounded sample counts');
    assert(report.off.samples.every((sample, index) => sample.elapsedSeconds === report.on.samples[index].elapsedSeconds && (!index || sample.elapsedSeconds > report.off.samples[index - 1].elapsedSeconds)), 'Trace timestamps match and increase');
    close(report.off.final.elapsedSeconds, report.durationSeconds, 'Fan-off run reaches the requested time');
    close(report.on.final.elapsedSeconds, report.durationSeconds, 'Fan-on run reaches the requested time');
    for (const field of ['averageTemperature', 'averageUpperTemperature', 'averageSurfaceTemperature', 'averagePm25']) {
      close(report.off.initial[field], report.on.initial[field], `Both runs share initial ${field}`);
    }
    const room = element('#cl-room').value;
    const values = [...report.off.samples, ...report.on.samples].map(sample => sample.rooms.find(reading => reading.room === room).lowerTemperature);
    const chartMin = Math.floor((Math.min(...values) - 0.15) * 2) / 2;
    const chartMax = Math.ceil((Math.max(...values) + 0.15) * 2) / 2;
    for (const arm of ['off', 'on']) {
      const points = element(`#cl-chart [data-cl-series="${arm}"]`).getAttribute('d').match(/[ML][^ML]+/g);
      assert(points.length === report[arm].samples.length && points.every((point, index) => {
        const [x, y] = point.slice(1).trim().split(/\s+/).map(Number);
        const sample = report[arm].samples[index];
        const temperature = sample.rooms.find(reading => reading.room === room).lowerTemperature;
        return Math.abs(x - (46 + sample.elapsedSeconds / report.durationSeconds * 416)) <= .006 && Math.abs(y - (180 - (temperature - chartMin) / (chartMax - chartMin) * 146)) <= .006;
      }), `${arm} chart trace matches selected-room worker temperatures and time`);
    }
    const ventArrow = element('#cl-cross-section').querySelector('[data-cl-vent-flow]');
    assert(Math.abs(report.on.final.actualVentM3h) < .1
      ? !ventArrow && element('#cl-cross-section').textContent.includes('No exchange')
      : ventArrow?.getAttribute('data-cl-vent-flow') === (report.on.final.actualVentM3h < 0 ? 'backflow' : 'forward'), 'Section arrow reflects actual exchange, including a blocked route');
    assert(element('#cl-expansion-result').textContent.includes('Fan input power'), 'Thermodynamics calculator labels watts as power');
    click('#cl-export');
    assert(download?.name.endsWith('.csv'), 'Comparison downloads CSV');
    const csv = await (await fetch(download.url)).text();
    const rows = csv.split(/\r?\n/).map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"')));
    const header = rows.shift();
    const records = rows.map(row => Object.fromEntries(header.map((name, index) => [name, row[index]])));
    for (const [name, run] of [['fan_off', report.off], ['fan_on', report.on]]) {
      const trace = records.filter(row => row.record === 'trace' && row.run_id === name);
      assert(trace.length === run.samples.length && trace.every((row, index) => Number(row.elapsed_s) === run.samples[index].elapsedSeconds && Math.abs(Number(row.air_temperature_c) - run.samples[index].averageTemperature) < 1e-8), `${name} exported trace matches the worker result`);
    }
    const difference = records.find(row => row.record === 'difference');
    close(Number(difference.air_temperature_c), report.on.final.averageTemperature - report.off.final.averageTemperature, 'CSV difference equals fan on minus fan off');
    click('[data-workspace="flat"]');
    assert(element('#flat-workspace').contains(model) && element('[data-mode="pressure"]').getAttribute('aria-pressed') === 'true', 'Apartment view and previous pressure overlay restore');
    await wait(350);
    assert(element('#elapsed-time').textContent !== heldClock, 'Apartment clock resumes when returning from the lab');
    click('[data-workspace="lab"]');
    assert(!element('#cl-export').disabled, 'Reopening Cooling Lab retains the comparison');

    failWorker = true;
    click('#cl-run');
    await until(() => !element('#cl-run').disabled, 'Failed worker did not recover UI', 1000);
    assert(element('#cl-status').textContent.includes('QA injected worker startup failure') && element('#cl-export').disabled, 'Worker startup error is visible and stale export stays disabled');
    failWorker = false;
    click('#cl-run');
    await until(() => !element('#cl-export').disabled, 'Retry after worker error failed');
    const capturedWeather = element('#cl-environment').textContent;
    click('[data-workspace="flat"]');
    const newTemperature = Number(element('#outdoorTemperature').value) + 1;
    change('#outdoorTemperature', newTemperature);
    click('[data-workspace="lab"]');
    assert(!element('#cl-capture-status').hidden && element('#cl-environment').textContent === capturedWeather && !element('#cl-export').disabled, 'Changed flat settings show a stale-capture notice while retaining the paired result');
    click('#cl-recapture');
    assert(element('#cl-capture-status').hidden && element('#cl-environment').textContent.startsWith(`${newTemperature}°C`) && element('#cl-export').disabled, 'Refresh explicitly captures the edited flat and clears old results');
    click('#cl-run');
    await until(() => !element('#cl-export').disabled, 'Comparison after refreshing capture failed');

    change('#cl-outdoor-temperature', 27.5);
    change('#cl-outdoor-pm25', 35);
    change('#cl-wind-speed', 2.3);
    change('#cl-wind-from', 'E');
    change('#cl-flow', 190);
    assert(element('#cl-outdoor-temperature').value === '27.5' && element('#cl-outdoor-pm25').value === '35' && element('#cl-wind-speed').value === '2.3' && element('#cl-wind-from').value === 'E', 'Lab weather persists through unrelated fan edits');
    assert(element('#cl-aqi-equivalent').textContent.includes('US EPA PM2.5 index equivalent (24-hour scale)') && element('#cl-aqi-equivalent').textContent.includes('not Singapore PSI'), 'Lab PM display identifies the scenario index scale');
    click('[data-workspace="flat"]'); click('[data-workspace="lab"]');
    assert(element('#cl-outdoor-temperature').value === '27.5' && element('#cl-wind-from').value === 'E', 'Lab local weather survives leaving and reopening');

    const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1)?.name;
    const app = await import(appUrl);
    click('[data-workspace="flat"]');
    app.applyHardwareControl('window', 'window_living_1', true);
    app.applyHardwareControl('door', 'main_door', true);
    app.applyHardwareControl('door', 'door_bedroom3', true);
    const hardwareCapture = app.readConditions();
    click('[data-workspace="lab"]'); click('#cl-recapture');
    change('#cl-room', 'bedroom3');
    change('#cl-comparison-mode', 'configuration');
    assert(element('#cl-run').disabled && !element('#cl-baseline-controls').hidden, 'Configuration comparison requires an explicit baseline');
    check('#cl-fan-on', false);
    click('#cl-capture-baseline');
    assert(!element('#cl-run').disabled && element('#cl-baseline-status').textContent.includes('Baseline saved'), 'Capturing a baseline enables configuration comparison');
    check('[data-opening-id="window_living_1"]', false);
    check('[data-opening-id="door_bedroom3"]', false);
    check('#cl-purifier-on', true);
    change('#cl-purifier-slot', 1);
    check('#cl-fan-on', true);
    change('#cl-flow', 220);
    change('#cl-outdoor-temperature', 28.5);
    change('#cl-outdoor-pm25', 55);
    change('#cl-wind-from', 'N');
    change('#cl-duration', 600);
    check('#cl-corridor-enabled', true);
    change('#cl-corridor-temperature', 26);
    change('#cl-corridor-pm25', 10);
    assert(!element('#cl-corridor-fields').hidden && !document.querySelector('#flat-workspace [id*="corridor-temperature"]'), 'Separate corridor controls belong only to the lab');
    click('#cl-run');
    const configurationWorker = workers.at(-1);
    await until(() => !element('#cl-export').disabled, 'Configuration comparison did not finish');
    const configuration = configurationWorker.messages.find(message => message.type === 'result').result;
    assert(configuration.comparisonMode === 'configuration' && configuration.durationSeconds === 600, 'Configuration mode reaches its selected horizon');
    assert(JSON.stringify(configuration.baselineConfig.base.windows) === JSON.stringify(hardwareCapture.windows) && JSON.stringify(configuration.baselineConfig.base.doors) === JSON.stringify(hardwareCapture.doors), 'Baseline preserves the app hardware-action opening snapshot');
    assert(configuration.baselineConfig.base.windows.window_living_1 && !configuration.candidateConfig.base.windows.window_living_1 && configuration.baselineConfig.base.doors.door_bedroom3 && !configuration.candidateConfig.base.doors.door_bedroom3, 'Candidate window and door changes leave the baseline intact');
    assert(configuration.candidateConfig.base.purifier.on && configuration.candidateConfig.base.purifier.slot === 1 && !configuration.baselineConfig.vent.on && configuration.candidateConfig.vent.on && configuration.candidateConfig.vent.ratedM3h === 220, 'Candidate purifier position and vent settings reach the real worker');
    assert(['outdoorTemperature', 'outdoorPm25', 'humidity', 'windSpeed', 'windFrom', 'timeOfDay', 'scenarioId'].every(field => configuration.baselineConfig.base[field] === configuration.candidateConfig.base[field]) && configuration.baselineConfig.base.outdoorTemperature === 28.5 && configuration.baselineConfig.base.outdoorPm25 === 55 && configuration.baselineConfig.base.windFrom === 'N', 'Current shared weather applies to both trials after the baseline was captured');
    assert(JSON.stringify(configuration.baselineConfig.corridor) === JSON.stringify(configuration.candidateConfig.corridor) && configuration.candidateConfig.corridor.enabled && configuration.candidateConfig.corridor.temperature === 26 && configuration.candidateConfig.corridor.pm25 === 10, 'Both trials use the same prescribed corridor boundary');
    assert(configuration.off.samples.length === configuration.on.samples.length && configuration.off.samples.every((sample, index) => sample.elapsedSeconds === configuration.on.samples[index].elapsedSeconds) && configuration.off.final.elapsedSeconds === 600 && configuration.on.final.elapsedSeconds === 600, 'Configuration traces share timestamps and the requested horizon');
    for (const field of ['averageTemperature', 'averageUpperTemperature', 'averageSurfaceTemperature', 'averagePm25']) close(configuration.off.initial[field], configuration.on.initial[field], `Configuration arms share initial ${field}`);
    assert([...configuration.off.final.rooms, ...configuration.on.final.rooms].every(room => room.corridorInflowM3h < 1e-8 || room.room === 'dining'), 'Any prescribed corridor inflow enters only the main-door room');
    assert(element('.cl-chart-key').textContent.includes('Baseline') && element('.cl-chart-key').textContent.includes('Candidate') && element('#cl-section-title').textContent.toLowerCase().includes('candidate') && element('#cl-comparison-description').textContent.includes('Candidate minus baseline'), 'Configuration results use baseline/candidate labels');
    assert(element('#cl-flow-result').textContent.includes('Air changes') && element('#cl-flow-result').textContent.includes('Ventilation heat removed') && element('#cl-flow-result').textContent.includes('PM exposure') && element('#cl-flow-result').textContent.includes('Wh'), 'Comparison presents boundary air changes, heat removal, exposure and electricity units');
    click('#cl-export');
    const configurationCsv = await (await fetch(download.url)).text();
    const configurationRows = configurationCsv.split(/\r?\n/).map(line => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"')));
    const configurationHeader = configurationRows.shift();
    const configurationRecords = configurationRows.map(row => Object.fromEntries(configurationHeader.map((name, index) => [name, row[index]])));
    assert(configurationRecords.some(row => row.record === 'difference' && row.run_id === 'candidate_minus_baseline') && !configurationRecords.some(row => row.run_id === 'fan_on' || row.run_id === 'fan_off'), 'Configuration CSV names baseline/candidate and the difference direction');
    for (const [id, run] of [['baseline', configuration.off], ['candidate', configuration.on]]) {
      const final = configurationRecords.find(row => row.record === 'final_summary' && row.run_id === id);
      assert([['boundary_air_changes_per_h', 'airChangesPerHour'], ['sensible_heat_removed_w', 'sensibleHeatRemovedWatts'], ['ventilation_heat_removed_j', 'ventilationHeatRemovedJ'], ['fan_energy_wh', 'fanEnergyWh'], ['energy_wh', 'energyWh']].every(([column, field]) => Math.abs(Number(final[column]) - run.final[field]) < 1e-8) && Math.abs(Number(final.pm_exposure_ug_h_m3) - run.pmExposureUgHoursM3) < 1e-8, `${id} CSV exchange, heat, electricity and exposure match real worker values`);
      const actualConfig = configurationRecords.find(row => row.parameter === 'actual_config_json' && row.run_id === id);
      assert(JSON.stringify(JSON.parse(actualConfig.value)) === JSON.stringify(id === 'baseline' ? configuration.baselineConfig : configuration.candidateConfig), `${id} CSV includes the actual configuration used`);
    }
    click('#cl-run');
    const corridorCancelled = workers.at(-1);
    check('#cl-corridor-enabled', false);
    assert(corridorCancelled.terminated && element('#cl-export').disabled && element('#cl-corridor-fields').hidden, 'Changing the corridor cancels work and clears stale results');
    click('#cl-run');
    const noCorridorWorker = workers.at(-1);
    await until(() => !element('#cl-export').disabled, 'Comparison with corridor disabled did not finish');
    const noCorridor = noCorridorWorker.messages.find(message => message.type === 'result').result;
    assert(!noCorridor.baselineConfig.corridor.enabled && !noCorridor.candidateConfig.corridor.enabled && noCorridor.off.final.corridorInflowM3h === 0 && noCorridor.on.final.corridorInflowM3h === 0, 'Disabling the corridor removes its boundary inflow in both trials');
    click('#cl-reset-weather');
    assert(Number(element('#cl-outdoor-temperature').value) === hardwareCapture.outdoorTemperature && Number(element('#cl-outdoor-pm25').value) === hardwareCapture.outdoorPm25 && element('#cl-wind-from').value === (hardwareCapture.windFrom ?? '') && !element('[data-opening-id="window_living_1"]').checked && !element('#cl-run').disabled, 'Lab weather reset preserves candidate interventions and the saved baseline');
    change('#cl-wind-from', 'W');
    change('#cl-scenario', 'haze_outside');
    assert(element('#cl-wind-from').value === '' && element('#cl-outdoor-pm25').value === '200' && !element('[data-opening-id="window_living_1"]').checked && !element('#cl-run').disabled, 'Lab scenario change clears manual weather while preserving the comparison setup');
    assert(errors.length === 0, 'No uncaught browser errors during Cooling Lab interactions');
    for (const mode of ['rejected', 'pending']) {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;top:0;left:0;width:430px;height:700px;z-index:9999;background:white';
      const adapter = mode === 'rejected' ? 'Promise.reject(new Error("QA adapter request failed"))' : 'new Promise(() => {})';
      frame.srcdoc = `<html><head><base href="${location.origin}/"></head><body><div id="app"></div><script>Object.defineProperty(navigator,"gpu",{configurable:true,value:{requestAdapter:()=>${adapter}}});</script><script type="module" src="/src/main.ts"></script></body></html>`;
      document.body.append(frame);
      try {
        await until(() => frame.contentDocument?.querySelector('#simulation-engine'), `Fallback fixture (${mode}) did not load`, 5000);
        const doc = frame.contentDocument;
        await wait(300);
        const firstTime = doc.querySelector('#elapsed-time').textContent;
        await wait(400);
        assert(doc.querySelector('#simulation-engine').textContent === 'CPU · 2D' && doc.querySelector('#elapsed-time').textContent !== firstTime, `${mode} GPU startup keeps the CPU clock advancing`);
        const before = doc.querySelector('[data-device-key="fanOn"]').checked;
        doc.body.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
        assert(doc.querySelector('[data-device-key="fanOn"]').checked !== before, `${mode} GPU startup keeps keyboard controls responsive`);
        doc.querySelector('[data-action="play"]').click();
        await wait(300);
        const pausedTime = doc.querySelector('#elapsed-time').textContent;
        await wait(350);
        assert(doc.querySelector('#elapsed-time').textContent === pausedTime, `${mode} GPU startup respects Pause`);
        doc.querySelector('[data-action="play"]').click();
        await wait(350);
        assert(doc.querySelector('#elapsed-time').textContent !== pausedTime, `${mode} GPU startup respects Resume`);
      } finally { frame.remove(); }
    }
    return { checks, runtimeMs: Math.round(performance.now() - started), workerMs: Math.round(report.runtimeMs), heartbeatTicks: ticks, maxHeartbeatGapMs: Math.round(maxHeartbeatGap), sampleCount: report.off.samples.length, webglAvailable: Boolean(canvas), viewport: { width: innerWidth, height: innerHeight } };
  } finally {
    clearInterval(heartbeatTimer);
    window.Worker = OriginalWorker;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
    window.removeEventListener('heatsim:control', onControl);
  }
})().then(
  result => { window.heatSimCoolingCheck = { status: 'passed', ...result }; },
  error => { window.heatSimCoolingCheck = { status: 'failed', error: error.message }; },
);
