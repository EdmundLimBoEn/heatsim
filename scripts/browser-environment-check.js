// Run with gstack browse eval scripts/browser-environment-check.js on a freshly loaded app.
window.heatSimEnvironmentCheck = { status: 'running' };
(async () => {
  const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1)?.name;
  if (!appUrl) throw new Error('The app module is not loaded.');
  const app = await import(appUrl);
  const saved = app.readConditions(), checks = [];
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  let download;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:')) download = { url: this.href, name: this.download };
    else originalAnchorClick.call(this);
  };
  const element = selector => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const assert = (condition, label) => {
    if (!condition) throw new Error(label);
    checks.push(label);
  };
  const change = (selector, value) => {
    const input = element(selector);
    input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  try {
    element('[data-workspace="flat"]').click();
    element('[data-tab="environment"]').click();
    element('[data-action="reset-weather"]').click();
    const scenarioWeather = app.readConditions();
    assert(element('label[for="outdoor-aqi"]').textContent.includes('US EPA PM2.5 index equivalent (24-hour scale)') && element('#outdoor-aqi-note').textContent.includes('Not Singapore PSI'), 'AQI input names the pollutant, averaging scale and scenario-only limits');
    change('[data-weather-number="outdoorPm25"]', 9);
    assert(app.readConditions().outdoorPm25 === 9 && element('#outdoorPm25').value === '9' && element('#outdoor-aqi').value === '50', '9 µg/m³ remains a concentration and displays index equivalent 50');
    change('#outdoor-aqi', 100);
    assert(app.readConditions().outdoorPm25 === 35.4 && element('[data-weather-number="outdoorPm25"]').value === '35.4', 'Index equivalent 100 writes representative 35.4 µg/m³ to the simulation');
    change('#outdoor-aqi', 500);
    assert(app.readConditions().outdoorPm25 === 325.4, 'Index endpoint 500 maps to 325.4 µg/m³');
    change('[data-weather-number="outdoorPm25"]', 700);
    assert(app.readConditions().outdoorPm25 === 700 && element('#outdoor-aqi').value === '' && !element('#outdoor-aqi-range').hidden, 'Beyond-scale PM2.5 remains 700 µg/m³ with an explicit unavailable index');
    change('#outdoor-aqi', 501);
    assert(app.readConditions().outdoorPm25 === 700, 'Invalid index does not overwrite the concentration');
    change('[data-weather-number="outdoorPm25"]', '');
    assert(app.readConditions().outdoorPm25 === 700 && element('[data-weather-number="outdoorPm25"]').value === '700', 'Empty PM2.5 input restores the prior value');
    for (const [from, towards] of [['N', 'south'], ['E', 'west'], ['S', 'north'], ['W', 'east']]) {
      change('#windFrom', from);
      assert(app.readConditions().windFrom === from && element('#windFrom').selectedOptions[0].textContent.includes(`towards ${towards}`), `Wind FROM ${from} explicitly points towards ${towards}`);
    }
    change('[data-weather-number="outdoorTemperature"]', 38.2);
    change('[data-weather-number="windSpeed"]', 6.4);
    assert(app.readConditions().outdoorTemperature === 38.2 && app.readConditions().windSpeed === 6.4, 'Exact temperature and wind entries update physical units');
    element('[data-action="export"]').click();
    const csv = await (await fetch(download.url)).text();
    assert(download.name.endsWith('.csv') && csv.includes('"Outdoor PM2.5 ug/m3","700"') && csv.includes('"Wind from","W"') && csv.includes('"Wind direction source","Manual override"') && csv.includes('"US EPA PM2.5 index equivalent (24-hour scale)","Beyond supported index scale"'), 'Snapshot CSV preserves canonical PM units, index limits and wind provenance');
    const beforeInput = app.readConditions();
    element('[data-weather-number="outdoorPm25"]').focus();
    for (const [key, code] of [['f', 'KeyF'], ['1', 'Digit1'], [' ', 'Space']]) element('[data-weather-number="outdoorPm25"]').dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
    assert(JSON.stringify(app.readConditions()) === JSON.stringify(beforeInput), 'Typing in outdoor inputs does not trigger apartment controls');
    app.applyHardwareControl('window', 'window_bedroom3_1', true);
    const beforeReset = app.readConditions();
    element('[data-action="reset-weather"]').click();
    const restored = app.readConditions();
    assert(['outdoorTemperature', 'outdoorPm25', 'windSpeed', 'humidity', 'timeOfDay'].every(field => restored[field] === scenarioWeather[field]) && restored.windFrom === undefined, 'Weather reset restores scenario values and clears the wind override');
    assert(JSON.stringify(restored.windows) === JSON.stringify(beforeReset.windows) && JSON.stringify(restored.devices) === JSON.stringify(beforeReset.devices), 'Weather reset preserves hardware openings and devices');
    change('#windFrom', 'W');
    element('[data-preset="haze_outside"]').click();
    assert(app.readConditions().windFrom === undefined && element('#windFrom').value === '', 'Choosing a scenario clears the manual wind direction');
    return { checks, viewport: { width: innerWidth, height: innerHeight } };
  } finally {
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    app.replaceConditions(saved, true);
  }
})().then(
  result => { window.heatSimEnvironmentCheck = { status: 'passed', ...result }; },
  error => { window.heatSimEnvironmentCheck = { status: 'failed', error: error.message }; },
);
