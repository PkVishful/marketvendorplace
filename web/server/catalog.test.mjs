// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { shapeChecklist, frequencyLabel, domainSlug } from './catalog.mjs';

const row = (o) => ({
  stageCode: 'FOUNDATION', stageName: 'Foundation', sequence: 3,
  testCode: 'X', testName: 'X test', domain: 'CONCRETE', isCode: 'IS 456',
  requiresNabl: true, tatDays: 3, frequencyType: 'ONCE', frequencySpec: {}, ...o,
});

describe('domainSlug', () => {
  it('maps enum values to UI slugs', () => {
    expect(domainSlug('SOIL_GEOTECH')).toBe('soil');
    expect(domainSlug('BITUMEN_ROAD')).toBe('road/bitumen');
    expect(domainSlug('PLUMBING_FIRE_HVAC')).toBe('plumbing');
  });
});

describe('frequencyLabel', () => {
  it('ONCE -> catalog.freq.ONCE', () => {
    expect(frequencyLabel('ONCE', {})).toEqual({ key: 'catalog.freq.ONCE', params: {} });
  });
  it('tiered PER_VOLUME -> IS456 ladder key', () => {
    const spec = { unit: 'm3', tiers: [{ upto: 5, samples: 1 }], specimens_per_sample: 3 };
    expect(frequencyLabel('PER_VOLUME', spec)).toEqual({
      key: 'catalog.freq.PER_VOLUME_IS456', params: { unit: 'm3' },
    });
  });
  it('PER_CONSIGNMENT -> keyed with sample count', () => {
    expect(frequencyLabel('PER_CONSIGNMENT', { samples: 1 })).toEqual({
      key: 'catalog.freq.PER_CONSIGNMENT', params: { samples: 1 },
    });
  });
});

describe('shapeChecklist', () => {
  it('groups by stage in sequence order and marks repeats', () => {
    const out = shapeChecklist([
      row({ stageCode: 'FOUNDATION', sequence: 3, testCode: 'SLUMP', testName: 'Slump' }),
      row({ stageCode: 'SUBSTRUCTURE', sequence: 4, testCode: 'SLUMP', testName: 'Slump' }),
      row({ stageCode: 'FOUNDATION', sequence: 3, testCode: 'BEARING', testName: 'Bearing' }),
    ]);
    expect(out.stages.map((s) => s.code)).toEqual(['FOUNDATION', 'SUBSTRUCTURE']);
    const slumpFoundation = out.stages[0].tests.find((t) => t.code === 'SLUMP');
    expect(slumpFoundation.repeatsAcrossStages).toBe(true);
    const bearing = out.stages[0].tests.find((t) => t.code === 'BEARING');
    expect(bearing.repeatsAcrossStages).toBe(false);
  });

  it('renders cross-stage rows in their own group, never in stages', () => {
    const out = shapeChecklist(
      [row({ testCode: 'BEARING', testName: 'Bearing' })],
      [{ testCode: 'CONCRETE_MIX_DESIGN', testName: 'Mix design', domain: 'CONCRETE',
         isCode: 'IS 10262', requiresNabl: true, tatDays: 28 }],
    );
    expect(out.stages.flatMap((s) => s.tests).map((t) => t.code)).toEqual(['BEARING']);
    expect(out.crossStage.map((t) => t.code)).toEqual(['CONCRETE_MIX_DESIGN']);
    // No stage rule → frequency reads as ONCE, and it is never a repeat.
    expect(out.crossStage[0].frequency).toEqual({ key: 'catalog.freq.ONCE', params: {} });
    expect(out.crossStage[0].repeatsAcrossStages).toBe(false);
  });
});
