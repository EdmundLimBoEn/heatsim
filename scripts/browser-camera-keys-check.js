// Run on a fresh Vite page; read window.heatSimCameraKeysCheck.
window.heatSimCameraKeysCheck = { status: 'running' };
(async () => {
  const wait = () => new Promise(resolve => setTimeout(resolve, 1200));
  const key = (target, value) => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
  const labels = document.querySelector('[data-view="labels"]');
  labels.checked = true; labels.dispatchEvent(new Event('change', { bubbles: true }));
  const position = () => {
    const room = document.querySelector('#scene button[aria-label^="Select Living"]');
    return [parseFloat(room.style.left), parseFloat(room.style.top)];
  };
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const assert = (ok, text) => { if (!ok) throw new Error(text); };
  for (const mode of ['perspective', 'top']) {
    document.querySelector('[data-camera="' + mode + '"]').click(); await wait();
    const before = position();
    key(document.body, 'z'); await wait(); const left = position();
    assert(distance(before, left) > 1, mode + ': Z rotates the camera');
    key(document.body, 'x'); await wait();
    assert(distance(before, position()) < 1, mode + ': X reverses Z');
    const input = document.querySelector('#room-select');
    key(input, 'z'); await wait();
    assert(distance(before, position()) < 1, mode + ': form input suppresses rotation');
  }
  return { status: 'passed', checks: 6 };
})().then(result => { window.heatSimCameraKeysCheck = result; }, error => { window.heatSimCameraKeysCheck = { status: 'failed', error: String(error) }; });
