// Run on a fresh Vite page; read window.heatSimStandingFansCheck.
window.heatSimStandingFansCheck = { status: 'running' };
(async () => {
  const checks = [];
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const node = selector => document.querySelector(selector);
  const click = selector => node(selector).click();
  const change = (selector, value) => {
    node(selector).value = String(value);
    node(selector).dispatchEvent(new Event('change', { bubbles: true }));
  };
  try {
    const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1).name;
    const app = await import(appUrl);
    if (node('#play-status').textContent.includes('running')) click('[data-action="play"]');
    click('[data-tab="devices"]');
    const pausedTime = node('#elapsed-time').textContent;
    click('#standing-fan-add');
    let fan = app.readConditions().standingFans[0];
    assert(fan?.on && node('#standing-fan-select').value === fan.id, 'Adding a fan selects it and switches it on');
    assert(node('#power').textContent === '50W' && node('#elapsed-time').textContent === pausedTime, 'Paused edits refresh device power without advancing time');
    assert(document.activeElement === node('#standing-fan-select'), 'Add keeps keyboard focus in the fan editor');
    change('#standing-fan-heading', 270);
    change('#standing-fan-speed', 3);
    assert(app.readConditions().standingFans[0].angleDeg === 270 && app.readConditions().standingFans[0].speed === 3, 'Selected fan direction and speed update independently');
    const beforeInvalid = JSON.stringify(app.readConditions());
    change('#standing-fan-heading', '');
    assert(JSON.stringify(app.readConditions()) === beforeInvalid, 'Empty heading is rejected without changing the setup');
    node('#standing-fan-x').value = '-10';
    node('#standing-fan-z').value = '-10';
    click('#standing-fan-place');
    assert(JSON.stringify(app.readConditions()) === beforeInvalid, 'Outside placement retains the last valid setup');
    change('#standing-fan-room', 'bedroom2');
    assert(node('#standing-fan-room').value === 'bedroom2' && app.readConditions().standingFans[0].x !== fan.x, 'Room selector finds clear floor space');
    const fans = JSON.stringify(app.readConditions().standingFans);
    change('#day-select', 'haze_outside');
    assert(JSON.stringify(app.readConditions().standingFans) === fans, 'Changing the day preserves added fans');
    click('nav [data-workspace="lab"]');
    click('nav [data-workspace="study"]');
    click('nav [data-workspace="flat"]');
    assert(JSON.stringify(app.readConditions().standingFans) === fans, 'Workspace round trip preserves added fans');
    for (let index = 0; index < 6; index++) click('#standing-fan-add');
    assert(app.readConditions().standingFans.length === 7 && node('#standing-fan-add').disabled, 'Eight-fan limit disables Add');
    click('#standing-fan-remove');
    assert(app.readConditions().standingFans.length === 6 && !node('#standing-fan-add').disabled, 'Removing an extra fan re-enables Add');
    assert(node('#standing-fan-select').value === 'primary' && node('#standing-fan-remove').disabled, 'Main fan stays available and cannot be removed');
    assert(!node('#scene-loading') && Boolean(node('#scene canvas')), '3D scene remains mounted after editing and workspace changes');
    window.heatSimStandingFansCheck = { status: 'passed', checks };
  } catch (error) {
    window.heatSimStandingFansCheck = { status: 'failed', checks, error: String(error), stack: error.stack };
  }
})();
