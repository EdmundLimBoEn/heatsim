import { deviceRoom, model, type Conditions, type ModelBox, type PlanField, type SimulationResult } from './domain';
import { FAN_SLOTS, PURIFIER_SLOTS, type DeviceSlot } from './config/slots';
import { SCENARIOS } from './simulation';
import { resolveStandingFans } from './standing-fans';

export const PLAN_SIMULATION_NOTE = 'Qualitative toy CFD · 2D plan-view mode. A 20 cm floorplan grid transports heat and haze through openings using a steady pressure-flow approximation. No vertical buoyancy, turbulence, sensors or live data. Humidity adjusts an illustrative comfort indicator, not a medical heat index. Temperatures, comfort and energy are not calibrated predictions. The master-bath window is above this 1.2 m slice.';
export const PLAN_GRID = { nx: 64, nz: 48, dx: 0.2, origin: [-0.3, -0.3] as [number, number], height: 1.2 };
const { nx, nz, dx, origin } = PLAN_GRID;
const size = nx * nz;
const FLUID = 0, SOLID = 1, OUTSIDE = 2;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback;
const openings = model.boxes.filter(box => box.type === 'door' || box.type === 'window');
const walls = model.boxes.filter(box => box.type === 'wall');
const roomOf = new Int16Array(size).fill(-1);
const closedMask = new Uint8Array(size).fill(OUTSIDE);
const openingCells = new Map<string, number[]>();

function interval(min: number, max: number, offset: number, count: number): [number, number] {
  let lo = Math.floor((min - offset) / dx + 0.5 + 1e-6);
  let hi = Math.floor((max - offset) / dx + 0.5 + 1e-6);
  if (hi <= lo) { lo = Math.floor(((min + max) / 2 - offset) / dx); hi = lo + 1; }
  return [clamp(lo, 0, count), clamp(hi, 0, count)];
}
function raster(box: Pick<ModelBox, 'min' | 'max'>): number[] {
  if (box.min[1] > PLAN_GRID.height || box.max[1] <= PLAN_GRID.height) return [];
  const [x0, x1] = interval(box.min[0], box.max[0], origin[0], nx);
  const [z0, z1] = interval(box.min[2], box.max[2], origin[1], nz);
  const cells: number[] = [];
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) cells.push(x + nx * z);
  return cells;
}
for (const [index, room] of model.rooms.entries()) for (const cell of raster(room)) { closedMask[cell] = FLUID; roomOf[cell] = index; }
for (const box of model.boxes) {
  const solid = ['wall', 'floor', 'ceiling', 'furniture'].includes(box.type)
    || (box.type === 'device' && !box.name.startsWith('fan_') && !box.name.startsWith('purifier_'));
  if (solid) for (const cell of raster(box)) closedMask[cell] = SOLID;
}
for (const opening of openings) {
  const normal = opening.wall_axis === 'x' ? 2 : 0;
  const hosts = walls.filter(wall => wall.name === opening.wall || wall.name.startsWith(`${opening.wall}_`));
  const min: [number, number, number] = [...opening.min], max: [number, number, number] = [...opening.max];
  if (hosts.length) {
    min[normal] = Math.min(...hosts.map(wall => wall.min[normal]));
    max[normal] = Math.max(...hosts.map(wall => wall.max[normal]));
  }
  const cells = raster({ min, max });
  openingCells.set(opening.name, cells);
  for (const cell of cells) closedMask[cell] = SOLID;
}

function neighbours(cell: number): number[] {
  const x = cell % nx, z = Math.floor(cell / nx);
  return [x > 0 ? cell - 1 : -1, x < nx - 1 ? cell + 1 : -1, z > 0 ? cell - nx : -1, z < nz - 1 ? cell + nx : -1].filter(i => i >= 0);
}
function position(cell: number): [number, number] { return [origin[0] + (cell % nx + 0.5) * dx, origin[1] + (Math.floor(cell / nx) + 0.5) * dx]; }
function nearestCell(slot: DeviceSlot, mask: Uint8Array): number {
  const room = model.rooms.findIndex(candidate => candidate.name === slot.room);
  let closest = -1, distance = Infinity;
  for (let cell = 0; cell < size; cell++) if (mask[cell] === FLUID && roomOf[cell] === room) {
    const [x, z] = position(cell), d = (x - slot.x) ** 2 + (z - slot.z) ** 2;
    if (d < distance) { distance = d; closest = cell; }
  }
  return closest;
}
function localCells(slot: DeviceSlot, radius: number, mask: Uint8Array): number[] {
  const center = nearestCell(slot, mask);
  if (center < 0) return [];
  const [x0, z0] = position(center), seen = new Set([center]), queue = [center];
  for (let head = 0; head < queue.length; head++) for (const next of neighbours(queue[head])) {
    if (seen.has(next) || mask[next] !== FLUID) continue;
    const [x, z] = position(next);
    if (Math.hypot(x - x0, z - z0) > radius) continue;
    seen.add(next); queue.push(next);
  }
  return queue;
}
function environment(conditions: Conditions) {
  const scenario = SCENARIOS.find(scenario => scenario.id === conditions.scenarioId) ?? SCENARIOS[0];
  return {
    scenario,
    windFrom: conditions.windFrom && ['N', 'E', 'S', 'W'].includes(conditions.windFrom) ? conditions.windFrom : scenario.windward,
    temperature: clamp(finite(conditions.outdoorTemperature, 30), 10, 60),
    pm25: clamp(finite(conditions.outdoorPm25, 20), 0, 1000),
    humidity: clamp(finite(conditions.humidity, 70), 0, 100),
    hour: ((finite(conditions.timeOfDay, 14) % 24) + 24) % 24,
    wind: clamp(finite(conditions.windSpeed, 1.2), 0, 10),
    setpoint: clamp(finite(conditions.acSetpoint, 25), 16, 32),
  };
}

interface Flow {
  key: string; mask: Uint8Array; a: Int32Array; b: Int32Array; velocity: Float64Array;
  ux: Float32Array; uz: Float32Array; pressure: Float32Array; heat: Float32Array; cooling: Float32Array; cleaning: Float32Array;
  powerWatts: number; maxStep: number;
}
const flowForResult = new WeakMap<SimulationResult, Flow>();
function configurationKey(conditions: Conditions): string {
  return JSON.stringify([conditions.scenarioId, conditions.windSpeed, conditions.windFrom, conditions.timeOfDay, conditions.doors, conditions.windows, conditions.devices, conditions.portableFan, conditions.standingFans, conditions.purifier]);
}

function buildFlow(conditions: Conditions, key: string): Flow {
  const { scenario, wind, windFrom, hour } = environment(conditions);
  const mask = closedMask.slice();
  for (const opening of openings) if ((opening.type === 'door' ? conditions.doors : conditions.windows)[opening.name]) {
    for (const cell of openingCells.get(opening.name)!) mask[cell] = FLUID;
  }
  const forceX = new Float64Array(size), forceZ = new Float64Array(size);
  const heat = new Float32Array(size), cooling = new Float32Array(size), cleaning = new Float32Array(size);
  let powerWatts = 0;
  for (const fan of resolveStandingFans(conditions)) if (fan.on && fan.speed > 0) {
    const original = conditions.portableFan;
    const legacyYaw = fan.isPrimary && original && !Number.isFinite(original.headingDeg)
      ? FAN_SLOTS[clamp(Math.round(finite(original.slot, 0)), 0, FAN_SLOTS.length - 1)].baseYaw + clamp(finite(original.angleDeg, 90), 0, 180) - 90 : undefined;
    const yaw = (legacyYaw ?? 180 - fan.angleDeg) * Math.PI / 180;
    const strength = clamp(finite(fan.speed, 2), 0, 3) / 3 * 1.8;
    for (const cell of localCells(fan, 0.5, mask)) { forceX[cell] += Math.sin(yaw) * strength; forceZ[cell] += Math.cos(yaw) * strength; }
    powerWatts += 50;
  }
  const addPurifier = (slot: DeviceSlot) => {
    for (const cell of localCells(slot, 0.65, mask)) cleaning[cell] += 0.2;
    powerWatts += 40;
  };
  if (conditions.purifier?.on) addPurifier(PURIFIER_SLOTS[clamp(Math.round(finite(conditions.purifier.slot, 0)), 0, PURIFIER_SLOTS.length - 1)]);
  for (const [name, room] of Object.entries(deviceRoom)) {
    if (!conditions.devices[name]) continue;
    const box = model.boxes.find(candidate => candidate.name === name)!;
    const slot = { room, x: (box.min[0] + box.max[0]) / 2, z: (box.min[2] + box.max[2]) / 2 };
    if (name.startsWith('purifier_')) addPurifier(slot);
    else if (name.startsWith('fan_')) {
      // shortcut: ceiling-fan downwash is represented as planar circulation; use 3D for vertical flow.
      for (const cell of localCells(slot, 1.5, mask)) {
        const [x, z] = position(cell), rx = x - slot.x, rz = z - slot.z;
        const strength = 0.7 * Math.exp(-(rx * rx + rz * rz));
        forceX[cell] -= rz * strength; forceZ[cell] += rx * strength;
      }
      powerWatts += 50;
    } else if (name.startsWith('ac_')) {
      const target = model.rooms.find(candidate => candidate.name === room)!;
      const tx = (target.min[0] + target.max[0]) / 2 - slot.x;
      const tz = (target.min[2] + target.max[2]) / 2 - slot.z;
      const distance = Math.hypot(tx, tz) || 1;
      slot.x += tx / distance * 0.4; slot.z += tz / distance * 0.4;
      // shortcut: AC downwash is projected onto this slice; use the 3D engine for its vertical jet.
      for (const cell of localCells(slot, 0.65, mask)) {
        cooling[cell] += 0.8; forceX[cell] += tx / distance * 0.35; forceZ[cell] += tz / distance * 0.35;
      }
      powerWatts += 1000;
    }
  }
  const sunshine = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
  if (scenario.sunFacades.includes('W')) for (let cell = 0; cell < size; cell++) {
    if (mask[cell] === FLUID && position(cell)[0] < 0.4 && neighbours(cell).some(next => mask[next] === SOLID)) heat[cell] += 0.04 * sunshine;
  }
  if (scenario.people) for (const slot of [FAN_SLOTS[0], FAN_SLOTS[2], FAN_SLOTS[4]]) {
    for (const cell of localCells(slot, 0.3, mask)) heat[cell] += 0.012;
  }
  if (scenario.validationHeatWatts) {
    const cells = localCells(FAN_SLOTS[0], 0.3, mask);
    for (const cell of cells) heat[cell] += scenario.validationHeatWatts / (cells.length * dx * dx * model.ceiling_height * 1200);
  }

  const from: number[] = [], to: number[] = [], directions: number[] = [], drives: number[] = [], reservoir: number[] = [];
  const diagonal = new Float64Array(size), rhs = new Float64Array(size);
  for (let cell = 0; cell < size; cell++) if (mask[cell] === FLUID) for (const next of neighbours(cell)) {
    if (mask[next] === SOLID || (mask[next] === FLUID && next < cell)) continue;
    const direction = next - cell;
    const component = Math.abs(direction) === 1 ? forceX : forceZ;
    const sign = Math.sign(direction), drive = sign * (component[cell] + (mask[next] === FLUID ? component[next] : 0)) / 2;
    const [x, z] = position(next);
    const windward = (windFrom === 'N' && z < 0) || (windFrom === 'S' && z > 7.5)
      || (windFrom === 'E' && x > 12) || (windFrom === 'W' && x < 0);
    const outsidePressure = mask[next] === OUTSIDE && windward ? wind * 5 : 0;
    from.push(cell); to.push(next); directions.push(direction); drives.push(drive); reservoir.push(outsidePressure);
    diagonal[cell]++; rhs[cell] -= drive;
    if (mask[next] === FLUID) { diagonal[next]++; rhs[next] += drive; }
    else rhs[cell] += outsidePressure;
  }
  const a = Int32Array.from(from), b = Int32Array.from(to), pressure = new Float64Array(size);
  const residual = rhs.slice(), search = new Float64Array(size), preconditioned = new Float64Array(size), product = new Float64Array(size);
  let residualDot = 0;
  for (let cell = 0; cell < size; cell++) {
    search[cell] = preconditioned[cell] = diagonal[cell] ? residual[cell] / diagonal[cell] : 0;
    residualDot += residual[cell] * preconditioned[cell];
  }
  // The graph Laplacian projects the local pumps onto wall-respecting, conservative face flows.
  for (let iteration = 0; iteration < 600 && residualDot > 1e-16; iteration++) {
    for (let cell = 0; cell < size; cell++) product[cell] = diagonal[cell] * search[cell];
    for (let edge = 0; edge < a.length; edge++) if (mask[b[edge]] === FLUID) {
      product[a[edge]] -= search[b[edge]]; product[b[edge]] -= search[a[edge]];
    }
    let denominator = 0;
    for (let cell = 0; cell < size; cell++) denominator += search[cell] * product[cell];
    if (denominator < 1e-25) break;
    const alpha = residualDot / denominator;
    let nextDot = 0;
    for (let cell = 0; cell < size; cell++) {
      pressure[cell] += alpha * search[cell]; residual[cell] -= alpha * product[cell];
      preconditioned[cell] = diagonal[cell] ? residual[cell] / diagonal[cell] : 0;
      nextDot += residual[cell] * preconditioned[cell];
    }
    const beta = nextDot / residualDot;
    for (let cell = 0; cell < size; cell++) search[cell] = preconditioned[cell] + beta * search[cell];
    residualDot = nextDot;
  }
  const velocity = new Float64Array(a.length);
  let maxVelocity = 0;
  for (let edge = 0; edge < a.length; edge++) {
    velocity[edge] = drives[edge] + pressure[a[edge]] - (mask[b[edge]] === FLUID ? pressure[b[edge]] : reservoir[edge]);
    maxVelocity = Math.max(maxVelocity, Math.abs(velocity[edge]));
  }
  const scale = maxVelocity > 2 ? 2 / maxVelocity : 1;
  const ux = new Float32Array(size), uz = new Float32Array(size), outgoing = new Float64Array(size);
  for (let edge = 0; edge < a.length; edge++) {
    const value = velocity[edge] *= scale;
    const component = Math.abs(directions[edge]) === 1 ? ux : uz;
    component[a[edge]] += Math.sign(directions[edge]) * value / 2;
    if (mask[b[edge]] === FLUID) component[b[edge]] += Math.sign(directions[edge]) * value / 2;
    outgoing[a[edge]] += Math.max(0, value) / dx;
    if (mask[b[edge]] === FLUID) outgoing[b[edge]] += Math.max(0, -value) / dx;
  }
  const pressureView = new Float32Array(size), visited = new Uint8Array(size);
  const boundaryPressure = new Float64Array(size).fill(Infinity);
  for (let edge = 0; edge < a.length; edge++) if (mask[b[edge]] === OUTSIDE) {
    boundaryPressure[a[edge]] = Math.min(boundaryPressure[a[edge]], reservoir[edge]);
  }
  let pressureRange = 0;
  for (let start = 0; start < size; start++) if (mask[start] === FLUID && !visited[start]) {
    const component = [start]; visited[start] = 1;
    let reference = Infinity, total = 0;
    for (let head = 0; head < component.length; head++) {
      const cell = component[head]; total += pressure[cell]; reference = Math.min(reference, boundaryPressure[cell]);
      for (const next of neighbours(cell)) if (mask[next] === FLUID && !visited[next]) { visited[next] = 1; component.push(next); }
    }
    // A sealed component has no pressure datum; remove its arbitrary constant offset before display.
    if (!Number.isFinite(reference)) reference = total / component.length;
    for (const cell of component) {
      pressureView[cell] = pressure[cell] - reference;
      pressureRange = Math.max(pressureRange, Math.abs(pressureView[cell]));
    }
  }
  if (pressureRange > 1e-7) for (let cell = 0; cell < size; cell++) pressureView[cell] /= pressureRange;
  else pressureView.fill(0);
  const maxOutgoing = outgoing.reduce((max, value) => Math.max(max, value), 0);
  return { key, mask, a, b, velocity, ux, uz, pressure: pressureView, heat, cooling, cleaning, powerWatts, maxStep: Math.min(0.25, 0.85 / (maxOutgoing + 4 * 0.025 / (dx * dx))) };
}

function summarize(field: PlanField, conditions: Conditions, elapsedSeconds: number, energyKwh: number, flow: Flow): SimulationResult {
  const { humidity } = environment(conditions);
  const totals = model.rooms.map(() => ({ temperature: 0, pm25: 0, airflow: 0, count: 0 }));
  for (let cell = 0; cell < size; cell++) if (field.cellType[cell] === FLUID && roomOf[cell] >= 0) {
    const sum = totals[roomOf[cell]];
    sum.temperature += field.temperature[cell]; sum.pm25 += field.pm25[cell]; sum.airflow += Math.hypot(field.ux[cell], field.uz[cell]); sum.count++;
  }
  const rooms = model.rooms.map((room, index) => {
    const total = totals[index], n = total.count || 1;
    const temperature = total.temperature / n, airflow = total.airflow / n;
    const humidityEffect = Math.max(0, temperature - 24) * Math.max(0, humidity - 40) / 100;
    return { room: room.name, temperature, pm25: total.pm25 / n, airflow, feelsLike: temperature + humidityEffect - Math.min(3, 2.5 * airflow) };
  });
  const area = model.rooms.reduce((sum, room) => sum + room.area_m2, 0);
  const average = (key: 'temperature' | 'feelsLike' | 'pm25') => rooms.reduce((sum, room, i) => sum + room[key] * model.rooms[i].area_m2, 0) / area;
  const result = { field, rooms, elapsedSeconds, energyKwh, powerWatts: flow.powerWatts, averageTemperature: average('temperature'), averageFeelsLike: average('feelsLike'), averagePm25: average('pm25') };
  flowForResult.set(result, flow);
  return result;
}
function makeField(flow: Flow, temperature: Float32Array, pm25: Float32Array): PlanField {
  return { nx, nz, dx, origin: [...origin], temperature, pm25, ux: flow.ux.slice(), uz: flow.uz.slice(), pressure: flow.pressure.slice(), cellType: flow.mask.slice() };
}
export function createSimulation(conditions: Conditions): SimulationResult {
  const environmentState = environment(conditions), flow = buildFlow(conditions, configurationKey(conditions));
  const temperature = new Float32Array(size), pm25 = new Float32Array(size);
  for (let cell = 0; cell < size; cell++) {
    temperature[cell] = flow.mask[cell] === OUTSIDE ? environmentState.temperature : environmentState.scenario.initialTemperature;
    pm25[cell] = flow.mask[cell] === OUTSIDE ? environmentState.pm25 : environmentState.scenario.initialPm25;
  }
  return summarize(makeField(flow, temperature, pm25), conditions, 0, 0, flow);
}

export function preparePlanStep(previous: SimulationResult, conditions: Conditions, deltaSeconds: number) {
  conditions = structuredClone(conditions);
  const env = environment(conditions), key = configurationKey(conditions);
  const cached = flowForResult.get(previous), flow = cached?.key === key ? cached : buildFlow(conditions, key);
  const old = previous.field;
  const previousRooms = model.rooms.map(room => previous.rooms.find(reading => reading.room === room.name));
  let temperature = new Float32Array(size), pm25 = new Float32Array(size);
  for (let cell = 0; cell < size; cell++) {
    const room = previousRooms[roomOf[cell]];
    temperature[cell] = clamp(finite(old?.temperature[cell], finite(room?.temperature, env.scenario.initialTemperature)), 10, 60);
    pm25[cell] = clamp(finite(old?.pm25[cell], finite(room?.pm25, env.scenario.initialPm25)), 0, 1000);
    if (flow.mask[cell] === OUTSIDE) { temperature[cell] = env.temperature; pm25[cell] = env.pm25; }
    else if (flow.mask[cell] === FLUID && old && old.cellType[cell] !== FLUID) {
      const adjacent = neighbours(cell).filter(next => old.cellType[next] === FLUID && Number.isFinite(old.temperature[next]) && Number.isFinite(old.pm25[next]));
      temperature[cell] = clamp(adjacent.length ? adjacent.reduce((sum, next) => sum + old.temperature[next], 0) / adjacent.length : env.temperature, 10, 60);
      pm25[cell] = clamp(adjacent.length ? adjacent.reduce((sum, next) => sum + old.pm25[next], 0) / adjacent.length : env.pm25, 0, 1000);
    }
  }
  // shortcut: limit one call to 60 simulated seconds; split longer offline evaluations into chunks.
  const duration = clamp(finite(deltaSeconds, 0), 0, 60), count = Math.ceil(duration / flow.maxStep), dt = count ? duration / count : 0;
  return { flow, env, temperature, pm25, duration, count, dt, conditions,
    elapsedSeconds: Math.max(0, finite(previous.elapsedSeconds, 0)), energyKwh: Math.max(0, finite(previous.energyKwh, 0)) };
}
export type PreparedPlanStep = ReturnType<typeof preparePlanStep>;

export function completePlanStep(prepared: PreparedPlanStep, temperature: Float32Array, pm25: Float32Array): SimulationResult {
  return summarize(makeField(prepared.flow, temperature, pm25), prepared.conditions, prepared.elapsedSeconds + prepared.duration,
    prepared.energyKwh + prepared.flow.powerWatts * prepared.duration / 3_600_000, prepared.flow);
}

export function stepSimulation(previous: SimulationResult, conditions: Conditions, deltaSeconds: number): SimulationResult {
  const prepared = preparePlanStep(previous, conditions, deltaSeconds);
  const { flow, env, count, dt } = prepared;
  let { temperature, pm25 } = prepared;
  let nextT = new Float32Array(size), nextC = new Float32Array(size);
  const deltaT = new Float64Array(size), deltaC = new Float64Array(size);
  for (let step = 0; step < count; step++) {
    deltaT.fill(0); deltaC.fill(0);
    for (let edge = 0; edge < flow.a.length; edge++) {
      const a = flow.a[edge], b = flow.b[edge], velocity = flow.velocity[edge];
      const upstream = velocity >= 0 ? a : b;
      const transferT = dt * (velocity / dx * temperature[upstream] + 0.025 / (dx * dx) * (temperature[a] - temperature[b]));
      const transferC = dt * (velocity / dx * pm25[upstream] + 0.012 / (dx * dx) * (pm25[a] - pm25[b]));
      deltaT[a] -= transferT; deltaC[a] -= transferC;
      if (flow.mask[b] === FLUID) { deltaT[b] += transferT; deltaC[b] += transferC; }
    }
    for (let cell = 0; cell < size; cell++) {
      if (flow.mask[cell] !== FLUID) { nextT[cell] = temperature[cell]; nextC[cell] = pm25[cell]; continue; }
      const heated = temperature[cell] + deltaT[cell] + flow.heat[cell] * dt;
      const cooled = flow.cooling[cell] ? heated - Math.max(0, heated - env.setpoint) * (1 - Math.exp(-flow.cooling[cell] * dt)) : heated;
      const concentration = pm25[cell] + deltaC[cell];
      nextT[cell] = clamp(cooled, 10, 60);
      nextC[cell] = clamp(flow.cleaning[cell] ? concentration * Math.exp(-flow.cleaning[cell] * dt) : concentration, 0, 1000);
      if (!Number.isFinite(nextT[cell])) nextT[cell] = env.scenario.initialTemperature;
      if (!Number.isFinite(nextC[cell])) nextC[cell] = env.scenario.initialPm25;
    }
    [temperature, nextT] = [nextT, temperature]; [pm25, nextC] = [nextC, pm25];
  }
  return completePlanStep(prepared, temperature, pm25);
}
