// Run on a fresh Vite page; read window.heatSimDemoCheck.
window.heatSimDemoCheck = { status: 'running' };
(async () => {
  const checks = [], results = {};
  const node = selector => document.querySelector(selector);
  const click = selector => node(selector).click();
  const change = (selector, value) => { node(selector).value = String(value); node(selector).dispatchEvent(new Event('change', { bubbles: true })); };
  const assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async condition => { const start = performance.now(); while (!condition()) { if (performance.now() - start > 30000) throw new Error('Timed out waiting for demo operation'); await wait(50); } };
  const originalFetch = window.fetch;
  try {
    const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1).name;
    const app = await import(appUrl);
    click('[data-action="play"]');
    click('[data-quick-toggle="internal"]');
    assert(!app.readConditions().doors.main_door && app.readConditions().doors.door_bedroom3, 'Internal-door action leaves main entrance closed');
    click('[data-quick-toggle="external"]');
    assert(app.readConditions().doors.main_door && Object.values(app.readConditions().windows).every(Boolean), 'Exterior action opens entrance and windows');
    click('[data-quick-toggle="standing"]');
    assert(app.readConditions().portableFan.on, 'Standing-fan group starts the main fan');
    click('[data-tab="devices"]'); click('[data-action="fan-menu"]');
    assert(!node('.device-context-menu').hidden && document.activeElement.dataset.deviceAction === 'power', 'Accessible fan menu opens with keyboard focus');
    click('[data-device-action="right"]');
    assert(app.readConditions().portableFan.headingDeg === 45 && node('.device-context-menu').hidden, 'Quick rotation commits and closes the menu');
    click('[data-action="fan-menu"]'); click('[data-device-action="remove"]');
    assert(app.readConditions().portableFan.removed && !app.readConditions().portableFan.on, 'Main fan can be deleted without leaving an active source');
    click('.quick-controls [data-action="add-standing-fan"]');
    assert(!app.readConditions().portableFan.removed, 'Add restores a deleted Main fan');
    click('.quick-controls [data-action="purifier-menu"]'); click('[data-device-action="right"]');
    assert(app.readConditions().purifier.headingDeg === 45, 'Purifier quick rotation is stored');
    click('[data-action="weather-controls"]'); change('#house-orientation', 90);
    assert(app.readConditions().houseOrientationDeg === 90 && node('#home-bearing').textContent.includes('east'), 'House orientation updates the visible bearing');
    const weather = { current_units: { time: 'unixtime', temperature_2m: '°C', relative_humidity_2m: '%', wind_speed_10m: 'm/s', wind_direction_10m: '°' }, current: { time: Math.floor(Date.now() / 1000), temperature_2m: 28, relative_humidity_2m: 77, wind_speed_10m: 2.4, wind_direction_10m: 95 } };
    window.fetch = async (url, options) => String(url).includes('api.open-meteo.com') ? new Response(JSON.stringify(weather), { status: 200 }) : originalFetch(url, options);
    const pm = app.readConditions().outdoorPm25;
    click('[data-load-weather]'); await until(() => !node('[data-load-weather]').disabled);
    assert(app.readConditions().outdoorTemperature === 28 && app.readConditions().windFrom === 'E' && app.readConditions().weatherProvenance.source === 'Open-Meteo', 'Weather load applies validated forecast with provenance');
    assert(app.readConditions().outdoorPm25 === pm && app.readConditions().houseOrientationDeg === 90, 'Forecast preserves haze and house orientation');
    const beforeFailure = JSON.stringify(app.readConditions());
    window.fetch = async (url, options) => String(url).includes('api.open-meteo.com') ? new Response('', { status: 503 }) : originalFetch(url, options);
    click('[data-load-weather]'); await until(() => !node('[data-load-weather]').disabled);
    assert(JSON.stringify(app.readConditions()) === beforeFailure && node('[data-weather-status]').textContent.includes('503'), 'Weather failure leaves setup intact and explains the error');
    change('#outdoorTemperature-number', 29);
    assert(!app.readConditions().weatherProvenance, 'Manual weather edit clears forecast attribution');
    window.fetch = originalFetch;
    const flat = JSON.stringify(app.readConditions());
    click('nav [data-workspace="lab"]');
    for (const demo of ['cooler', 'blocked', 'hotter']) {
      change('#cl-demo', demo); click('#cl-run');
      await until(() => !node('#cl-run').disabled && !node('#cl-takeaway').hidden);
      results[demo] = node('#cl-takeaway').textContent;
      assert(results[demo].includes(demo === 'cooler' ? 'cooler' : demo === 'blocked' ? 'No sustained flow' : 'warmer'), `${demo} comparison explains the actual thermal result`);
    }
    assert(JSON.stringify(app.readConditions()) === flat, 'Demo comparisons do not modify My flat');
    click('nav [data-workspace="flat"]');
    window.heatSimDemoCheck = { status: 'passed', checks, results };
  } catch (error) { window.heatSimDemoCheck = { status: 'failed', checks, results, error: String(error), stack: error.stack }; }
  finally { window.fetch = originalFetch; }
})();
