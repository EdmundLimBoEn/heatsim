// Run on a fresh Vite page; read window.heatSimLaunchCheck. Hardware is mocked.
window.heatSimLaunchCheck = { status: 'running', checks: [], observations: {} };
(async () => {
  const { checks, observations } = window.heatSimLaunchCheck;
  const element = selector => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (condition, label) => {
    const start = performance.now();
    while (!condition()) { if (performance.now() - start > 5000) throw new Error(label); await wait(25); }
  };
  const reveal = node => {
    for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
    return node;
  };
  const click = selector => reveal(element(selector)).click();
  const key = (node, value) => node.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
  const appUrl = performance.getEntriesByType('resource').filter(entry => /\/src\/app\.ts(?:\?|$)/.test(entry.name)).at(-1)?.name;
  const app = await import(appUrl), saved = app.readConditions();
  const wasPlaying = element('#play-status').textContent.includes('running');
  const setPlaying = value => { if (element('#play-status').textContent.includes('running') !== value) click('[data-action="play"]'); };
  const originalWorker = window.Worker;
  try {
    setPlaying(false);
    for (const [action, id] of [['guide', 'guide'], ['about', 'about'], ['help', 'help'], ['build', 'build'], ['readings', 'readings']]) {
      click(`#more-menu [data-action="${action}"]`);
      const dialog = element(`#${id}-dialog`), before = JSON.stringify(app.readConditions());
      assert(dialog.open && !element('#more-menu').open && dialog.contains(document.activeElement) && Boolean(document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent), `${id} dialog opens with an accessible title and focus inside`);
      key(document.activeElement, '1');
      assert(JSON.stringify(app.readConditions()) === before, `${id} dialog suppresses flat keyboard shortcuts`);
      click(`#${id}-dialog [data-close]`); await wait(60);
      assert(!dialog.open && document.activeElement === element('#more-menu > summary'), `${id} dialog close restores focus to visible More`);
    }
    const headerLauncher = element('.header-actions > [data-action="about"]');
    headerLauncher.click(); click('#about-dialog [data-close]'); await wait(60);
    assert(document.activeElement === headerLauncher, 'Header dialog close restores its own visible launcher');

    const current = JSON.stringify(app.readConditions());
    element('#day-select').focus(); key(element('#day-select'), '1'); key(element('#day-select'), 'f');
    assert(JSON.stringify(app.readConditions()) === current, 'Day selector typing cannot toggle an opening or fan');
    const fallback = document.querySelector('#flat-plan-fallback');
    observations.webglAvailable = !fallback;
    if (fallback) {
      assert(element('#scene-loading').textContent.includes('3D graphics are unavailable') && [...document.querySelectorAll('[data-camera]')].every(button => button.disabled) && element('.view-disclosure').hidden, 'Unavailable WebGL shows an honest usable plan and disables only 3D camera controls');
      const room = element('[data-fallback-room="bedroom3"]'); room.focus(); key(room, 'Enter');
      assert(element('#room-select').value === 'bedroom3' && room.getAttribute('aria-pressed') === 'true' && !element('#play-status').textContent.includes('running'), 'Fallback room selection works by Enter without starting playback');
      const other = element('[data-fallback-room="living"]'); other.focus(); key(other, ' ');
      assert(element('#room-select').value === 'living' && !element('#play-status').textContent.includes('running'), 'Fallback room selection works by Space without toggling playback');
      const flowing = app.readConditions();
      for (const id of Object.keys(flowing.windows)) flowing.windows[id] = true;
      for (const id of Object.keys(flowing.doors)) flowing.doors[id] = true;
      flowing.windSpeed = 2; flowing.windFrom = 'N'; app.replaceConditions(flowing, true);
      setPlaying(true); await wait(400); setPlaying(false); await wait(100);
      const science = reveal(element('#science-views')); science.checked = true; science.dispatchEvent(new Event('change', { bubbles: true }));
      element('#more-menu').open = false;
      observations.arrowCounts = {};
      for (const mode of ['model', 'temperature', 'airflow', 'pressure', 'pm25']) {
        click(`[data-mode="${mode}"]`);
        const flow = element('#fallback-flow'), count = flow.querySelectorAll('line').length;
        observations.arrowCounts[mode] = count;
        assert(count > 0 && getComputedStyle(flow).display !== 'none' && element(`[data-mode="${mode}"]`).getAttribute('aria-pressed') === 'true', `${mode} keeps solved fallback airflow arrows visible`);
      }
      const still = app.readConditions();
      for (const id of Object.keys(still.windows)) still.windows[id] = false;
      for (const id of Object.keys(still.doors)) still.doors[id] = false;
      for (const id of Object.keys(still.devices)) still.devices[id] = false;
      still.windSpeed = 0; still.portableFan.on = false; app.replaceConditions(still, true);
      assert(element('#fallback-flow').querySelectorAll('line').length === 0, 'A sealed zero-wind layout shows no invented airflow arrows');
    }

    window.Worker = new Proxy(originalWorker, { construct() { throw new Error('QA advice worker unavailable'); } });
    const beforeFailure = JSON.stringify(app.readConditions()); click('#run-optimiser');
    await until(() => element('#optimiser-panel').getAttribute('aria-busy') === 'false', 'Advice error left the interface busy');
    assert(element('#optimiser-result').textContent.includes('QA advice worker unavailable') && !document.querySelector('#apply-optimiser') && JSON.stringify(app.readConditions()) === beforeFailure, 'Advice worker startup failure is visible and leaves settings unchanged');
    assert(element('#run-optimiser').textContent.includes('again') && !element('#run-optimiser').disabled, 'Advice failure leaves an enabled retry control');
    window.Worker = originalWorker;

    for (const mode of ['unsupported', 'cancelled', 'denied']) {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;top:0;left:0;width:430px;height:700px;z-index:9999;background:white';
      const serial = mode === 'unsupported' ? 'undefined' : `{getPorts:async()=>[],requestPort:async()=>{throw new DOMException("QA serial ${mode}","${mode === 'cancelled' ? 'NotFoundError' : 'SecurityError'}")}}`;
      frame.srcdoc = `<html><head><base href="${location.origin}/"></head><body><div id="app"></div><script>Object.defineProperty(navigator,"serial",{configurable:true,value:${serial}});Object.defineProperty(navigator,"gpu",{configurable:true,value:undefined});</script><script type="module" src="/src/main.ts"></script></body></html>`;
      document.body.append(frame);
      try {
        await until(() => frame.contentDocument?.querySelector('#connect-hardware'), `${mode} serial fixture failed to load`);
        const doc = frame.contentDocument, button = doc.querySelector('#connect-hardware');
        if (mode === 'unsupported') await until(() => button.disabled, 'Unsupported USB did not disable connection');
        else { button.click(); await until(() => !button.disabled, 'Failed USB connection did not become retryable'); }
        const status = doc.querySelector('#hardware-status').textContent;
        assert(mode === 'unsupported' ? status.includes('All on-screen and keyboard controls remain available') : mode === 'cancelled' ? status.includes('No port selected') : status.includes('Could not open USB'), `${mode} USB has a specific recovery message`);
        const fan = doc.querySelector('[data-device-key="fanOn"]'), before = fan.checked;
        doc.body.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key: 'f', bubbles: true }));
        assert(fan.checked !== before && doc.querySelector('#simulation-engine').textContent === 'CPU · 2D', `${mode} USB and unavailable WebGPU leave standalone controls usable`);
      } finally { frame.remove(); }
    }
    return { checks, observations };
  } finally {
    window.Worker = originalWorker;
    click('nav [data-workspace="flat"]'); app.replaceConditions(saved, true); setPlaying(wasPlaying);
  }
})().then(result => { window.heatSimLaunchCheck = { status: 'passed', ...result }; }, error => { window.heatSimLaunchCheck = { ...window.heatSimLaunchCheck, status: 'failed', error: error.message }; });
