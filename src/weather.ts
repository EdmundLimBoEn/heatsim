import type { CardinalDirection } from './weather-orientation';

export const SINGAPORE_AREAS = [
  { name: 'Jurong West', latitude: 1.35, longitude: 103.72 },
  { name: 'Woodlands', latitude: 1.437, longitude: 103.786 },
  { name: 'Bishan', latitude: 1.351, longitude: 103.849 },
  { name: 'Tampines', latitude: 1.354, longitude: 103.945 },
  { name: 'Punggol', latitude: 1.405, longitude: 103.902 },
  { name: 'Queenstown', latitude: 1.295, longitude: 103.806 },
] as const;
export interface WeatherSample {
  outdoorTemperature: number; humidity: number; windSpeed: number; windFrom: CardinalDirection; timeOfDay: number;
  provenance: { source: 'Open-Meteo'; area: string; latitude: number; longitude: number; forecastTime: string; loadedAt: string; windDegrees: number };
}
type Area = typeof SINGAPORE_AREAS[number];
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Weather response is incomplete.');
  return value as Record<string, unknown>;
}
export function parseWeatherResponse(value: unknown, area: Area, now = Date.now()): WeatherSample {
  const data = record(value), current = record(data.current), units = record(data.current_units);
  for (const [field, unit] of Object.entries({ time: 'unixtime', temperature_2m: '°C', relative_humidity_2m: '%', wind_speed_10m: 'm/s', wind_direction_10m: '°' })) {
    if (units[field] !== unit) throw new Error('Weather units do not match the simulator.');
  }
  const number = (key: string, min: number, max: number): number => {
    const value = current[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Weather values are outside the simulator’s supported range. Keep using manual conditions.');
    return value;
  };
  const timestamp = number('time', 0, 10_000_000_000) * 1000;
  if (Math.abs(now - timestamp) > 3 * 60 * 60 * 1000) throw new Error('Weather timestamp is stale or in the future. Keep using manual conditions.');
  const windDegrees = number('wind_direction_10m', 0, 360);
  const singaporeTime = new Date(timestamp + 8 * 60 * 60 * 1000);
  return {
    outdoorTemperature: number('temperature_2m', 10, 60), humidity: number('relative_humidity_2m', 0, 100),
    windSpeed: number('wind_speed_10m', 0, 10), windFrom: (['N', 'E', 'S', 'W'] as const)[Math.round(windDegrees / 90) % 4],
    timeOfDay: singaporeTime.getUTCHours() + singaporeTime.getUTCMinutes() / 60,
    provenance: { source: 'Open-Meteo', area: area.name, latitude: area.latitude, longitude: area.longitude,
      forecastTime: new Date(timestamp).toISOString(), loadedAt: new Date(now).toISOString(), windDegrees },
  };
}
export async function loadWeather(area: Area, signal: AbortSignal): Promise<WeatherSample> {
  const query = new URLSearchParams({ latitude: String(area.latitude), longitude: String(area.longitude),
    current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m', wind_speed_unit: 'ms', temperature_unit: 'celsius', timeformat: 'unixtime', timezone: 'GMT' });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { signal });
  if (!response.ok) throw new Error(`Weather service unavailable (${response.status}). Keep using manual conditions.`);
  return parseWeatherResponse(await response.json(), area);
}
