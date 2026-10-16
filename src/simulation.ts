import { defaultConditions, deviceRoom, model, type Conditions, type ModelBox, type RoomReading, type SimulationResult } from './domain';
import { PURIFIER_SLOTS } from './config/slots';
import { resolveStandingFans } from './standing-fans';
import { windToPlanDirection } from './weather-orientation';

export const SIMULATION_NOTE = 'HeatSim is a qualitative toy CFD demonstration. This emergency room-model mode uses well-mixed rooms, not CFD, and is not calibrated. Outdoor conditions come from presets, manual input or an explicitly loaded regional forecast; no sensors are used. This emergency model uses wind speed only, without directional pressure. Fans move air without refrigerating it. Comfort and energy are illustrative estimates.';

export interface ScenarioMetadata {
  id: string; name: string; description: string;
  outdoorTemperature: number; outdoorPm25: number; initialTemperature: number; initialPm25: number;
  sunFacades: ('N' | 'S' | 'E' | 'W')[]; windward: 'N' | 'S'; windwardDensity: number;
  people: boolean; validationHeatWatts: number;
}

export const SCENARIOS: ScenarioMetadata[] = [
  { id: 'baseline', name: 'Normal day', description: 'A normal day: explore ventilation with no sun or people heat sources.',
    outdoorTemperature: 30, outdoorPm25: 20, initialTemperature: 30, initialPm25: 15,
    sunFacades: [], windward: 'S', windwardDensity: 1.002, people: false, validationHeatWatts: 0 },
  { id: 'hot_afternoon', name: 'Hot afternoon (west sun)', description: 'West-facing rooms heat up. Compare a fan with air conditioning.',
    outdoorTemperature: 34, outdoorPm25: 25, initialTemperature: 31, initialPm25: 20,
    sunFacades: ['W'], windward: 'S', windwardDensity: 1.003, people: true, validationHeatWatts: 0 },
  { id: 'haze_outside', name: 'Haze outside', description: 'PM2.5 is 200 outdoors. Should Mdm Tan open the window?',
    outdoorTemperature: 31, outdoorPm25: 200, initialTemperature: 30, initialPm25: 40,
    sunFacades: [], windward: 'S', windwardDensity: 1.003, people: true, validationHeatWatts: 0 },
  { id: 'hot_haze', name: 'Hot + hazy', description: 'A hot, hazy afternoon: balance cooler rooms, cleaner air and device power.',
    outdoorTemperature: 34, outdoorPm25: 150, initialTemperature: 31, initialPm25: 40,
    sunFacades: ['W'], windward: 'S', windwardDensity: 1.003, people: true, validationHeatWatts: 0 },
  { id: 'night_cool', name: 'Evening cool-down', description: 'Outdoor air has cooled to 27 °C. Openings can release the heat indoors.',
    outdoorTemperature: 27, outdoorPm25: 20, initialTemperature: 31, initialPm25: 15,
    sunFacades: [], windward: 'N', windwardDensity: 1.002, people: true, validationHeatWatts: 0 },
  { id: 'validation', name: 'Validation case', description: 'Compare bedroom 3 window and main-door combinations with a 100 W heat source in bedroom 3.',
    outdoorTemperature: 33, outdoorPm25: 100, initialTemperature: 28, initialPm25: 0,
    sunFacades: [], windward: 'N', windwardDensity: 1.003, people: false, validationHeatWatts: 100 },
];

export const PRESETS = SCENARIOS.map(scenario => ({
  id: scenario.id, name: scenario.name, description: scenario.description,
  conditions: {
    ...defaultConditions(), scenarioId: scenario.id,
    outdoorTemperature: scenario.outdoorTemperature, outdoorPm25: scenario.outdoorPm25,
    timeOfDay: scenario.id === 'night_cool' ? 20 : 14,
    windSpeed: scenario.windwardDensity === 1.002 ? 1.2 : 1.8,
    doors: Object.fromEntries(model.boxes.filter(box => box.type === 'door').map(box => [box.name, scenario.id === 'validation' && box.name !== 'main_door'])),
  } satisfies Conditions,
}));

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const volumes = model.rooms.map(room => room.area_m2 * model.ceiling_height);
// Eight air volumes approximate the thermal inertia of furnishings and room surfaces.
const capacities = volumes.map(volume => volume * 1_200 * 8);
const totalVolume = volumes.reduce((sum, volume) => sum + volume, 0);
const openings = model.boxes.filter(box => box.type === 'door' || box.type === 'window');
const barriers = model.boxes.filter(box => ['wall', 'door', 'window'].includes(box.type) && box.min[1] <= 1 && box.max[1] >= 1);

function openingRooms(box: ModelBox): number[] {
  const center = box.min.map((value, axis) => (value + box.max[axis]) / 2);
  const normal = box.wall_axis === 'x' ? 2 : 0;
  return [-0.15, 0.15].map(offset => model.rooms.findIndex(room => {
    const x = center[0] + (normal === 0 ? offset : 0);
    const z = center[2] + (normal === 2 ? offset : 0);
    return x > room.min[0] && x < room.max[0] && z > room.min[2] && z < room.max[2];
  })).filter(index => index >= 0);
}

const apertures = openings.map(box => ({
  name: box.name, type: box.type, exterior: box.exterior === true, rooms: openingRooms(box),
  area: (box.max[box.wall_axis === 'x' ? 0 : 2] - box.min[box.wall_axis === 'x' ? 0 : 2]) * (box.max[1] - box.min[1]),
}));

interface Connection { a: number; b: number; passageArea: number; wallConductance: number }
const connections: Connection[] = [];
for (let a = 0; a < model.rooms.length; a++) {
  for (let b = a + 1; b < model.rooms.length; b++) {
    const first = model.rooms[a], second = model.rooms[b];
    for (const normal of [0, 2]) {
      const tangent = normal === 0 ? 2 : 0;
      const boundary = Math.abs(first.max[normal] - second.min[normal]) < 0.001 ? first.max[normal]
        : Math.abs(second.max[normal] - first.min[normal]) < 0.001 ? first.min[normal] : null;
      const start = Math.max(first.min[tangent], second.min[tangent]);
      const end = Math.min(first.max[tangent], second.max[tangent]);
      if (boundary === null || end <= start) continue;
      const spans = barriers.filter(box => box.min[normal] <= boundary && box.max[normal] >= boundary)
        .map(box => [Math.max(start, box.min[tangent]), Math.min(end, box.max[tangent])])
        .filter(([from, to]) => to > from).sort((left, right) => left[0] - right[0]);
      let covered = 0, cursor = start;
      for (const [from, to] of spans) {
        covered += Math.max(0, to - Math.max(cursor, from));
        cursor = Math.max(cursor, to);
      }
      connections.push({ a, b, passageArea: Math.max(0, end - start - covered) * model.ceiling_height, wallConductance: covered * model.ceiling_height * 1.4 });
    }
  }
}

const planMin = [0, 2].map(axis => Math.min(...model.rooms.map(room => room.min[axis])));
const planMax = [0, 2].map(axis => Math.max(...model.rooms.map(room => room.max[axis])));
const exteriorAreas = model.rooms.map(room => [0, 2].reduce((area, normal, index) => {
  const tangent = normal === 0 ? 2 : 0;
  const sides = Number(Math.abs(room.min[normal] - planMin[index]) < 0.001) + Number(Math.abs(room.max[normal] - planMax[index]) < 0.001);
  return area + sides * (room.max[tangent] - room.min[tangent]) * model.ceiling_height;
}, 0));
const glazingAreas = model.rooms.map((_, index) => apertures.filter(aperture => aperture.type === 'window' && aperture.rooms.includes(index)).reduce((sum, aperture) => sum + aperture.area, 0));

function climate(conditions: Conditions) {
  return {
    temperature: clamp(finite(conditions.outdoorTemperature, 32), -10, 55),
    pm25: clamp(finite(conditions.outdoorPm25, 18), 0, 1_000),
    humidity: clamp(finite(conditions.humidity, 70), 0, 100),
    wind: clamp(finite(conditions.windSpeed, 1.8), 0, 10),
    hour: ((finite(conditions.timeOfDay, 14) % 24) + 24) % 24,
    setpoint: clamp(finite(conditions.acSetpoint, 25), 16, 32),
  };
}

function equipment(conditions: Conditions) {
  const standingFans = resolveStandingFans(conditions).filter(fan => fan.on && fan.speed > 0);
  return model.rooms.map(room => {
    const enabled = Object.entries(deviceRoom).filter(([name, target]) => target === room.name && conditions.devices[name] === true).map(([name]) => name);
    const fansHere = standingFans.filter(fan => fan.room === room.name);
    const purifierHere = conditions.purifier?.on === true && PURIFIER_SLOTS[conditions.purifier.slot]?.room === room.name;
    const ceilingFan = enabled.some(name => name.startsWith('fan_'));
    return {
      fanSpeed: (ceilingFan ? 1 : 0) + fansHere.reduce((sum, fan) => sum + fan.speed / 2, 0),
      fanCount: Number(ceilingFan) + fansHere.length,
      ac: enabled.some(name => name.startsWith('ac_')),
      purifierCleaningCount: Number(enabled.some(name => name.startsWith('purifier_'))) + Number(purifierHere) * (conditions.purifier?.demoBoost === true ? 10 : 1),
      purifierCount: Number(enabled.some(name => name.startsWith('purifier_'))) + Number(purifierHere),
      coolingWatts: room.name === 'living' ? 3_500 : 2_500,
    };
  });
}

function exchanges(conditions: Conditions, wind: number) {
  const outside = volumes.map(volume => volume * 0.12 / 3_600);
  const links = connections.map(connection => ({ ...connection, flow: connection.passageArea * 0.055 }));
  for (const aperture of apertures) {
    const open = (aperture.type === 'door' ? conditions.doors : conditions.windows)[aperture.name] === true;
    if (aperture.exterior && aperture.rooms.length === 1) {
      if (open) outside[aperture.rooms[0]] += aperture.area * (0.012 + wind * 0.025);
    } else if (aperture.rooms.length === 2) {
      const [a, b] = aperture.rooms;
      const link = links.find(candidate => (candidate.a === a && candidate.b === b) || (candidate.a === b && candidate.b === a));
      if (link) link.flow += aperture.area * (open ? 0.045 + wind * 0.006 : 0.0008);
    }
  }
  return { outside, links };
}

function readings(temperatures: number[], particles: number[], conditions: Conditions): RoomReading[] {
  const environment = climate(conditions), devices = equipment(conditions);
  const { outside, links } = exchanges(conditions, environment.wind);
  let breeze = outside.map((flow, index) => Math.min(1.8, flow * 3 / Math.sqrt(model.rooms[index].area_m2)));
  for (let pass = 0; pass < 4; pass++) {
    const next = [...breeze];
    for (const { a, b, flow } of links) {
      const transmission = flow / (flow + 0.08) * 0.75;
      next[a] = Math.max(next[a], breeze[b] * transmission);
      next[b] = Math.max(next[b], breeze[a] * transmission);
    }
    breeze = next;
  }
  return model.rooms.map((room, index) => {
    const airflow = 0.04 + breeze[index] + devices[index].fanSpeed * 0.85 + (devices[index].ac ? 0.16 : 0);
    const humidityEffect = Math.max(0, temperatures[index] - 24) * Math.max(0, environment.humidity - 40) / 100;
    return { room: room.name, temperature: temperatures[index], pm25: particles[index], airflow,
      feelsLike: temperatures[index] + humidityEffect - Math.min(3, airflow * 2.4) };
  });
}

function loads(temperatures: number[], conditions: Conditions) {
  const { setpoint } = climate(conditions);
  const devices = equipment(conditions);
  const cooling = devices.map((device, index) => device.ac ? device.coolingWatts * clamp((temperatures[index] - setpoint) / 1.5, 0, 1) : 0);
  const heat = devices.map(device => device.fanCount * 50 + device.purifierCount * 40 + (device.ac ? 25 : 0));
  return { cooling, heat, power: cooling.reduce((sum, watts, index) => sum + watts / devices[index].coolingWatts * 975, 0) + heat.reduce((sum, watts) => sum + watts, 0) };
}

function result(temperatures: number[], particles: number[], conditions: Conditions, elapsedSeconds: number, energyKwh: number): SimulationResult {
  const rooms = readings(temperatures, particles, conditions);
  const average = (key: 'temperature' | 'feelsLike' | 'pm25') => rooms.reduce((sum, room, index) => sum + room[key] * volumes[index], 0) / totalVolume;
  return { rooms, elapsedSeconds, energyKwh, powerWatts: loads(temperatures, conditions).power,
    averageTemperature: average('temperature'), averageFeelsLike: average('feelsLike'), averagePm25: average('pm25') };
}

export function createSimulation(conditions: Conditions): SimulationResult {
  const environment = climate(conditions);
  const scenario = SCENARIOS.find(candidate => candidate.id === conditions.scenarioId);
  return result(model.rooms.map(() => scenario?.initialTemperature ?? environment.temperature - 1.5), model.rooms.map(() => scenario?.initialPm25 ?? environment.pm25), conditions, 0, 0);
}

export function stepSimulation(previous: SimulationResult, conditions: Conditions, deltaSeconds: number): SimulationResult {
  const environment = climate(conditions), devices = equipment(conditions);
  const { outside, links } = exchanges(conditions, environment.wind);
  const scenario = SCENARIOS.find(candidate => candidate.id === conditions.scenarioId);
  const temperatures = model.rooms.map(room => clamp(finite(previous.rooms.find(reading => reading.room === room.name)?.temperature ?? NaN, environment.temperature - 1.5), -20, 65));
  const particles = model.rooms.map(room => clamp(finite(previous.rooms.find(reading => reading.room === room.name)?.pm25 ?? NaN, environment.pm25), 0, 1_000));
  // shortcut: each call advances at most one hour, split longer offline runs before calling.
  const duration = clamp(finite(deltaSeconds, 0), 0, 3_600);
  const count = Math.ceil(duration / 5), dt = count === 0 ? 0 : duration / count;
  const sunshine = Math.max(0, Math.sin((environment.hour - 6) / 12 * Math.PI));
  const solarGain = model.rooms.map((room, index) => {
    if (!scenario) return sunshine * (glazingAreas[index] * 110 + exteriorAreas[index] * 5);
    // shortcut: sunny façades heat their adjoining room uniformly; use the grid engine for spatial gradients.
    return scenario.sunFacades.reduce((watts, geographicFacade) => {
      const facade = windToPlanDirection(geographicFacade, conditions.houseOrientationDeg);
      const normal = facade === 'N' || facade === 'S' ? 2 : 0;
      const edge = facade === 'N' || facade === 'W' ? room.min[normal] : room.max[normal];
      const boundary = facade === 'N' || facade === 'W' ? 0 : normal === 0 ? 12 : 7.5;
      return watts + (Math.abs(edge - boundary) < 0.001 ? sunshine * (glazingAreas[index] * 110 + exteriorAreas[index] * 5) : 0);
    }, 0);
  });
  let energyKwh = Math.max(0, finite(previous.energyKwh, 0));
  for (let step = 0; step < count; step++) {
    const { cooling, heat, power } = loads(temperatures, conditions);
    const heatChange = temperatures.map((temperature, index) =>
      (exteriorAreas[index] * 1.8 + outside[index] * 1_200) * (environment.temperature - temperature)
      + solarGain[index] + (scenario?.people === false ? 0 : model.rooms[index].area_m2 * 3)
      + (model.rooms[index].name === 'bedroom3' ? scenario?.validationHeatWatts ?? 0 : 0) + heat[index] - cooling[index]);
    const particleChange = particles.map((pm25, index) => outside[index] * (environment.pm25 - pm25)
      - (volumes[index] * 0.1 / 3_600 + devices[index].purifierCleaningCount * 250 / 3_600) * pm25);
    for (const { a, b, flow, wallConductance } of links) {
      const transferHeat = (flow * 1_200 + wallConductance) * (temperatures[b] - temperatures[a]);
      const transferParticles = flow * (particles[b] - particles[a]);
      heatChange[a] += transferHeat;
      heatChange[b] -= transferHeat;
      particleChange[a] += transferParticles;
      particleChange[b] -= transferParticles;
    }
    for (let index = 0; index < temperatures.length; index++) {
      temperatures[index] = clamp(temperatures[index] + heatChange[index] / capacities[index] * dt, -20, 65);
      particles[index] = clamp(particles[index] + particleChange[index] / volumes[index] * dt, 0, 1_000);
    }
    energyKwh += power * dt / 3_600_000;
  }
  return result(temperatures, particles, conditions, Math.max(0, finite(previous.elapsedSeconds, 0)) + duration, energyKwh);
}
