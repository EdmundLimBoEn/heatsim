import { describe, expect, it } from 'vitest';
import { findStandingFanPosition } from '../src/standing-fans';
import { defaultConditions, type SimulationResult } from '../src/domain';
import { describeAdviceChanges, describeAdviceOutcome, purifierMatches, hardwareOwnedControlsMatch } from '../src/homeowner-advice';

describe('homeowner advice from actual control differences', () => {
  it('describes a fan move and a named window opening', () => {
    const before = defaultConditions();
    before.portableFan = { on: true, slot: 2, angleDeg: 90, speed: 2 };
    const after = structuredClone(before);
    after.portableFan!.slot = 0;
    after.windows.window_bedroom3_1 = true;
    expect(describeAdviceChanges(before, after)).toEqual(['Move the main fan to Bedroom 3 (medium)', 'Point the main fan towards 0° (0° plan top, 90° plan right)', 'Open the Bedroom 3 north window 1']);
  });
  it('describes free position and absolute direction changes from the actual current placement', () => {
    const before = defaultConditions();
    before.portableFan!.on = true;
    const point = findStandingFanPosition('living', before, 'primary')!;
    expect(point).not.toBeNull();
    before.portableFan!.position = point;
    before.portableFan!.headingDeg = 75;
    const after = structuredClone(before);
    delete after.portableFan!.position;
    delete after.portableFan!.headingDeg;
    after.portableFan!.slot = 0;
    expect(describeAdviceChanges(before, after)).toEqual([
      'Move the main fan to Bedroom 3 (medium)',
      'Point the main fan towards 0° (0° plan top, 90° plan right)',
    ]);
    const back = describeAdviceChanges(after, before);
    expect(back[0]).toBe(`Move the main fan to Living at X ${point.x.toFixed(2)} m, Z ${point.z.toFixed(2)} m (medium)`);
    expect(back[1]).toContain('75°');
  });
  it('keeps unchanged extra fans out of the advice and identifies changed ones', () => {
    const before = defaultConditions();
    const point = findStandingFanPosition('living', before)!;
    before.standingFans = [{ id: 'fan-2', ...point, on: true, speed: 2, angleDeg: 90 }];
    const after = structuredClone(before);
    after.portableFan!.on = true;
    expect(describeAdviceChanges(before, after).some(text => text.includes('fan 2'))).toBe(false);
    after.standingFans![0].angleDeg = 270;
    expect(describeAdviceChanges(before, after)).toContain('Point the fan 2 towards 270° (0° plan top, 90° plan right)');
    after.standingFans = [];
    expect(describeAdviceChanges(before, after)).toContain('Remove fan 2');
  });
  it('does not suggest moving inactive devices', () => {
    const before = defaultConditions(), after = structuredClone(before);
    after.portableFan!.slot = 3; after.purifier!.slot = 2;
    expect(describeAdviceChanges(before, after)).toEqual([]);
  });
  it('reports a worse result honestly and keeps actual units', () => {
    const before: SimulationResult = { averageTemperature: 30, averageFeelsLike: 31, averagePm25: 20, powerWatts: 60, energyKwh: 0, elapsedSeconds: 120, rooms: [] };
    expect(describeAdviceOutcome(before, { ...before, averageTemperature: 30.4, averagePm25: 25, powerWatts: 40 })).toBe('0.4°C warmer air on average; 5.0 µg/m³ more PM2.5; 20 W less device power.');
  });
  it('detects a purifier conflict including a changed room', () => {
    const a = defaultConditions(), b = structuredClone(a);
    expect(purifierMatches(a, b)).toBe(true);
    b.purifier = { on: false, slot: 2 };
    expect(purifierMatches(a, b)).toBe(false);
    a.purifier = { on: true, slot: 2 };
    expect(purifierMatches(a, b)).toBe(false);
  });
  it('distinguishes the direction of fans that start off', () => {
    const before = defaultConditions();
    const after = structuredClone(before);
    after.portableFan = { on: true, slot: 0, speed: 2, angleDeg: 45 };
    expect(describeAdviceChanges(before, after)).toContain('Point the main fan towards 45° (0° plan top, 90° plan right)');
    after.portableFan.angleDeg = 135;
    expect(describeAdviceChanges(before, after)).toContain('Point the main fan towards 315° (0° plan top, 90° plan right)');
  });
  it('guards both absolute D4 window states and D5 purifier state', () => {
    const before = defaultConditions();
    for (const id of ['window_bedroom3_1', 'window_bedroom3_2']) {
      const after = structuredClone(before); after.windows[id] = true;
      expect(hardwareOwnedControlsMatch(before, after)).toBe(false);
    }
    const after = structuredClone(before); after.purifier!.on = true;
    expect(hardwareOwnedControlsMatch(before, after)).toBe(false);
    after.purifier!.on = false; after.windows.window_living_1 = true;
    expect(hardwareOwnedControlsMatch(before, after)).toBe(true);
  });
  it('identifies the second living purifier placement as a corner', () => {
    const before = defaultConditions(), after = structuredClone(before);
    before.purifier = { on: true, slot: 0 }; after.purifier = { on: true, slot: 4 };
    expect(describeAdviceChanges(before, after)).toEqual(['Move the purifier to Living corner']);
  });

});
