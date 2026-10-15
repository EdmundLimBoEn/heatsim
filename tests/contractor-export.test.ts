import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { compareContractorPlans, type ContractorStudyConfig } from '../src/contractor-comparison';
import { contractorStudyHtml, contractorStudyJson } from '../src/contractor-export';
import { parseContractorPlan } from '../src/contractor-plan';
import { defaultConditions } from '../src/domain';

function input(): ContractorStudyConfig {
  const plans = ['cross-ventilation', 'one-sided', 'open-plan'].map(name => parseContractorPlan(readFileSync(new URL(`../public/study-examples/${name}.json`, import.meta.url), 'utf8')));
  plans[0].devices[0].on = true;
  plans[1].devices.find(device => device.kind === 'ac')!.on = true;
  plans[2].northDegrees = 90;
  return { plans, weather: { ...defaultConditions(), windFrom: 'N' }, durationSeconds: 10, initialTemperature: 31, initialPm25: 20, occupancyPeople: 4,
    brief: { projectName: 'Team apartment comparison', locationLabel: 'Singapore', latitude: 1.3, longitude: 103.8,
      sourceType: 'assumption', sourceName: 'Presentation assumptions', sourceModel: 'Manual input', sourceUrl: 'https://example.com/weather',
      validTime: '2026-10-15T14:00', timeZone: 'Asia/Singapore', referenceHeightM: 10, enteredAt: '2026-10-15T13:00:00+08:00' } };
}
const original = compareContractorPlans(input());
const report = () => structuredClone(original);

describe('contractor handoff exports', () => {
  test('prints three actual geometries, dimensions, orientation, equipment, results and honest study limits', () => {
    const result = report(), before = structuredClone(result);
    const html = contractorStudyHtml(result);
    expect(result).toEqual(before);
    expect(html.match(/<svg\b/g)).toHaveLength(3);
    expect(html).toContain('rotate(-90)');
    expect(html).toContain('80.00 m²');
    expect(html).toContain('72.00 m²');
    expect(html).toContain('84.00 m²');
    expect(html).toContain('10.00 × 8.00 m bounds');
    expect(html).toContain('1 fans · 0 purifiers · 0 AC units');
    expect(html).toContain('0 fans · 0 purifiers · 1 AC units');
    expect(html).toContain('Wh/m²');
    expect(html).toContain('Lower °C');
    expect(html).toContain('Ranking stability: not tested');
    expect(html).toContain('Early-stage ventilation option screening');
    expect(html).toContain('not specialist 3D CFD');
    expect(html).toContain('On-site verification before specification');
    expect(html).toContain('1.300000 / 103.800000');
    expect(html).toContain('Wind FROM');
    expect(html).toContain('Presentation assumptions');
    expect(html).not.toContain('1.3 m tall');
    expect(html).not.toContain('Full-size 90 m²');
    for (const option of result.cases) {
      expect(html).toContain(option.geometryId);
      expect(html).toContain(option.plan.name);
      expect(html).toContain(option.final.averageTemperature.toFixed(2));
    }
  });

  test('escapes hostile metadata and SVG labels with no scripts, active URLs or external assets', () => {
    const config = input();
    config.brief!.projectName = '<img src=x onerror="alert(1)">';
    config.brief!.locationLabel = '</dd><script>alert(2)</script>';
    config.brief!.sourceUrl = 'javascript:alert("weather")';
    config.plans[0].name = '<svg onload="alert(3)">';
    config.plans[0].rooms[0].label = '</text><script>alert(4)</script>';
    const result = compareContractorPlans(config);
    const html = contractorStudyHtml(result);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('&lt;/dd&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(/<(?:script|img|iframe|object|embed|link|a|image|use)\b/i.test(html)).toBe(false);
    expect(html.match(/<svg\b/g)).toHaveLength(3);
    expect(html).toContain('Content-Security-Policy');
    const saved = JSON.parse(contractorStudyJson(result));
    expect(saved.study.config.brief.projectName).toBe(config.brief!.projectName);
  });

  test('JSON retains exact inputs, typed-array values, source provenance, identities and results without mutation', () => {
    const result = report(), before = structuredClone(result);
    const saved = JSON.parse(contractorStudyJson(result));
    expect(result).toEqual(before);
    expect(saved.format).toBe('heatsim-contractor-study');
    expect(saved.version).toBe(1);
    expect(saved.study.config).toEqual(result.config);
    expect(saved.study.cases).toHaveLength(3);
    expect(saved.study.cases[0].initialState.lowerT).toEqual(Array.from(result.cases[0].initialState.lowerT));
    expect(saved.study.cases[0].initialState.modelKey).toBe(result.cases[0].initialState.modelKey);
    expect(saved.study.cases[0].final).toEqual(result.cases[0].final);
    expect(saved.study.recommendations).toEqual(result.recommendations);
    expect(saved.model.stateArrayOrder).toContain('case.initial.rooms');
  });

  test('rejects nonfinite values, unsupported geometry, mismatched plan/state and incomplete studies', () => {
    for (const exportReport of [contractorStudyHtml, contractorStudyJson]) {
      let result = report();
      result.cases[0].final.averageTemperature = NaN;
      expect(() => exportReport(result)).toThrow('non-finite');
      result = report();
      result.config.brief!.latitude = Infinity;
      expect(() => exportReport(result)).toThrow('non-finite');
      result = report();
      result.cases[0].plan.rooms[0].widthM = -1;
      expect(() => exportReport(result)).toThrow();
      result = report();
      result.cases[0].initialState.modelKey = result.cases[1].initialState.modelKey;
      expect(() => exportReport(result)).toThrow('different floorplan');
      result = report();
      result.cases[0].geometryId = 'wrong';
      expect(() => exportReport(result)).toThrow('captured inputs');
      result = report();
      result.cases.pop();
      expect(() => exportReport(result)).toThrow('three-plan');
    }
  });

  test('keeps missing provenance explicit and rejects inconsistent horizon or recommendation references', () => {
    let result = report();
    result.config.brief = undefined;
    expect(contractorStudyHtml(result)).toContain('Project/site/weather provenance not supplied.');
    result = report();
    result.cases[0].final.elapsedSeconds += 1;
    expect(() => contractorStudyHtml(result)).toThrow('horizon');
    result = report();
    result.cases[0].config.base.windFrom = 'S';
    expect(() => contractorStudyHtml(result)).toThrow('shared study conditions');
    result = report();
    result.cases[0].config.occupancyPeople = 8;
    expect(() => contractorStudyJson(result)).toThrow('shared study conditions');
    result = report();
    result.shortlistPlanIds.push('unknown_plan');
    expect(() => contractorStudyJson(result)).toThrow('unknown plan');
  });
});
