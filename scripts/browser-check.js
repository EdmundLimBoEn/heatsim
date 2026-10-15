// Run with gstack browse eval scripts/browser-check.js against the Vite dev server.
return await (async () => {
  const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1)?.name;
  if (!appUrl) throw new Error('Run against the Vite development server');
  const app = await import(appUrl);
  const checks = [];
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const click = selector => { const element = document.querySelector(selector); if (!element) throw new Error(`Missing ${selector}`); element.click(); };
  const key = (value, code = '', shiftKey = false) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: value, code, shiftKey, bubbles: true }));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  if (document.querySelector('#play-status').textContent.includes('running')) click('[data-action="play"]');
  const saved = app.readConditions();
  app.loadScenario('haze_outside');
  assert(app.readConditions().outdoorPm25 === 200, 'Standalone scenario loads');
  const beforeWindow = app.readConditions().windows.window_bedroom3_1;
  key('1', 'Digit1');
  assert(app.readConditions().windows.window_bedroom3_1 !== beforeWindow, 'Keyboard toggles window without USB');
  const beforeFan = app.readConditions().portableFan.on;
  key('f', 'KeyF');
  assert(app.readConditions().portableFan.on !== beforeFan, 'Keyboard toggles portable fan');
  key('f', 'KeyF');
  key('1', 'Digit1');
  const conditionBeforeHelp = JSON.stringify(app.readConditions());
  key('h', 'KeyH'); key('1', 'Digit1');
  assert(document.querySelector('#help-dialog').open && JSON.stringify(app.readConditions()) === conditionBeforeHelp, 'Dialog protects model from shortcuts');
  document.querySelector('#help-dialog').close();
  click('[data-mode="airflow"]');
  assert(document.querySelector('[data-mode="airflow"]').getAttribute('aria-pressed') === 'true', 'Airflow view selectable');
  let download;
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { download = { url: this.href, name: this.download }; };
  try { click('[data-action="export"]'); } finally { HTMLAnchorElement.prototype.click = originalClick; }
  const csv = await (await fetch(download.url)).text();
  assert(download.name.endsWith('.csv') && csv.includes('Portable fan angle degrees') && csv.includes('Bedroom 3') && csv.includes('window_bedroom3_1'), 'CSV contains settings and all-room readings');
  const started = performance.now();
  click('#run-optimiser');
  while (!document.querySelector('#apply-optimiser') && performance.now() - started < 30000) {
    if (document.querySelector('#optimiser-result [role="alert"]')) throw new Error(document.querySelector('#optimiser-result').textContent);
    await wait(100);
  }
  assert(Boolean(document.querySelector('#apply-optimiser')), 'Browser worker returns a layout within 30 seconds');
  const scores = [...document.querySelectorAll('.optimiser-score strong')].map(node => Number(node.textContent));
  assert(scores.length === 2 && scores[1] <= scores[0], 'Suggested score is no worse than baseline');
  click('#apply-optimiser');
  assert(document.querySelector('#apply-optimiser').disabled && document.querySelector('#optimiser-result').textContent.includes('Applied to your model'), 'Apply updates model and preserves comparison');
  const duration = performance.now() - started;
  app.replaceConditions(saved, true);
  return { checks, optimiserMs: Math.round(duration), scores };
})()
