export const US_PM25_AQI_EQUIVALENT_LABEL = 'US EPA PM2.5 index equivalent (24-hour scale)';
export const US_PM25_AQI_EQUIVALENT_NOTE = 'Scenario equivalent using the US EPA 24-hour PM2.5 scale. Not Singapore PSI, live AQI, or a health forecast.';
export const US_PM25_AQI_SOURCE = 'https://document.airnow.gov/technical-assistance-document-for-the-reporting-of-daily-air-quailty.pdf';

// EPA May 2026 Table 6. This is one pollutant's scale, not the overall AQI.
const bands = [
  [0, 9, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
] as const;

/** Apply the 24-hour PM2.5 scale to a scenario concentration; no time averaging is inferred. */
export function pm25ToUsAqiEquivalent(pm25: number): number | null {
  if (!Number.isFinite(pm25) || pm25 < 0) return null;
  const scaled = pm25 * 10;
  // Correct only floating-point representation noise before EPA's one-decimal truncation.
  const concentration = Math.floor(scaled + Number.EPSILON * Math.max(1, scaled) * 2) / 10;
  const band = bands.find(([low, high]) => concentration >= low && concentration <= high);
  if (!band) return null;
  const [low, high, indexLow, indexHigh] = band;
  return Math.round(indexLow + (concentration - low) * (indexHigh - indexLow) / (high - low));
}

/** Choose a representative concentration; rounded AQI values do not have a unique inverse. */
export function usAqiEquivalentToPm25(index: number): number | null {
  if (!Number.isInteger(index) || index < 0 || index > 500) return null;
  const band = bands.find(([, , low, high]) => index >= low && index <= high);
  if (!band) return null;
  const [low, high, indexLow, indexHigh] = band;
  return Number((low + (index - indexLow) * (high - low) / (indexHigh - indexLow)).toFixed(1));
}
