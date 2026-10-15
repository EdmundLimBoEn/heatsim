import { defaultConditions, deviceRoom, model, type Conditions, type ModelBox, type Room } from './domain';
import { PURIFIER_SLOTS } from './config/slots';
import { resolveStandingFans } from './standing-fans';
import { SCENARIOS } from './simulation';
import { parseContractorPlan, contractorPlanGeometryId, type ContractorPlan } from './contractor-plan';
import type { ThermalConfig, ThermalHeatBudget, ThermalSnapshot, ThermalState, ThermalModelInstance, ThermalOpeningFlow } from './thermal-types';

export const THERMAL_MODEL_ID = 'two-layer-surface-v2';
export const THERMAL_MODEL_PARAMETERS = {
  densityKgM3: 1.2, specificHeatJKgK: 1005, surfaceCapacityJPerM2K: 50_000,
  insideConvectionWPerM2K: 2.5, exteriorConvectionWPerM2K: 10, interiorConductanceWPerM2K: 1.5,
  emissivity: 0.9, stefanBoltzmann: 5.670374419e-8, peakSolarWPerM2: 600,
  glazingSolarTransmittance: 0.5, openingConductanceM3sPerPaPerM2: 0.08,
  fanShutoffPressurePa: 20, circulationFanWatts: 50, plumeUpperFraction: 0.7, gravityMps2: 9.81,
} as const;
export const THERMAL_ASSUMPTIONS = [
  'Full-size 90 m² apartment geometry; cardboard thickness and model scale are never thermal inputs.',
  'Two well-mixed air layers, each 1.3 m tall, and one lumped wall/furnishing surface temperature per room. This is a reduced-order thermal network, not resolved 3D CFD.',
  'Envelope conductance connects a massless exterior face to the lumped interior surface; it is not a rated whole-wall U-value. Surface heat capacity is an illustrative 50 kJ per m² of floor area per kelvin.',
  'Longwave radiation and absorbed solar act on the exterior face and transfer through the envelope conductance. Transmitted window sunlight heats interior surfaces. Surroundings are at outdoor air temperature.',
  'People heat is 70% upper-layer and 30% lower-layer: an explicit unresolved plume assumption. Unstable warm-below stratification increases conservative interlayer mixing.',
  'The selected window is replaced by the same high-level fan adapter in both comparisons, with a sealed surround and a passively open fan passage even when off. Other open windows and doors provide makeup air; no hidden leakage is added.',
  'The fan has an illustrative linear 20 Pa shutoff-pressure curve and rated free-air flow. Actual flow can be lower, assisted by wind, or reversed. Motor heat stays indoors.',
  'Optional shared-corridor air is a prescribed temperature/PM reservoir only at the main entrance, not a simulated corridor volume or new geometry. It is sheltered from wind, with zero gauge pressure at floor level and a temperature-consistent hydrostatic profile.',
  'Air changes count incoming boundary air once; corridor air counts as replacement air, not necessarily clean air. Positive sensible heat removal means heat leaves the flat; negative values mean ventilation adds heat. Fan electricity and heat moved are different quantities, not an AC COP.',
  'Humidity is not transported; latent loads, condensation, turbulent jets and calibrated material properties are outside this model. Expansion is never a cooling source.',
];
const P = THERMAL_MODEL_PARAMETERS;
export function createThermalModel(inputPlan?: ContractorPlan): ThermalModelInstance {
  const plan = inputPlan ? parseContractorPlan(inputPlan) : undefined;
  if (plan) for (const items of [plan.rooms, plan.openings, plan.devices]) items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const id = plan ? contractorPlanGeometryId(plan) : `${THERMAL_MODEL_ID}:canonical-hdb`;
  const modelKey = plan ? JSON.stringify(plan) : undefined;
  const rooms: Room[] = plan ? plan.rooms.map(room => ({ name: room.id, area_m2: room.widthM * room.depthM,
    min: [room.x, 0, room.z], max: [room.x + room.widthM, plan.heightM, room.z + room.depthM] })) : structuredClone(model.rooms);
  const count = rooms.length, nodeCount = count * 2;
  const height = plan?.heightM ?? model.ceiling_height, layerHeight = height / 2;
  const totalArea = rooms.reduce((sum, room) => sum + room.area_m2, 0);
  const devices = plan ? plan.devices.map(device => ({ name: device.id, kind: device.kind, room: device.roomId }))
    : Object.entries(deviceRoom).map(([name, room]) => ({ name, room, kind: name.startsWith('fan_') ? 'fan' : name.startsWith('purifier_') ? 'purifier' : 'ac' }));
  const airCp = P.densityKgM3 * P.specificHeatJKgK;
  const volumes = rooms.map(room => room.area_m2 * layerHeight);
  const airCapacities = volumes.map(volume => volume * airCp);
  const surfaceCapacities = rooms.map(room => room.area_m2 * P.surfaceCapacityJPerM2K);
  const surfaceAreas = rooms.map(room => 2 * room.area_m2 + 2 * (room.max[0] - room.min[0] + room.max[2] - room.min[2]) * height);
  const openings = model.boxes.filter(box => box.type === 'door' || box.type === 'window');
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  const bounded = (value: number, fallback: number, low: number, high: number) => clamp(Number.isFinite(value) ? value : fallback, low, high);
  const lower = (room: number) => room * 2;
  const upper = (room: number) => room * 2 + 1;

  function openingRooms(box: ModelBox): number[] {
    const x = (box.min[0] + box.max[0]) / 2, z = (box.min[2] + box.max[2]) / 2;
    const normal = box.wall_axis === 'x' ? 2 : 0;
    return [-0.15, 0.15].map(offset => rooms.findIndex(room => {
      const px = x + (normal === 0 ? offset : 0), pz = z + (normal === 2 ? offset : 0);
      return px > room.min[0] && px < room.max[0] && pz > room.min[2] && pz < room.max[2];
    })).filter(index => index >= 0);
  }
  function facade(box: ModelBox): 'N' | 'S' | 'E' | 'W' {
    return box.wall?.includes('north') ? 'N' : box.wall?.includes('south') ? 'S' : box.wall?.includes('east') ? 'E' : 'W';
  }
  const apertures = plan ? plan.openings.map(opening => {
    const room = plan.rooms.find(candidate => candidate.id === opening.roomA)!;
    const tangentX = opening.side === 'N' || opening.side === 'S';
    const x = tangentX ? room.x + opening.offsetM : room.x + (opening.side === 'E' ? room.widthM : 0);
    const z = tangentX ? room.z + (opening.side === 'S' ? room.depthM : 0) : room.z + opening.offsetM;
    const box: ModelBox = { name: opening.id, type: opening.kind === 'window' ? 'window' : 'door', exterior: opening.roomB === null,
      wall_axis: tangentX ? 'x' : 'z', min: [x, opening.sillM, z],
      max: [x + (tangentX ? opening.widthM : 0), opening.sillM + opening.heightM, z + (tangentX ? 0 : opening.widthM)] };
    return { box, rooms: [opening.roomA, opening.roomB].filter((name): name is string => name !== null).map(name => rooms.findIndex(room => room.name === name)),
      width: opening.widthM, area: opening.widthM * opening.heightM, facade: opening.side, permanent: opening.kind === 'passage' };
  }) : openings.map(box => {
    const width = box.max[box.wall_axis === 'x' ? 0 : 2] - box.min[box.wall_axis === 'x' ? 0 : 2];
    return { box, rooms: openingRooms(box), width, area: width * (box.max[1] - box.min[1]), facade: facade(box), permanent: false };
  });
  const modelOpenings = apertures.filter(aperture => aperture.box.type === 'window' && aperture.box.exterior && aperture.rooms.length === 1)
    .map(aperture => ({ name: aperture.box.name, room: rooms[aperture.rooms[0]].name, label: `${rooms[aperture.rooms[0]].name.replaceAll('_', ' ')} · ${aperture.facade} window` }));

  const exteriorAreas = rooms.map(room => ({
    N: plan || room.min[2] === 0 ? (room.max[0] - room.min[0]) * height : 0,
    S: plan || room.max[2] === 7.5 ? (room.max[0] - room.min[0]) * height : 0,
    W: plan || room.min[0] === 0 ? (room.max[2] - room.min[2]) * height : 0,
    E: plan || room.max[0] === 12 ? (room.max[2] - room.min[2]) * height : 0,
  }));
  interface Passage { a: number; b: number; area: number; wallArea: number }
  const passages: Passage[] = [];
  const barriers = model.boxes.filter(box => ['wall', 'door', 'window'].includes(box.type) && box.min[1] <= 1.2 && box.max[1] > 1.2);
  for (let a = 0; a < count; a++) for (let b = a + 1; b < count; b++) for (const normal of [0, 2]) {
    const first = rooms[a], second = rooms[b], tangent = normal === 0 ? 2 : 0;
    const boundary = Math.abs(first.max[normal] - second.min[normal]) < 1e-6 ? first.max[normal]
      : Math.abs(second.max[normal] - first.min[normal]) < 1e-6 ? first.min[normal] : NaN;
    const start = Math.max(first.min[tangent], second.min[tangent]), end = Math.min(first.max[tangent], second.max[tangent]);
    if (!Number.isFinite(boundary) || end <= start) continue;
    if (plan) {
      const aSide = normal === 0 ? (first.max[0] === boundary ? 'E' : 'W') : (first.max[2] === boundary ? 'S' : 'N');
      const bSide = aSide === 'N' ? 'S' : aSide === 'S' ? 'N' : aSide === 'E' ? 'W' : 'E';
      exteriorAreas[a][aSide] -= (end - start) * height; exteriorAreas[b][bSide] -= (end - start) * height;
      const openingArea = apertures.filter(aperture => !aperture.box.exterior && aperture.rooms.includes(a) && aperture.rooms.includes(b)).reduce((sum, aperture) => sum + aperture.area, 0);
      passages.push({ a, b, area: 0, wallArea: Math.max(0, (end - start) * height - openingArea) });
      continue;
    }
    const spans = barriers.filter(box => box.min[normal] <= boundary && box.max[normal] >= boundary)
      .map(box => [Math.max(start, box.min[tangent]), Math.min(end, box.max[tangent])]).filter(([lo, hi]) => hi > lo).sort((x, y) => x[0] - y[0]);
    let covered = 0, cursor = start;
    for (const [lo, hi] of spans) { covered += Math.max(0, hi - Math.max(cursor, lo)); cursor = Math.max(cursor, hi); }
    const doorArea = apertures.filter(aperture => !aperture.box.exterior && aperture.rooms.includes(a) && aperture.rooms.includes(b)).reduce((sum, aperture) => sum + aperture.area, 0);
    passages.push({ a, b, area: Math.max(0, end - start - covered) * height, wallArea: Math.max(0, covered * height - doorArea) });
  }
  for (const passage of passages) { surfaceAreas[passage.a] -= passage.area; surfaceAreas[passage.b] -= passage.area; }

  function createThermalConfig(base: Conditions = defaultConditions()): ThermalConfig {
    if (plan) {
      const conditions = structuredClone(base);
      conditions.doors = Object.fromEntries(plan.openings.filter(opening => opening.kind !== 'window').map(opening => [opening.id, opening.kind === 'passage' || opening.open]));
      conditions.windows = Object.fromEntries(plan.openings.filter(opening => opening.kind === 'window').map(opening => [opening.id, opening.open]));
      conditions.devices = Object.fromEntries(plan.devices.map(device => [device.id, device.on]));
      delete conditions.portableFan; delete conditions.standingFans; delete conditions.purifier;
      return { base: conditions, vent: { opening: '', on: false, mode: 'exhaust', ratedM3h: 0 },
        envelope: { uValue: 1.5, solarAbsorptance: 0.6, shadeFraction: 0 }, occupancyPeople: 4, durationSeconds: 1200 };
    }
    return { base: structuredClone(base), vent: { opening: 'window_bedroom3_1', on: false, mode: 'exhaust', ratedM3h: 120 },
      envelope: { uValue: 1.5, solarAbsorptance: 0.6, shadeFraction: 0 },
      corridor: { enabled: false, temperature: base.outdoorTemperature, pm25: base.outdoorPm25 }, durationSeconds: 1200 };
  }
  function settings(config: ThermalConfig) {
    const aperture = apertures.find(candidate => candidate.box.name === config.vent.opening && candidate.box.type === 'window' && candidate.box.exterior);
    if ((!aperture || aperture.rooms.length !== 1) && !(plan && config.vent.opening === '' && !config.vent.on && config.vent.ratedM3h === 0)) throw new RangeError('Select an exterior window for the fan adapter.');
    if (config.vent.mode !== 'exhaust' && config.vent.mode !== 'supply') throw new RangeError('Ventilation mode must be exhaust or supply.');
    const scenario = SCENARIOS.find(scenario => scenario.id === config.base.scenarioId) ?? SCENARIOS[0];
    const outdoorT = bounded(config.base.outdoorTemperature, 30, 10, 60), outdoorC = bounded(config.base.outdoorPm25, 20, 0, 1000);
    return {
      aperture, outdoorT, outdoorC,
      corridorEnabled: config.corridor?.enabled === true,
      corridorT: bounded(config.corridor?.temperature ?? outdoorT, outdoorT, 10, 60), corridorC: bounded(config.corridor?.pm25 ?? outdoorC, outdoorC, 0, 1000),
      windFrom: config.base.windFrom && ['N', 'E', 'S', 'W'].includes(config.base.windFrom) ? config.base.windFrom : scenario.windward,
      wind: bounded(config.base.windSpeed, 1.2, 0, 10), setpoint: bounded(config.base.acSetpoint, 25, 16, 32),
      hour: ((Number.isFinite(config.base.timeOfDay) ? config.base.timeOfDay : 14) % 24 + 24) % 24,
      rate: bounded(config.vent.ratedM3h, 120, 0, 600),
      u: bounded(config.envelope.uValue, 1.5, 0, 5), absorptance: bounded(config.envelope.solarAbsorptance, 0.6, 0, 1), shade: bounded(config.envelope.shadeFraction, 0, 0, 1),
      scenario,
    };
  }
  const bearing = { N: 0, E: 90, S: 180, W: 270 } as const;
  function facadeProjection(side: keyof typeof bearing, source: keyof typeof bearing): number {
    const cosine = Math.cos((bearing[side] + (plan?.northDegrees ?? 0) - bearing[source]) * Math.PI / 180);
    return cosine > 1e-12 ? cosine : 0;
  }
  function windPressure(side: keyof typeof bearing, from: keyof typeof bearing, speed: number): number {
    return 0.3 * speed * speed * (plan ? facadeProjection(side, from) ** 2 : side === from ? 1 : 0);
  }
  function storedEnergy(state: ThermalState): number {
    return rooms.reduce((sum, _, room) => sum + airCapacities[room] * (state.lowerT[room] + state.upperT[room]) + surfaceCapacities[room] * state.wallT[room], 0);
  }
  function createThermalState(config: ThermalConfig): ThermalState {
    const { scenario } = settings(config);
    const state: ThermalState = {
      modelId: id, ...(modelKey ? { modelKey } : {}), elapsedSeconds: 0,
      lowerT: new Float64Array(count).fill(bounded(config.initialTemperature ?? scenario.initialTemperature, scenario.initialTemperature, 10, 60)),
      upperT: new Float64Array(count).fill(bounded(config.initialTemperature ?? scenario.initialTemperature, scenario.initialTemperature, 10, 60)),
      wallT: new Float64Array(count).fill(bounded(config.initialTemperature ?? scenario.initialTemperature, scenario.initialTemperature, 10, 60)),
      lowerPm25: new Float64Array(count).fill(bounded(config.initialPm25 ?? scenario.initialPm25, scenario.initialPm25, 0, 1000)),
      upperPm25: new Float64Array(count).fill(bounded(config.initialPm25 ?? scenario.initialPm25, scenario.initialPm25, 0, 1000)),
      initialEnergyJ: 0, netHeatJ: 0, electricalEnergyWh: 0, fanEnergyWh: 0, ventilationHeatRemovedJ: 0,
    };
    state.initialEnergyJ = storedEnergy(state); return state;
  }
  function validateState(state: ThermalState): void {
    if ((plan || state.modelId) && state.modelId !== id) throw new RangeError('Thermal state belongs to a different floorplan. Start a new study.');
    if (plan && state.modelKey !== modelKey) throw new RangeError('Thermal state belongs to a different floorplan. Start a new study.');
    for (const values of [state.lowerT, state.upperT, state.wallT, state.lowerPm25, state.upperPm25]) {
      if (values.length !== count || !values.every(Number.isFinite)) throw new RangeError('Thermal state is invalid. Reset the Cooling Lab.');
    }
    if (![state.elapsedSeconds, state.initialEnergyJ, state.netHeatJ, state.electricalEnergyWh, state.fanEnergyWh ?? 0, state.ventilationHeatRemovedJ ?? 0].every(Number.isFinite)) throw new RangeError('Thermal counters are invalid. Reset the Cooling Lab.');
  }
  interface Edge { a: number; b: number; g: number; drive: number; outsidePressure: number; exchange: number; fan?: boolean; outsideT?: number; outsideC?: number; corridor?: boolean; opening?: string; layer?: number }
  interface Evaluation {
    heat: Float64Array; surfaces: Float64Array; pollutant: Float64Array; budget: ThermalHeatBudget;
    ventilation: Float64Array; mixing: Float64Array; wallToAir: Float64Array;
    outdoorInflow: Float64Array; corridorInflow: Float64Array;
    openingFlows: ThermalOpeningFlow[];
    fanFlow: number; fanPower: number; power: number; maxRate: number; massResidual: number;
  }

  function evaluate(state: ThermalState, config: ThermalConfig): Evaluation {
    const s = settings(config), base = config.base;
    const temperatures = new Float64Array(nodeCount), particles = new Float64Array(nodeCount);
    for (let room = 0; room < count; room++) {
      temperatures[lower(room)] = state.lowerT[room]; temperatures[upper(room)] = state.upperT[room];
      particles[lower(room)] = state.lowerPm25[room]; particles[upper(room)] = state.upperPm25[room];
    }
    const edges: Edge[] = [];
    const add = (a: number, b: number, area: number, drive = 0, outsidePressure = 0, exchange = 0, boundary?: Pick<Edge, 'outsideT' | 'outsideC' | 'corridor' | 'opening' | 'layer'>) => {
      if (area > 0) edges.push({ a, b, g: area * P.openingConductanceM3sPerPaPerM2, drive, outsidePressure, exchange, ...boundary });
    };
    const mixing = new Float64Array(count), circulationFans = new Float64Array(count), purifierCounts = new Float64Array(count);
    for (const device of devices) if (base.devices[device.name]) {
      const room = rooms.findIndex(candidate => candidate.name === device.room);
      if (device.kind === 'fan') circulationFans[room]++;
      if (device.kind === 'purifier') purifierCounts[room]++;
    }
    if (!plan) for (const fan of resolveStandingFans(base)) {
      if (!fan.on || fan.speed <= 0) continue;
      const room = rooms.findIndex(room => room.name === fan.room);
      if (room >= 0) circulationFans[room] += fan.speed / 2;
    }
    if (!plan && base.purifier?.on) {
      const slot = PURIFIER_SLOTS[Math.round(bounded(base.purifier.slot, 0, 0, PURIFIER_SLOTS.length - 1))];
      purifierCounts[rooms.findIndex(room => room.name === slot.room)]++;
    }
    for (let room = 0; room < count; room++) {
      const meanT = (state.lowerT[room] + state.upperT[room]) / 2;
      const stackPressure = P.densityKgM3 * P.gravityMps2 * layerHeight * (meanT - s.outdoorT) / (s.outdoorT + 273.15);
      const unstable = Math.max(0, state.lowerT[room] - state.upperT[room]);
      mixing[room] = rooms[room].area_m2 * (0.002 + 0.012 * Math.sqrt(P.gravityMps2 * layerHeight * unstable / (meanT + 273.15))) + circulationFans[room] * 0.2;
      add(lower(room), upper(room), rooms[room].area_m2, stackPressure, 0, mixing[room]);
    }
    for (const passage of passages) for (let layer = 0; layer < 2; layer++) add(2 * passage.a + layer, 2 * passage.b + layer, passage.area / 2, 0, 0, passage.area * 0.005);
    for (const aperture of apertures) {
      if (aperture.box.name === config.vent.opening) continue;
      if (!aperture.permanent && !(aperture.box.type === 'door' ? base.doors : base.windows)[aperture.box.name]) continue;
      if (!aperture.rooms.length) continue;
      for (let layer = 0; layer < 2; layer++) {
        const area = aperture.width * Math.max(0, Math.min(aperture.box.max[1], (layer + 1) * layerHeight) - Math.max(aperture.box.min[1], layer * layerHeight));
        const outside = aperture.box.exterior === true;
        const corridor = !plan && outside && s.corridorEnabled && aperture.box.name === 'main_door';
        const outsidePressure = corridor ? P.densityKgM3 * P.gravityMps2 * (layer + 0.5) * layerHeight * (s.corridorT - s.outdoorT) / (s.outdoorT + 273.15)
          : outside ? windPressure(aperture.facade, s.windFrom, s.wind) : 0;
        if (outside || aperture.rooms.length === 2) add(2 * aperture.rooms[0] + layer, outside ? -1 : 2 * aperture.rooms[1] + layer, area, 0, outsidePressure, outside ? 0 : area * 0.01,
          { opening: aperture.box.name, layer, ...(corridor ? { outsideT: s.corridorT, outsideC: s.corridorC, corridor: true } : {}) });
      }
    }
    if (s.aperture && s.rate > 0) edges.push({ a: upper(s.aperture.rooms[0]), b: -1, g: s.rate / 3600 / P.fanShutoffPressurePa,
      drive: config.vent.on ? (config.vent.mode === 'exhaust' ? 1 : -1) * P.fanShutoffPressurePa : 0,
      outsidePressure: windPressure(s.aperture.facade, s.windFrom, s.wind), exchange: 0, fan: true, opening: s.aperture.box.name, layer: 1 });

    const matrix = new Float64Array(nodeCount * nodeCount), rhs = new Float64Array(nodeCount);
    const adjacent = Array.from({ length: nodeCount }, () => [] as number[]), outside = new Uint8Array(nodeCount);
    for (const edge of edges) {
      matrix[edge.a * nodeCount + edge.a] += edge.g; rhs[edge.a] -= edge.g * edge.drive;
      if (edge.b >= 0) {
        matrix[edge.b * nodeCount + edge.b] += edge.g; matrix[edge.a * nodeCount + edge.b] -= edge.g; matrix[edge.b * nodeCount + edge.a] -= edge.g;
        rhs[edge.b] += edge.g * edge.drive; adjacent[edge.a].push(edge.b); adjacent[edge.b].push(edge.a);
      } else { rhs[edge.a] += edge.g * edge.outsidePressure; outside[edge.a] = 1; }
    }
    const visited = new Uint8Array(nodeCount);
    for (let start = 0; start < nodeCount; start++) if (!visited[start]) {
      const component = [start]; visited[start] = 1; let connectedOutside = false;
      for (let head = 0; head < component.length; head++) {
        const node = component[head]; connectedOutside ||= outside[node] === 1;
        for (const next of adjacent[node]) if (!visited[next]) { visited[next] = 1; component.push(next); }
      }
      if (!connectedOutside) { for (let j = 0; j < nodeCount; j++) matrix[start * nodeCount + j] = 0; matrix[start * nodeCount + start] = 1; rhs[start] = 0; }
    }
    for (let pivot = 0; pivot < nodeCount; pivot++) {
      let row = pivot;
      for (let next = pivot + 1; next < nodeCount; next++) if (Math.abs(matrix[next * nodeCount + pivot]) > Math.abs(matrix[row * nodeCount + pivot])) row = next;
      if (Math.abs(matrix[row * nodeCount + pivot]) < 1e-14) throw new Error('Thermal airflow network is singular. Reset the Cooling Lab.');
      if (row !== pivot) {
        for (let j = pivot; j < nodeCount; j++) [matrix[pivot * nodeCount + j], matrix[row * nodeCount + j]] = [matrix[row * nodeCount + j], matrix[pivot * nodeCount + j]];
        [rhs[pivot], rhs[row]] = [rhs[row], rhs[pivot]];
      }
      for (let next = pivot + 1; next < nodeCount; next++) {
        const factor = matrix[next * nodeCount + pivot] / matrix[pivot * nodeCount + pivot];
        if (!factor) continue;
        for (let j = pivot; j < nodeCount; j++) matrix[next * nodeCount + j] -= factor * matrix[pivot * nodeCount + j];
        rhs[next] -= factor * rhs[pivot];
      }
    }
    const pressure = new Float64Array(nodeCount);
    for (let node = nodeCount - 1; node >= 0; node--) {
      let value = rhs[node]; for (let j = node + 1; j < nodeCount; j++) value -= matrix[node * nodeCount + j] * pressure[j];
      pressure[node] = value / matrix[node * nodeCount + node];
    }

    const heat = new Float64Array(nodeCount), surfaces = new Float64Array(count), pollutant = new Float64Array(nodeCount);
    const ventilation = new Float64Array(count), mass = new Float64Array(nodeCount), rates = new Float64Array(nodeCount), wallToAir = new Float64Array(count);
    const outdoorInflow = new Float64Array(count), corridorInflow = new Float64Array(count);
    const openingFlows: ThermalOpeningFlow[] = apertures.map(aperture => ({ opening: aperture.box.name,
      roomA: rooms[aperture.rooms[0]]?.name ?? '', roomB: aperture.box.exterior ? null : rooms[aperture.rooms[1]]?.name ?? null,
      lowerM3h: 0, upperM3h: 0, netM3h: 0, grossM3h: 0 }));
    const budget: ThermalHeatBudget = { solar: 0, people: 0, conduction: 0, radiation: 0, ventilation: 0, ac: 0, fan: 0, appliances: 0, net: 0 };
    let fanFlow = 0, power = 0;
    for (const edge of edges) {
      const flow = edge.g * (pressure[edge.a] - (edge.b >= 0 ? pressure[edge.b] : edge.outsidePressure) + edge.drive);
      if (edge.opening) {
        const reading = openingFlows.find(reading => reading.opening === edge.opening)!;
        if (edge.layer === 0) reading.lowerM3h += flow * 3600; else reading.upperM3h += flow * 3600;
        reading.netM3h += flow * 3600; reading.grossM3h += Math.abs(flow) * 3600;
      }
      const aRoom = Math.floor(edge.a / 2), bRoom = Math.floor(edge.b / 2);
      const upstreamT = flow >= 0 ? temperatures[edge.a] : edge.b >= 0 ? temperatures[edge.b] : edge.outsideT ?? s.outdoorT;
      const upstreamC = flow >= 0 ? particles[edge.a] : edge.b >= 0 ? particles[edge.b] : edge.outsideC ?? s.outdoorC;
      const energy = airCp * flow * upstreamT, particle = flow * upstreamC;
      heat[edge.a] -= energy; pollutant[edge.a] -= particle; mass[edge.a] += flow;
      rates[edge.a] += Math.max(0, flow) / volumes[aRoom];
      if (edge.b >= 0) {
        heat[edge.b] += energy; pollutant[edge.b] += particle; mass[edge.b] -= flow;
        rates[edge.b] += Math.max(0, -flow) / volumes[bRoom];
        const exchangedHeat = airCp * edge.exchange * (temperatures[edge.b] - temperatures[edge.a]);
        const exchangedParticles = edge.exchange * (particles[edge.b] - particles[edge.a]);
        heat[edge.a] += exchangedHeat; heat[edge.b] -= exchangedHeat; pollutant[edge.a] += exchangedParticles; pollutant[edge.b] -= exchangedParticles;
        rates[edge.a] += edge.exchange / volumes[aRoom]; rates[edge.b] += edge.exchange / volumes[bRoom];
      } else {
        budget.ventilation -= energy; ventilation[aRoom] += Math.abs(flow) * 3600;
        (edge.corridor ? corridorInflow : outdoorInflow)[aRoom] += Math.max(0, -flow) * 3600;
      }
      if (edge.fan) fanFlow = flow * (config.vent.mode === 'exhaust' ? 1 : -1);
    }
    const fanPower = config.vent.on && s.rate > 0 ? 4 + s.rate / 30 : 0;
    if (s.aperture) heat[upper(s.aperture.rooms[0])] += fanPower; budget.fan = fanPower; power += fanPower;
    const sun = Math.max(0, Math.sin((s.hour - 6) / 12 * Math.PI));
    for (let room = 0; room < count; room++) {
      let exposedArea = Object.values(exteriorAreas[room]).reduce((sum, area) => sum + area, 0), absorbedSolar = 0, transmittedSolar = 0;
      for (const side of (plan ? ['N', 'E', 'S', 'W'] as const : s.scenario.sunFacades)) {
        const solarApertures = apertures.filter(aperture => aperture.box.exterior && aperture.rooms[0] === room && aperture.facade === side && aperture.box.name !== config.vent.opening
          && (aperture.box.type === 'window' || (plan && (aperture.permanent || base.doors[aperture.box.name]))));
        const glazing = solarApertures.reduce((sum, aperture) => sum + aperture.area, 0);
        const transmittedArea = solarApertures.reduce((sum, aperture) => sum + aperture.area * (aperture.box.type !== 'window' || base.windows[aperture.box.name] ? 1 : P.glazingSolarTransmittance), 0);
        const irradiance = P.peakSolarWPerM2 * sun * (1 - s.shade) * (plan ? s.scenario.sunFacades.reduce((sum, sunSide) => sum + facadeProjection(side, sunSide), 0) : 1);
        absorbedSolar += irradiance * Math.max(0, exteriorAreas[room][side] - glazing) * s.absorptance;
        transmittedSolar += irradiance * transmittedArea;
      }
      for (const aperture of apertures) if (aperture.box.exterior && aperture.rooms[0] === room && aperture.box.name !== config.vent.opening && (aperture.permanent || (aperture.box.type === 'door' ? base.doors : base.windows)[aperture.box.name])) exposedArea -= aperture.area;
      exposedArea = Math.max(0, exposedArea);
      let exteriorT = s.outdoorT;
      for (let iteration = 0; iteration < 8 && exposedArea > 0; iteration++) {
        const balance = P.exteriorConvectionWPerM2K * (s.outdoorT - exteriorT) + P.emissivity * P.stefanBoltzmann * ((s.outdoorT + 273.15) ** 4 - (exteriorT + 273.15) ** 4)
          + s.u * (state.wallT[room] - exteriorT) + absorbedSolar / exposedArea;
        exteriorT += balance / (P.exteriorConvectionWPerM2K + 4 * P.emissivity * P.stefanBoltzmann * (exteriorT + 273.15) ** 3 + s.u);
      }
      const radiationConductance = P.emissivity * P.stefanBoltzmann * (s.outdoorT + exteriorT + 546.3) * ((s.outdoorT + 273.15) ** 2 + (exteriorT + 273.15) ** 2);
      const transmission = s.u / (s.u + P.exteriorConvectionWPerM2K + radiationConductance);
      const conduction = transmission * P.exteriorConvectionWPerM2K * exposedArea * (s.outdoorT - state.wallT[room]);
      const radiation = transmission * radiationConductance * exposedArea * (s.outdoorT - state.wallT[room]);
      const solar = transmission * absorbedSolar + transmittedSolar;
      surfaces[room] += conduction + radiation + solar; budget.conduction += conduction; budget.radiation += radiation; budget.solar += solar;
      const openSurfaceArea = apertures.filter(aperture => aperture.rooms.includes(room) && aperture.box.name !== config.vent.opening
        && (aperture.permanent || (aperture.box.type === 'door' ? base.doors : base.windows)[aperture.box.name])).reduce((sum, aperture) => sum + aperture.area, 0);
      const conductance = P.insideConvectionWPerM2K * Math.max(0, surfaceAreas[room] - openSurfaceArea) / 2;
      for (const node of [lower(room), upper(room)]) {
        const transfer = conductance * (state.wallT[room] - temperatures[node]);
        heat[node] += transfer; surfaces[room] -= transfer; wallToAir[room] += transfer; rates[node] += conductance / airCapacities[room];
      }
      let people = s.scenario.people && ['living', 'master_bedroom', 'bedroom3'].includes(rooms[room].name) ? 100 : 0;
      if (config.occupancyPeople !== undefined || plan) people = bounded(config.occupancyPeople ?? 4, 4, 0, 100) * 100 * rooms[room].area_m2 / totalArea;
      else if (rooms[room].name === 'bedroom3') people += s.scenario.validationHeatWatts;
      heat[lower(room)] += people * (1 - P.plumeUpperFraction); heat[upper(room)] += people * P.plumeUpperFraction; budget.people += people;
      const applianceHeat = circulationFans[room] * P.circulationFanWatts + purifierCounts[room] * 40;
      heat[lower(room)] += applianceHeat; budget.appliances += applianceHeat; power += applianceHeat;
      for (const node of [lower(room), upper(room)]) {
        const cleanFlow = purifierCounts[room] * 250 / 3600 / 2;
        pollutant[node] -= cleanFlow * particles[node]; rates[node] += cleanFlow / volumes[room];
      }
      const acCount = devices.filter(device => device.kind === 'ac' && device.room === rooms[room].name && base.devices[device.name]).length;
      if (acCount) for (const [node, fraction] of [[lower(room), 0.7], [upper(room), 0.3]]) {
        const maximum = !plan && rooms[room].name === 'living' ? 3500 : 2500;
        const cooling = acCount * Math.min(maximum * fraction, Math.max(0, temperatures[node] - s.setpoint) * 500 * fraction);
        heat[node] -= cooling; budget.ac -= cooling; power += cooling / 3.2; rates[node] += acCount * 500 * fraction / airCapacities[room];
      }
    }
    for (const passage of passages) {
      const closedDoors = apertures.filter(aperture => !aperture.box.exterior && aperture.rooms.includes(passage.a) && aperture.rooms.includes(passage.b) && !aperture.permanent && !(aperture.box.type === 'door' ? base.doors : base.windows)[aperture.box.name]).reduce((sum, aperture) => sum + aperture.area, 0);
      const transfer = P.interiorConductanceWPerM2K * (passage.wallArea + closedDoors) * (state.wallT[passage.b] - state.wallT[passage.a]);
      surfaces[passage.a] += transfer; surfaces[passage.b] -= transfer;
    }
    budget.net = budget.solar + budget.people + budget.conduction + budget.radiation + budget.ventilation + budget.ac + budget.fan + budget.appliances;
    const maxRate = rates.reduce((max, rate) => Math.max(max, rate), 0);
    const massResidual = mass.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    return { heat, surfaces, pollutant, budget, ventilation, mixing, wallToAir, outdoorInflow, corridorInflow, openingFlows, fanFlow, fanPower, power, maxRate, massResidual };
  }

  function stepThermalState(previous: ThermalState, config: ThermalConfig, deltaSeconds: number): ThermalState {
    validateState(previous);
    const state: ThermalState = { ...previous, lowerT: previous.lowerT.slice(), upperT: previous.upperT.slice(), wallT: previous.wallT.slice(), lowerPm25: previous.lowerPm25.slice(), upperPm25: previous.upperPm25.slice() };
    let remaining = bounded(deltaSeconds, 0, 0, 7200);
    while (remaining > 1e-9) {
      const result = evaluate(state, config), dt = Math.min(remaining, 1, 0.2 / Math.max(0.2, result.maxRate));
      for (let room = 0; room < count; room++) {
        state.lowerT[room] += result.heat[lower(room)] * dt / airCapacities[room]; state.upperT[room] += result.heat[upper(room)] * dt / airCapacities[room];
        state.wallT[room] += result.surfaces[room] * dt / surfaceCapacities[room];
        state.lowerPm25[room] = Math.max(0, state.lowerPm25[room] + result.pollutant[lower(room)] * dt / volumes[room]);
        state.upperPm25[room] = Math.max(0, state.upperPm25[room] + result.pollutant[upper(room)] * dt / volumes[room]);
      }
      state.elapsedSeconds += dt; state.netHeatJ += result.budget.net * dt; state.electricalEnergyWh += result.power * dt / 3600;
      state.fanEnergyWh = (state.fanEnergyWh ?? 0) + result.fanPower * dt / 3600;
      state.ventilationHeatRemovedJ = (state.ventilationHeatRemovedJ ?? 0) - result.budget.ventilation * dt;
      remaining -= dt;
    }
    validateState(state); return state;
  }
  function thermalSnapshot(state: ThermalState, config: ThermalConfig): ThermalSnapshot {
    validateState(state);
    const evaluated = evaluate(state, config), area = rooms.reduce((sum, room) => sum + room.area_m2, 0);
    const mean = (values: Float64Array) => rooms.reduce((sum, room, index) => sum + room.area_m2 * values[index], 0) / area;
    const roomReadings = rooms.map((room, index) => ({ room: room.name, lowerTemperature: state.lowerT[index], upperTemperature: state.upperT[index], surfaceTemperature: state.wallT[index],
      pm25: (state.lowerPm25[index] + state.upperPm25[index]) / 2, ventilationM3h: evaluated.ventilation[index], buoyancyExchangeM3h: evaluated.mixing[index] * 3600, wallToAirWatts: evaluated.wallToAir[index],
      boundaryAirChangesPerHour: (evaluated.outdoorInflow[index] + evaluated.corridorInflow[index]) / (room.area_m2 * height), outdoorInflowM3h: evaluated.outdoorInflow[index], corridorInflowM3h: evaluated.corridorInflow[index] }));
    const storedEnergyJ = storedEnergy(state);
    const outdoorInflowM3h = evaluated.outdoorInflow.reduce((sum, flow) => sum + flow, 0), corridorInflowM3h = evaluated.corridorInflow.reduce((sum, flow) => sum + flow, 0);
    return { ...(plan ? { openingFlows: evaluated.openingFlows } : {}), elapsedSeconds: state.elapsedSeconds, rooms: roomReadings, averageTemperature: (mean(state.lowerT) + mean(state.upperT)) / 2,
      averageUpperTemperature: mean(state.upperT), averageSurfaceTemperature: mean(state.wallT), averagePm25: (mean(state.lowerPm25) + mean(state.upperPm25)) / 2,
      actualVentM3h: evaluated.fanFlow * 3600, fanPowerWatts: evaluated.fanPower, powerWatts: evaluated.power, energyWh: state.electricalEnergyWh,
      airChangesPerHour: (outdoorInflowM3h + corridorInflowM3h) / (area * height), outdoorInflowM3h, corridorInflowM3h,
      sensibleHeatRemovedWatts: -evaluated.budget.ventilation, fanEnergyWh: state.fanEnergyWh ?? 0, ventilationHeatRemovedJ: state.ventilationHeatRemovedJ ?? 0,
      heatBudgetW: evaluated.budget, storedEnergyJ, energyResidualJ: storedEnergyJ - state.initialEnergyJ - state.netHeatJ, maxMassResidualM3s: evaluated.massResidual };
  }

  return { id, rooms: structuredClone(rooms), openings: structuredClone(modelOpenings),
    createConfig: createThermalConfig, createState: createThermalState, validateState, step: stepThermalState, snapshot: thermalSnapshot };
}
const canonicalThermalModel = createThermalModel();
export const THERMAL_OPENINGS = canonicalThermalModel.openings;
export const createThermalConfig = canonicalThermalModel.createConfig;
export const createThermalState = canonicalThermalModel.createState;
export const stepThermalState = canonicalThermalModel.step;
export const thermalSnapshot = canonicalThermalModel.snapshot;
