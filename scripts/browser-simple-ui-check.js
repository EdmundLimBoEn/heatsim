// Run on a fresh Vite page at desktop or mobile width; read window.heatSimSimpleUiCheck.
window.heatSimSimpleUiCheck = { status: 'running' };
(async () => {
  const checks = [];
  const node = selector => {
    const result = document.querySelector(selector);
    if (!result) throw new Error(`Missing ${selector}`);
    return result;
  };
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const visible = element => element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && element.getBoundingClientRect().height > 0;
  const settle = () => new Promise(resolve => setTimeout(resolve, 80));
  const reach = async selector => {
    const element = node(selector);
    if (!visible(element)) throw new Error(`Control hidden before interaction: ${selector}`);
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await settle();
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit || !(element === hit || element.contains(hit))) throw new Error(`Control obstructed: ${selector}`);
    return element;
  };
  const click = async selector => { const element = await reach(selector); element.focus(); element.click(); await settle(); };
  const change = async (selector, value) => {
    const element = await reach(selector); element.focus(); element.value = String(value);
    element.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  };
  const key = (target, value) => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
  const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1)?.name;
  const app = await import(appUrl), saved = app.readConditions();
  const wasPlaying = node('#play-status').textContent.includes('running');
  const model = node('.model-panel'), parent = model.parentElement, canvas = model.querySelector('canvas');
  try {
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'No horizontal page overflow');
    assert(visible(node('#panel-home')) && [...document.querySelectorAll('#controls [role="tabpanel"]')].filter(visible).length === 1, 'Only Home controls are shown initially');
    assert(node('.model-panel').getBoundingClientRect().top < innerHeight, 'Apartment appears in the initial viewport');
    if (wasPlaying) await click('[data-action="play"]');
    await click('[data-quick-toggle="internal"]');
    const doors = Object.entries(app.readConditions().doors).filter(([id]) => id !== 'main_door').map(([, open]) => open);
    assert(doors.every(open => open === doors[0]), 'Visible quick action updates internal doors together');
    await click('[data-room="bedroom3"]');
    assert(visible(node('#panel-room')) && node('#room-select').value === 'bedroom3', 'Room selection reveals its individual controls');
    await click('label[for="control-window_bedroom3_1"]');
    assert(node('#control-window_bedroom3_1').checked === app.readConditions().windows.window_bedroom3_1, 'Individual opening control stays synchronized');
    await click('#tab-home');
    key(node('#tab-home'), 'ArrowRight');
    assert(document.activeElement === node('#tab-room') && visible(node('#panel-room')), 'Arrow keys select and focus the visible Room tab');
    key(node('#tab-room'), 'End');
    assert(document.activeElement === node('#tab-suggest') && visible(node('#run-optimiser')), 'End reaches the Suggest tab and visible action');
    key(node('#tab-suggest'), 'Home');
    assert(document.activeElement === node('#tab-home'), 'Home key returns to Home controls');
    await click('#tab-devices');
    await click('[data-action="fan-menu"]');
    assert(visible(node('.device-context-menu')) && node('.device-context-menu').contains(document.activeElement), 'Accessible fan menu opens with focus');
    key(document.activeElement, 'Escape'); await settle();
    assert(!visible(node('.device-context-menu')) && document.activeElement === node('[data-action="fan-menu"]'), 'Escape closes fan menu and returns focus');
    await click('#tab-home');
    await click('[data-action="weather-controls"]');
    assert(visible(node('#panel-environment')) && document.activeElement === node('#house-orientation'), 'Weather shortcut reaches a visible focused control');
    await change('#house-orientation', 90);
    assert(app.readConditions().houseOrientationDeg === 90, 'House bearing can be edited');
    await click('#manual-weather > summary');
    await change('#outdoorTemperature-number', 29);
    assert(app.readConditions().outdoorTemperature === 29, 'Manual weather remains reachable without a network');
    const beforeWorkspaces = JSON.stringify(app.readConditions());
    await click('nav [data-workspace="lab"]');
    assert(node('[data-lab-model-slot]').contains(model) && visible(model), 'Window fan test shows the same apartment model');
    window.scrollTo(0, 160);
    for (let attempt = 0; attempt < 60 && !node('.app-header').classList.contains('compact'); attempt++) await settle();
    assert(node('.app-header').classList.contains('compact') && node('.app-header').getBoundingClientRect().top === 0, 'Header stays visible and compacts after scrolling');
    window.scrollTo(0, 0);
    for (let attempt = 0; attempt < 60 && node('.app-header').classList.contains('compact'); attempt++) await settle();
    assert(!node('.app-header').classList.contains('compact'), 'Header restores at the top without shifting the page');

    await click('nav [data-workspace="study"]');
    assert(visible(node('#contractor-study-workspace')) && model.parentElement === parent, 'Floor-plan workspace opens and restores flat model parent');
    await click('nav [data-workspace="flat"]');
    assert(model.querySelector('canvas') === canvas && visible(model), 'Returning preserves the original canvas');
    assert(JSON.stringify(app.readConditions()) === beforeWorkspaces, 'Workspace navigation preserves flat controls');
    await click('#more-menu > summary');
    await click('#more-menu [data-action="help"]');
    assert(node('#help-dialog').open, 'Keyboard help is reachable through More');
    await click('#help-dialog [data-close]');
    for (let attempt = 0; attempt < 30 && document.activeElement !== node('#more-menu > summary'); attempt++) await settle();
    assert(document.activeElement === node('#more-menu > summary'), 'Closing help restores focus to More');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'No horizontal overflow after workflow');
    return { checks, viewport: [innerWidth, innerHeight], webglAvailable: Boolean(canvas) };
  } finally {
    app.replaceConditions(saved, true);
    if (node('#play-status').textContent.includes('running') !== wasPlaying) node('[data-action="play"]').click();
    node('#tab-home').click(); window.scrollTo(0, 0);
  }
})().then(result => { window.heatSimSimpleUiCheck = { status: 'passed', ...result }; }, error => { window.heatSimSimpleUiCheck = { status: 'failed', error: error.message }; });
