// Run with gstack browse eval scripts/browser-contractor-check.js on a freshly loaded app.
window.heatSimContractorCheck = { status: 'running' };
(async () => {
  const checks = [], workers = [], errors = [], fetches = [];
  const element = selector => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (condition, label, limit = 30000) => {
    const started = performance.now();
    while (!condition()) {
      if (performance.now() - started >= limit) throw new Error(`${label}: ${document.querySelector('#cs-status')?.textContent}`);
      await wait(25);
    }
  };
  const reveal = node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    return node;
  };
  const click = selector => {
    const node = element(selector);
    if (node.dataset.mode === 'pressure' && node.hidden) {
      const science = reveal(element('#science-views'));
      science.checked = true; science.dispatchEvent(new Event('change', { bubbles: true }));
      element('#more-menu').open = false;
    }
    reveal(node).click();
  };
  const change = (selector, value) => {
    const node = reveal(element(selector)); node.value = String(value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const importPlan = async (index, content, name = 'qa-plan.json') => {
    const transfer = new DataTransfer(); transfer.items.add(new File([content], name, { type: 'application/json' }));
    const input = element(`#cs-file-${index}`); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => !element('#cs-run').disabled, `Plan ${index} import did not settle`);
  };
  const latestStudy = () => workers.filter(worker => worker.study).at(-1);
  const dragDevice = (index, id, roomId, finish = 'drop') => {
    const root = element('#contractor-study-mount'), svg = element(`#cs-preview-${index} svg`);
    const marker = svg.querySelector(`[data-placement-device="${id}"]`), circle = marker.querySelector('circle');
    const room = roomId ? svg.querySelector(`[data-placement-room="${roomId}"]`) : null;
    const matrix = svg.getScreenCTM();
    const start = new DOMPoint(Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))).matrixTransform(matrix);
    const target = new DOMPoint(room ? Number(room.getAttribute('x')) + Number(room.getAttribute('width')) / 2 : -30, room ? Number(room.getAttribute('y')) + Number(room.getAttribute('height')) / 2 : -30).matrixTransform(matrix);
    const pointer = (type, position) => new PointerEvent(type, { pointerId: 12, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true, clientX: position.x, clientY: position.y, bubbles: true });
    marker.dispatchEvent(pointer('pointerdown', start));
    root.dispatchEvent(pointer('pointermove', target));
    if (finish === 'escape') document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else root.dispatchEvent(pointer('pointerup', target));
  };
  const originalWorker = window.Worker, originalFetch = window.fetch, originalAnchorClick = HTMLAnchorElement.prototype.click;
  let failWorker = false, download, heartbeatTimer;
  const onError = event => errors.push(event.message ?? String(event.reason));
  window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onError);
  window.fetch = function (input, init) { fetches.push(String(input instanceof Request ? input.url : input)); return originalFetch.call(this, input, init); };
  window.Worker = new Proxy(originalWorker, {
    construct(target, args) {
      const study = String(args[0]).includes('contractor-worker');
      if (study && failWorker) throw new Error('QA injected contractor worker failure');
      const worker = Reflect.construct(target, args), record = { study, messages: [], requests: [], terminated: false };
      workers.push(record); worker.addEventListener('message', event => record.messages.push(event.data));
      const post = worker.postMessage.bind(worker), terminate = worker.terminate.bind(worker);
      worker.postMessage = (...values) => { record.requests.push(structuredClone(values[0])); post(...values); };
      worker.terminate = () => { record.terminated = true; terminate(); };
      return worker;
    },
  });
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:')) download = { url: this.href, name: this.download };
    else originalAnchorClick.call(this);
  };
  try {
    const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1)?.name;
    const app = await import(appUrl), originalConditions = app.readConditions();
    click('[data-tab="devices"]');
    change('#fan-slot', 1); change('#purifier-slot', 1);
    assert(app.readConditions().portableFan.slot === 1 && app.readConditions().purifier.slot === 1, 'Flat placement selects update canonical fan and purifier slots');
    element('#fan-slot').blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '.', code: 'Period', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', shiftKey: true, bubbles: true }));
    assert(app.readConditions().portableFan.slot === 2 && app.readConditions().purifier.slot === 2, 'Flat keyboard placement alternatives move fan and purifier slots');
    app.replaceConditions(originalConditions, true);
    const flatConditions = JSON.stringify(app.readConditions());
    const model = element('.model-panel'), canvas = model.querySelector('canvas');
    if (!element('#play-status').textContent.includes('running')) click('[data-action="play"]');
    click('[data-mode="pressure"]');
    click('[data-workspace="lab"]');
    change('#cl-outdoor-temperature', 27.5); click('#cl-run');
    await until(() => !element('#cl-export').disabled, 'Cooling Lab baseline did not finish');
    const labChart = element('#cl-chart').innerHTML, labEnvironment = element('#cl-environment').textContent;
    click('[data-workspace="flat"]'); click('[data-workspace="study"]');
    assert(!element('#contractor-study-workspace').hidden && element('#flat-workspace').hidden && element('#cooling-lab-workspace').hidden, 'Contractor Study is a separate workspace');
    assert(element('#flat-workspace').contains(model) && model.querySelector('canvas') === canvas, 'Study keeps the canonical flat model node and canvas intact');
    await wait(300);
    const heldClock = element('#elapsed-time').textContent;
    let hiddenReadoutMutations = 0;
    const observer = new MutationObserver(records => { hiddenReadoutMutations += records.length; });
    observer.observe(element('#elapsed-time'), { subtree: true, childList: true, characterData: true });
    await wait(400); observer.disconnect();
    assert(element('#elapsed-time').textContent === heldClock && hiddenReadoutMutations === 0, 'Study pauses the flat clock and periodic hidden readout writes');
    assert(element('#play-status').textContent.includes('running'), 'Study preserves the flat playback preference');
    for (const [key, code] of [['f', 'KeyF'], ['1', 'Digit1'], ['q', 'KeyQ'], [' ', 'Space']]) document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
    reveal(element('#cs-project')).focus();
    element('#cs-project').dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true }));
    assert(JSON.stringify(app.readConditions()) === flatConditions, 'Study body and form keyboard input leave flat controls unchanged');
    assert(element('#cs-run').disabled && element('#cs-export-html').disabled && element('#cs-export-json').disabled, 'Study requires valid plans before running or exporting');

    const examples = await Promise.all(['/study-examples/cross-ventilation.json', '/study-examples/one-sided.json', '/study-examples/open-plan.json'].map(async url => {
      const response = await fetch(url); if (!response.ok) throw new Error(`Example missing: ${url}`); return response.json();
    }));
    click('#cs-load-examples');
    await until(() => !element('#cs-run').disabled, 'Example plans did not load');
    assert(new Set(examples.map(plan => JSON.stringify(plan.rooms))).size === 3 && new Set(examples.map(plan => plan.id)).size === 3, 'The three bundled JSON files contain distinct plan geometries');
    for (let index = 0; index < examples.length; index++) {
      const plan = examples[index], svg = element(`#cs-preview-${index} svg`), rects = [...svg.querySelectorAll('rect')];
      const minX = Math.min(...plan.rooms.map(room => room.x)), minZ = Math.min(...plan.rooms.map(room => room.z));
      const width = Math.max(...plan.rooms.map(room => room.x + room.widthM)) - minX, depth = Math.max(...plan.rooms.map(room => room.z + room.depthM)) - minZ;
      const scale = Math.min(260 / width, 165 / depth);
      assert(rects.length === plan.rooms.length && rects.every((rect, roomIndex) => {
        const room = plan.rooms[roomIndex];
        return [['x', 24 + (room.x - minX) * scale], ['y', 34 + (room.z - minZ) * scale], ['width', room.widthM * scale], ['height', room.depthM * scale]].every(([attribute, expected]) => Math.abs(Number(rect.getAttribute(attribute)) - expected) < 1e-7);
      }), `Plan ${index + 1} preview rectangles match imported room dimensions`);
      assert(svg.querySelector('.cs-north-label')?.textContent === 'N' && [...svg.querySelectorAll('g')].some(group => group.getAttribute('transform')?.includes(`rotate(${-plan.northDegrees})`)) && element(`#cs-plan-meta-${index}`).textContent.includes(`${plan.northDegrees}°`), `Plan ${index + 1} preview declares and rotates geographic north`);
      assert(element(`#cs-plan-name-${index}`).textContent === plan.name && svg.querySelectorAll('line').length === plan.openings.length, `Plan ${index + 1} name and opening count follow its JSON`);
    }
    const originalPreview = element('#cs-preview-0').innerHTML;
    await importPlan(0, '{bad JSON');
    assert(element('#cs-plan-status-0').textContent.toLowerCase().includes('invalid json') && element('#cs-preview-0').innerHTML === originalPreview, 'Bad JSON reports an error and preserves the last valid plan');
    const hostilePlan = structuredClone(examples[0]);
    hostilePlan.name = '<img src=x onerror="window.__studyXss=true">';
    hostilePlan.northDegrees = 90;
    await importPlan(0, JSON.stringify(hostilePlan), 'escaped-plan.json');
    assert(element('#cs-plan-name-0').textContent === hostilePlan.name && !element('#cs-preview-0').querySelector('img') && !window.__studyXss, 'Imported plan labels render as text rather than executable markup');
    assert(element('#cs-preview-0').querySelector('g[transform="translate(278 24) rotate(-90)"]') && element('#cs-plan-meta-0').textContent.includes('north 90°'), 'Changing imported north bearing rotates the preview direction');

    change('#cs-project', 'QA three-plan study'); change('#cs-location', 'Illustrative Singapore site');
    change('#cs-latitude', 1.3521); change('#cs-longitude', 103.8198);
    change('#cs-temperature', 29.2); change('#cs-pm25', 55.4); change('#cs-wind-speed', 2.4); change('#cs-wind-from', 'E');
    change('#cs-humidity', 72); change('#cs-hour', 15);
    change('#cs-source-type', 'forecast'); change('#cs-source-name', 'Windy manual copy'); change('#cs-source-model', 'Illustrative source model');
    change('#cs-source-url', 'https://www.windy.com/1.3521/103.8198'); change('#cs-valid-time', '2026-10-15T15:00');
    change('#cs-time-zone', 'Asia/Singapore'); change('#cs-reference-height', 10);
    change('#cs-initial-temperature', 30); change('#cs-initial-pm25', 15); change('#cs-occupancy', 4);
    const windy = element('#cs-windy');
    assert(windy.href === 'https://www.windy.com/1.3521/103.8198' && windy.rel.includes('noopener') && windy.getAttribute('aria-disabled') === 'false', 'Windy lookup uses the entered coordinates with safe external navigation');
    assert(!fetches.some(url => new URL(url, location.href).origin !== location.origin) && !element('.contractor-study').querySelector('iframe[src^="http"]'), 'Entering provenance makes no automatic external weather request or embed');
    const weatherFields = ['cs-temperature', 'cs-pm25', 'cs-wind-speed', 'cs-wind-from'];
    const beforeMap = weatherFields.map(id => element(`#${id}`).value);
    element('#cs-load-windy').closest('details').open = true;
    click('#cs-load-windy');
    const mapUrl = new URL(element('#cs-windy-map iframe').src);
    assert(mapUrl.origin === 'https://embed.windy.com' && mapUrl.pathname === '/embed.html' && mapUrl.searchParams.get('lat') === '1.3521' && mapUrl.searchParams.get('lon') === '103.8198', 'Explicit Windy map loading uses the official embed and entered coordinates');
    assert(weatherFields.every((id, index) => element(`#${id}`).value === beforeMap[index]), 'Loading the reference map does not replace the entered simulation weather');
    change('#cs-latitude', 1.4);
    assert(!element('#cs-windy-map').querySelector('iframe'), 'Changing coordinates removes the previous-location map');
    change('#cs-latitude', 1.3521);
    assert(JSON.stringify(app.readConditions()) === flatConditions, 'Study weather and imported plans do not mutate the live flat');

    click('#cs-run'); const cancelled = latestStudy(); click('#cs-cancel');
    assert(cancelled?.terminated && !element('#cs-run').disabled && element('#cs-export-json').disabled && document.activeElement.id === 'cs-run', 'Cancel terminates the study worker and returns focus to Run');
    click('#cs-run'); const stale = latestStudy(); change('#cs-wind-speed', 2.5);
    assert(stale.terminated && element('#cs-export-html').disabled && !element('#cs-run').disabled, 'Changing study inputs cancels work and disables stale exports');
    failWorker = true; click('#cs-run');
    await until(() => !element('#cs-run').disabled, 'Injected worker failure did not recover');
    assert(element('#cs-status').textContent.includes('QA injected contractor worker failure') && element('#cs-export-json').disabled, 'Worker startup errors are visible without enabling stale reports');
    failWorker = false;
    let ticks = 0, maxGap = 0, previousTick = performance.now();
    heartbeatTimer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - previousTick); previousTick = now; ticks++; }, 20);
    click('#cs-run'); const completed = latestStudy();
    await until(() => !element('#cs-export-json').disabled, 'Three-plan worker did not finish');
    clearInterval(heartbeatTimer);
    const result = completed.messages.find(message => message.type === 'result').result;
    assert(result.cases.length === 3 && new Set(result.cases.map(item => item.geometryId)).size === 3 && result.scope === 'single-weather-case', 'The real worker solves three distinct actual plans for one weather case');
    assert(ticks > 0 && maxGap < 1000 && completed.messages.some(message => message.type === 'progress'), 'Study progress arrives while the browser heartbeat stays responsive');
    const progress = completed.messages.filter(message => message.type === 'progress').map(message => message.progress);
    assert(new Set(progress.map(value => value.planIndex)).size === 3 && progress.every((value, index) => !index || value.done >= progress[index - 1].done), 'Progress covers all three plans without moving backwards');
    assert(result.config.durationSeconds === 1200 && result.cases.every(item => item.final.elapsedSeconds === 1200 && item.samples.length <= 121), 'All three cases reach the default 20-minute horizon with bounded traces');
    assert(result.cases.every(item => item.samples.length === result.cases[0].samples.length && item.samples.every((sample, index) => sample.elapsedSeconds === result.cases[0].samples[index].elapsedSeconds)), 'All three traces use identical sample times');
    assert(result.cases.every(item => ['outdoorTemperature', 'outdoorPm25', 'humidity', 'windSpeed', 'windFrom', 'timeOfDay'].every(field => item.config.base[field] === result.config.weather[field])), 'All actual case configurations use the same entered weather');
    assert(result.cases.every(item => ['lowerT', 'upperT', 'wallT'].every(field => item.initialState[field].every(value => value === 30)) && ['lowerPm25', 'upperPm25'].every(field => item.initialState[field].every(value => value === 15))), 'Every room starts with the same declared air, surface and particle conditions');
    assert(result.cases.every(item => Math.abs(item.areaM2 - item.plan.rooms.reduce((sum, room) => sum + room.widthM * room.depthM, 0)) < 1e-7), 'Reported plan areas come from the imported dimensions');
    assert(result.config.brief.sourceType === 'forecast' && result.config.brief.sourceName === 'Windy manual copy' && result.config.brief.validTime === '2026-10-15T15:00' && result.config.brief.timeZone === 'Asia/Singapore' && result.config.brief.referenceHeightM === 10, 'Completed report retains weather provenance and reference-height assumptions');
    assert(!element('#cs-result-content').textContent.includes('Preparing the comparison report') && element('#cs-result-content').querySelector('table'), 'Completed results render comparative numerical tables');
    const temperatures = result.cases.flatMap(item => item.samples.map(sample => sample.averageTemperature));
    const low = Math.floor((Math.min(...temperatures) - .2) * 2) / 2, high = Math.ceil((Math.max(...temperatures) + .2) * 2) / 2;
    for (const option of result.cases) {
      const points = element(`[data-study-series="${option.plan.id}"]`).getAttribute('d').match(/[ML][^ML]+/g);
      assert(points.length === option.samples.length && points.every((point, index) => {
        const [x, y] = point.slice(1).trim().split(/\s+/).map(Number), sample = option.samples[index];
        return Math.abs(x - (49 + sample.elapsedSeconds / result.config.durationSeconds * 585)) <= .006 && Math.abs(y - (180 - (sample.averageTemperature - low) / (high - low) * 150)) <= .006;
      }), `${option.plan.id} chart matches the actual worker temperature trace`);
    }

    click('#cs-export-json'); const jsonDownload = download, json = JSON.parse(await (await fetch(jsonDownload.url)).text());
    assert(jsonDownload.name.endsWith('.json') && json.format === 'heatsim-contractor-study' && json.version === 1, 'Study JSON uses a versioned reproducible report format');
    assert(JSON.stringify(json.study.config) === JSON.stringify(result.config) && json.study.cases.every((item, index) => JSON.stringify(item.final) === JSON.stringify(result.cases[index].final) && JSON.stringify(item.samples) === JSON.stringify(result.cases[index].samples)), 'Study JSON preserves exact captured inputs, final readings and traces');
    click('#cs-export-html'); const htmlDownload = download, html = await (await fetch(htmlDownload.url)).text();
    const reportDocument = new DOMParser().parseFromString(html, 'text/html');
    assert(htmlDownload.name.endsWith('.html') && reportDocument.body.textContent.includes('QA three-plan study') && reportDocument.body.textContent.includes(hostilePlan.name), 'Handoff HTML retains the project and escaped imported plan names');
    assert(!reportDocument.querySelector('script,img[onerror],[onclick],[onload],a[href^="javascript:"]') && !window.__studyXss, 'Handoff HTML contains no executable imported markup');
    assert(result.cases.every(item => reportDocument.body.textContent.includes(item.geometryId)), 'Handoff HTML identifies all three computed geometries');
    const summarySection = [...reportDocument.querySelectorAll('section')].find(section => section.querySelector('h2')?.textContent === 'Compare the three outcomes');
    const summaryRows = [...summarySection.querySelector('table').querySelectorAll('tbody tr')];
    assert(summaryRows.length === 3 && summaryRows.every((row, index) => {
      const cells = [...row.querySelectorAll('td')].map(cell => cell.textContent), item = result.cases[index];
      return cells[0] === item.plan.name && cells[1] === item.areaM2.toFixed(2) && cells[3] === item.final.averageTemperature.toFixed(2) && cells[4] === item.final.averagePm25.toFixed(2) && cells[6] === item.final.energyWh.toFixed(2);
    }), 'Handoff HTML table matches computed plan areas, temperatures, particles and electricity');

    const device = result.cases[0].plan.devices[0];
    const targetRoom = result.cases[0].plan.rooms.find(room => room.id !== device.roomId).id;
    dragDevice(0, device.id, targetRoom);
    assert(element(`[data-study-device-room="${device.id}"][data-study-index="0"]`).value === targetRoom && element('#cs-export-json').disabled && !element('#cs-preview-0').querySelector('.cs-device-ghost'), 'Dragging an appliance snaps its room assignment and invalidates the old result');
    click('[data-study-download-plan="0"]');
    const movedPlan = JSON.parse(await (await fetch(download.url)).text());
    assert(movedPlan.devices.find(item => item.id === device.id).roomId === targetRoom, 'Downloaded plan JSON contains the actual dragged room assignment');
    click('#cs-run'); const movedWorker = latestStudy();
    await until(() => !element('#cs-export-json').disabled, 'Moved-device comparison did not finish');
    assert(movedWorker.requests[0].config.plans[0].devices.find(item => item.id === device.id).roomId === targetRoom, 'The next real worker input uses the dragged device assignment');
    dragDevice(0, device.id, null);
    assert(element(`[data-study-device-room="${device.id}"][data-study-index="0"]`).value === targetRoom && !element('#cs-export-json').disabled && !element('#cs-preview-0').querySelector('.cs-device-ghost'), 'Dropping outside a room leaves placement and completed result unchanged');
    dragDevice(0, device.id, device.roomId, 'escape');
    assert(element(`[data-study-device-room="${device.id}"][data-study-index="0"]`).value === targetRoom && !element('#cs-export-json').disabled && !element('#cs-preview-0').querySelector('.cs-device-ghost'), 'Escape cancels a placement drag without changing plan or result');
    const roomSelect = element(`[data-study-device-room="${device.id}"][data-study-index="0"]`);
    roomSelect.closest('details').open = true; roomSelect.focus();
    change(`[data-study-device-room="${device.id}"][data-study-index="0"]`, device.roomId);
    assert(element('#cs-export-json').disabled && element(`[data-study-device-room="${device.id}"][data-study-index="0"]`).value === device.roomId, 'The accessible room selector provides the same placement edit and invalidation');
    const updatedSelect = element(`[data-study-device-room="${device.id}"][data-study-index="0"]`);
    assert(updatedSelect.closest('details').open && document.activeElement === updatedSelect, 'Room selection keeps its details open and preserves keyboard focus after rendering');
    click('#cs-run');
    await until(() => !element('#cs-export-json').disabled, 'Comparison after room selector edit did not finish');

    const studyResultMarkup = element('#cs-result-content').innerHTML;
    click('[data-workspace="lab"]');
    assert(element('#cl-chart').innerHTML === labChart && element('#cl-environment').textContent === labEnvironment && !element('#cl-export').disabled, 'Returning to Cooling Lab preserves its independent capture and result');
    assert(element('[data-lab-model-slot]').contains(model) && model.querySelector('canvas') === canvas, 'Cooling Lab still reuses the original canonical model');
    click('[data-workspace="study"]');
    assert(element('#cs-result-content').innerHTML === studyResultMarkup && !element('#cs-export-json').disabled && element('#cs-wind-speed').value === '2.5', 'Returning to Study preserves its inputs and completed results');
    assert(element('#elapsed-time').textContent === heldClock, 'Flat time stays halted across Study and Cooling Lab transitions');
    click('[data-workspace="flat"]');
    assert(element('#flat-workspace').contains(model) && model.querySelector('canvas') === canvas && element('[data-mode="pressure"]').getAttribute('aria-pressed') === 'true', 'Back to Flat restores the same model and prior pressure overlay');
    await wait(350);
    assert(element('#elapsed-time').textContent !== heldClock && JSON.stringify(app.readConditions()) === flatConditions, 'Flat playback resumes with its original controls');
    click('[data-workspace="study"]');
    if (errors.length) throw new Error(`Uncaught browser errors: ${errors.join(' | ')}`);
    assert(true, 'No uncaught browser errors during Contractor Study interactions');
    return { checks, workerMs: Math.round(result.runtimeMs), heartbeatTicks: ticks, maxHeartbeatGapMs: Math.round(maxGap), sampleCounts: result.cases.map(item => item.samples.length), webglAvailable: Boolean(canvas), viewport: { width: innerWidth, height: innerHeight } };
  } finally {
    clearInterval(heartbeatTimer); window.Worker = originalWorker; window.fetch = originalFetch; HTMLAnchorElement.prototype.click = originalAnchorClick;
    window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onError);
  }
})().then(
  result => { window.heatSimContractorCheck = { status: 'passed', ...result }; },
  error => { window.heatSimContractorCheck = { status: 'failed', error: error.message }; },
);
