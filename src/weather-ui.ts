import { loadWeather, SINGAPORE_AREAS, type WeatherSample } from './weather';

export function mountWeatherControls(container: HTMLElement, apply: (weather: WeatherSample) => void) {
  container.innerHTML = `<label>Singapore area <select data-weather-area>${SINGAPORE_AREAS.map((area, i) => `<option value="${i}">${area.name}</option>`).join('')}</select></label><button type="button" data-load-weather>Load weather</button><p data-weather-status role="status">Optional regional forecast. Manual conditions work offline.</p><p class="muted">10 m forecast wind is rounded to N/E/S/W; it is not measured airflow at your window. Haze stays manual. <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Weather data by Open-Meteo</a> · <a data-weather-map target="_blank" rel="noopener noreferrer">View Windy map ↗</a></p>`;
  const area = container.querySelector<HTMLSelectElement>('[data-weather-area]')!;
  const button = container.querySelector<HTMLButtonElement>('[data-load-weather]')!;
  const status = container.querySelector<HTMLElement>('[data-weather-status]')!;
  const link = container.querySelector<HTMLAnchorElement>('[data-weather-map]')!;
  const events = new AbortController();
  let request: AbortController | undefined, generation = 0;
  const updateLink = () => { const selected = SINGAPORE_AREAS[Number(area.value)]; link.href = `https://www.windy.com/${selected.latitude}/${selected.longitude}`; };
  function cancelPending() {
    generation++; request?.abort(); request = undefined;
    if (button.disabled) status.textContent = 'Weather load cancelled. Current conditions kept.';
    button.disabled = false;
  }
  area.addEventListener('change', () => { cancelPending(); updateLink(); }, { signal: events.signal });
  button.addEventListener('click', async () => {
    cancelPending(); const token = generation, controller = new AbortController(); request = controller;
    button.disabled = true; status.textContent = 'Loading regional forecast…';
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const sample = await loadWeather(SINGAPORE_AREAS[Number(area.value)], controller.signal);
      if (generation !== token || events.signal.aborted) return;
      apply(sample);
      status.textContent = `${sample.provenance.area} · ${new Date(sample.provenance.forecastTime).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} SGT · ${sample.windSpeed} m/s from ${sample.provenance.windDegrees}° (rounded to ${sample.windFrom}). Loaded once; no automatic refresh.`;
    } catch (error) {
      if (generation === token && !events.signal.aborted) status.textContent = controller.signal.aborted ? 'Weather request timed out. Current conditions kept; try again or enter them manually.' : error instanceof Error ? error.message : 'Could not load weather. Current conditions kept.';
    } finally {
      window.clearTimeout(timeout);
      if (generation === token) { request = undefined; button.disabled = false; }
    }
  }, { signal: events.signal });
  updateLink();
  return { cancelPending, dispose() { cancelPending(); events.abort(); } };
}
