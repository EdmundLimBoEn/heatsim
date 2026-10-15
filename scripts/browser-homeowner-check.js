// Run on a fresh Vite page at 1280×800; read window.heatSimHomeownerCheck.
window.heatSimHomeownerCheck = { status: 'running' };
(async () => {
  const checks = [], workers = [], metrics = {};
  const element = selector => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (condition, label, limit = 30000) => {
    const start = performance.now();
    while (!condition()) { if (performance.now() - start > limit) throw new Error(label); await wait(25); }
  };
  const reveal = node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
    return node;
  };
  const click = selector => reveal(element(selector)).click();
  const change = (selector, value) => {
    const node = reveal(element(selector)); node.value = String(value);
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const key = (node, value) => node.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
  const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1)?.name;
  const app = await import(appUrl), saved = app.readConditions();
  const wasPlaying = element('#play-status').textContent.includes('running');
  const setPlaying = value => { if (element('#play-status').textContent.includes('running') !== value) click('[data-action="play"]'); };
  const OriginalWorker = window.Worker;
  window.Worker = new Proxy(OriginalWorker, {
    construct(target, args) {
      const worker = Reflect.construct(target, args), record = { messages: [], terminated: false };
      workers.push(record); worker.addEventListener('message', event => record.messages.push(event.data));
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => { record.terminated = true; terminate(); };
      return worker;
    },
  });
  try {
    metrics.mapTop = element('.model-panel').getBoundingClientRect().top;
    metrics.suggestTop = element('.quick-controls').getBoundingClientRect().top;
    assert(innerWidth === 1280 && metrics.mapTop <= 280 && metrics.suggestTop < innerHeight - 44, 'Desktop map and quick controls are visible immediately');
    const primaries = [...document.querySelectorAll('.button.primary')].filter(node => node.getClientRects().length && node.getBoundingClientRect().top < innerHeight);
    assert(primaries.length === 0 && element('#panel-suggest').hidden, 'Optional suggestions start collapsed so direct controls lead the demo');
    assert(!element('#more-menu').open && !element('#manual-weather').open && !element('#advice-settings').open, 'Expert and device-budget disclosures start closed');
    assert(element('[data-mode="pressure"]').hidden && element('#day-select option[value="validation"]').hidden, 'Pressure and validation remain behind Science views');
    const science = reveal(element('#science-views')); science.checked = true; science.dispatchEvent(new Event('change', { bubbles: true }));
    assert(!element('[data-mode="pressure"]').hidden && !element('#day-select option[value="validation"]').hidden, 'Science views reveals both existing advanced controls');
    key(element('#more-menu > summary'), 'Escape');
    assert(!element('#more-menu').open && document.activeElement === element('#more-menu > summary'), 'Escape closes More and returns focus to its summary');
    click('[data-tab="room"]'); element('#tab-room').focus(); key(element('#tab-room'), 'ArrowRight');
    assert(document.activeElement === element('#tab-devices'), 'Tab arrow navigation follows Windows and doors then Devices');
    key(element('#tab-devices'), 'End');
    assert(document.activeElement === element('#tab-suggest'), 'End focuses Suggest at the end of the visible tabs');
    window.scrollTo(0, 0);
    const model = element('.model-panel'), parent = model.parentElement, canvas = model.querySelector('canvas');
    click('nav [data-workspace="lab"]');
    metrics.labCollapsedHeight = document.documentElement.scrollHeight;
    assert(metrics.labCollapsedHeight <= 1600 && !element('#cl-more-settings').open && !element('#cl-about-test').open, 'Window fan test meets the collapsed-height target with advanced settings closed');
    assert(element('[data-lab-model-slot]').contains(model), 'Window fan test reuses the original model node');
    change('#cl-flow', 150);
    assert(element('#cl-more-settings').open && element('#cl-flow').value === '150', 'Lab settings remain editable inside their disclosure');
    click('nav [data-workspace="study"]');
    metrics.studyCollapsedHeight = document.documentElement.scrollHeight;
    assert(metrics.studyCollapsedHeight <= 1500 && !element('#cs-weather-details').open && !element('#cs-plan-format').open, 'Floor-plan comparison meets the collapsed-height target with expert inputs closed');
    assert(model.parentElement === parent && model.querySelector('canvas') === canvas, 'Leaving the fan test restores the same model and canvas to their original parent');
    change('#cs-scenario', 'haze_outside');
    assert(element('#cs-pm25').value === '200' && element('#cs-initial-pm25').value === '40' && element('#cs-weather-summary').textContent.includes('200'), 'Study day choice updates shared weather, starting PM and visible summary');
    change('#cs-project', 'QA home comparison');
    assert(element('#cs-weather-details').open && element('#cs-project').value === 'QA home comparison', 'Study weather provenance remains editable in its disclosure');
    click('nav [data-workspace="lab"]');
    assert(element('#cl-more-settings').open && element('#cl-flow').value === '150', 'Lab disclosure and settings survive workspace changes');
    click('nav [data-workspace="flat"]');
    assert(model.parentElement === parent && model.querySelector('canvas') === canvas, 'Returning to My flat preserves its model node and canvas');
    setPlaying(false); app.loadScenario('hot_afternoon');
    const before = app.readConditions();
    for (const id of Object.keys(before.windows)) before.windows[id] = false;
    for (const id of Object.keys(before.doors)) before.doors[id] = false;
    for (const id of Object.keys(before.devices)) before.devices[id] = false;
    before.portableFan = { on: false, slot: 0, angleDeg: 90, speed: 2 };
    before.purifier = { on: false, slot: 2 };
    app.replaceConditions(before, true);
    change('#optimiser-budget', 'fan');
    const openingBudget = reveal(element('#optimiser-openings')); openingBudget.checked = false; openingBudget.dispatchEvent(new Event('change', { bubbles: true }));
    element('#advice-settings').open = false;
    click('[data-tab="suggest"]'); click('#run-optimiser'); const run = workers.at(-1);
    click('nav [data-workspace="lab"]');
    click('nav [data-workspace="study"]');
    const hiddenClock = element('#elapsed-time').textContent;
    await until(() => run.messages.some(message => message.type === 'result') && document.querySelector('#apply-optimiser'), 'Advice worker did not produce a reviewable result');
    assert(!element('#contractor-study-workspace').hidden && element('#flat-workspace').hidden && document.activeElement === element('#contractor-study-title'), 'Advice completion never changes the workspace or steals focus from the active study');
    assert(element('#elapsed-time').textContent === hiddenClock && JSON.stringify(app.readConditions()) === JSON.stringify(before), 'Navigating during suggestions preserves flat settings and its stopped clock');
    click('nav [data-workspace="flat"]');
    assert(Boolean(document.querySelector('#apply-optimiser')) && !element('#flat-workspace').hidden, 'Returning to My flat retains the completed reviewable suggestion');
    const report = run.messages.find(message => message.type === 'result').report;
    metrics.workerMs = Math.round(report.durationMs);
    assert(JSON.stringify(app.readConditions()) === JSON.stringify(before), 'Suggesting changes never applies them automatically');
    assert(element('.advice-actions li').textContent.match(/^(Move|Turn|Open|Close|Set|Point|Keep|Increase|Decrease)/) && element('.advice-outcome').textContent.includes('In the simulation:'), 'Advice presents a plain action and simulated outcome');
    assert(!element('#advice-score-details').open && element('#advice-score-details').contains(element('.optimiser-score')), 'Raw comparison scores start inside closed scoring details');
    assert(!element('#run-optimiser').classList.contains('primary') && element('#apply-optimiser').classList.contains('primary'), 'Apply becomes the primary action after review');
    click('#apply-optimiser');
    assert(JSON.stringify(app.readConditions()) === JSON.stringify(report.layouts[0].conditions) && document.activeElement === element('#undo-optimiser'), 'Apply uses the exact worker layout and focuses visible Undo');
    click('#undo-optimiser');
    assert(JSON.stringify(app.readConditions()) === JSON.stringify(before) && document.activeElement === element('#apply-optimiser'), 'Undo restores all pre-apply settings and focuses Apply');
    assert(element('#elapsed-time').textContent === '00:00:00', 'Undo clearly restarts readings rather than restoring elapsed history');
    const alternative = element('#optimiser-alternative');
    change('#optimiser-alternative', Math.min(1, alternative.options.length - 1));
    assert(element('#advice-score-details').open && document.activeElement === element('#optimiser-alternative'), 'Choosing an alternative retains the expanded details and keyboard focus');
    change('#optimiser-alternative', 0); click('#apply-optimiser');
    app.applyHardwarePurifier(true);
    assert(!document.querySelector('#undo-optimiser') && !document.querySelector('#apply-optimiser') && app.readConditions().purifier.on, 'A later hardware change invalidates stale Apply and Undo without overwriting the switch');
    click('[data-tab="suggest"]'); click('#run-optimiser'); const stale = workers.at(-1);
    app.applyHardwareControl('window', 'window_bedroom3_1', !app.readConditions().windows.window_bedroom3_1);
    await wait(100);
    assert(stale.terminated && !document.querySelector('#apply-optimiser'), 'Changing a control cancels an in-progress suggestion and prevents stale Apply');
    assert(element('#optimiser-result').textContent.includes('changed'), 'Invalidated advice explains that the setup changed');
    return { checks, metrics, webglAvailable: Boolean(canvas) };
  } finally {
    window.Worker = OriginalWorker;
    click('nav [data-workspace="flat"]'); app.replaceConditions(saved, true); setPlaying(wasPlaying);
  }
})().then(result => { window.heatSimHomeownerCheck = { status: 'passed', ...result }; }, error => { window.heatSimHomeownerCheck = { status: 'failed', error: error.message }; });
