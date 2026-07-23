import { describe, it, expect } from 'vitest';
import { mergeLiveRegions, normalizeRegionName } from './liveRegions';
import type { LiveRegion } from './liveRegions';
import type { DistrictMapDefinition } from './types';

function kpis(openOrders = 0) {
  return {
    openOrders,
    activeJobs: 0,
    failedTests30d: 0,
    certificates30d: 0,
    vendorsActive: 0,
  };
}

function mapDef(): DistrictMapDefinition {
  return {
    key: 'demo',
    name: 'Demo',
    viewBox: '0 0 100 100',
    regionKind: 'talukas',
    talukas: [
      { id: 'demo-0', name: 'Coimbatore North', color: '#111', score: 88, performance: 'strong' },
      { id: 'demo-1', name: 'Pollachi', color: '#222', score: 71, performance: 'watch' },
    ],
  };
}

describe('normalizeRegionName', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(normalizeRegionName('Coimbatore North')).toBe(normalizeRegionName('coimbatore-north'));
    expect(normalizeRegionName('The Nilgiris')).toBe(normalizeRegionName('the nilgiris'));
  });

  it('drops a leading article, so org_units "The Nilgiris" matches registry "Nilgiris"', () => {
    expect(normalizeRegionName('The Nilgiris')).toBe(normalizeRegionName('Nilgiris'));
  });

  it('folds known transliteration variants onto one key', () => {
    expect(normalizeRegionName('Villupuram')).toBe(normalizeRegionName('Viluppuram'));
    expect(normalizeRegionName('Thoothukkudi')).toBe(normalizeRegionName('Thoothukudi'));
  });

  it('keeps genuinely different districts apart', () => {
    expect(normalizeRegionName('Tirupathur')).not.toBe(normalizeRegionName('Tiruppur'));
    expect(normalizeRegionName('Tiruvallur')).not.toBe(normalizeRegionName('Tiruvarur'));
  });
});

describe('mergeLiveRegions', () => {
  it('applies the live score and derives performance from it', () => {
    const live: LiveRegion[] = [{ id: 'uuid-a', name: 'Coimbatore North', score: 25, kpis: kpis() }];

    const merged = mergeLiveRegions(mapDef(), live);

    const region = merged.talukas.find((t) => t.name === 'Coimbatore North')!;
    expect(region.score).toBe(25);
    expect(region.performance).toBe('attention');
  });

  it('matches regions whose names differ only by case or punctuation', () => {
    const live: LiveRegion[] = [{ id: 'uuid-a', name: 'coimbatore north', score: 90, kpis: kpis() }];

    const merged = mergeLiveRegions(mapDef(), live);

    expect(merged.talukas.find((t) => t.name === 'Coimbatore North')!.score).toBe(90);
  });

  it('attaches the live KPIs and the live org unit id to the matched region', () => {
    const live: LiveRegion[] = [
      { id: 'uuid-a', name: 'Pollachi', score: 50, kpis: { ...kpis(7), activeJobs: 3 } },
    ];

    const merged = mergeLiveRegions(mapDef(), live);

    const region = merged.talukas.find((t) => t.name === 'Pollachi')!;
    expect(region.kpis).toEqual({ ...kpis(7), activeJobs: 3 });
    expect(region.liveId).toBe('uuid-a');
  });

  it('clears the registry placeholder score for a region the endpoint did not return', () => {
    const merged = mergeLiveRegions(mapDef(), [
      { id: 'uuid-a', name: 'Coimbatore North', score: 40, kpis: kpis() },
    ]);

    const region = merged.talukas.find((t) => t.name === 'Pollachi')!;
    expect(region.score).toBeUndefined();
    expect(region.performance).toBeUndefined();
  });

  it('clears every placeholder score when no live regions are available', () => {
    const merged = mergeLiveRegions(mapDef(), []);

    expect(merged.talukas.map((t) => t.score)).toEqual([undefined, undefined]);
    expect(merged.talukas.map((t) => t.performance)).toEqual([undefined, undefined]);
  });

  it('treats a null live score as no data rather than zero', () => {
    const merged = mergeLiveRegions(mapDef(), [
      { id: 'uuid-a', name: 'Pollachi', score: null, kpis: kpis(4) },
    ]);

    const region = merged.talukas.find((t) => t.name === 'Pollachi')!;
    expect(region.score).toBeUndefined();
    expect(region.performance).toBeUndefined();
    expect(region.kpis).toEqual(kpis(4));
  });

  it('appends live regions that the registry has no geometry for, so none are dropped', () => {
    const merged = mergeLiveRegions(mapDef(), [
      { id: 'uuid-z', name: 'Valparai', score: 60, kpis: kpis(2) },
    ]);

    const region = merged.talukas.find((t) => t.name === 'Valparai');
    expect(region).toBeDefined();
    expect(region!.score).toBe(60);
    expect(region!.path).toBeUndefined();
    expect(region!.liveId).toBe('uuid-z');
  });

  it('matches a live region whose spelling differs from the registry', () => {
    const def: DistrictMapDefinition = {
      key: 'tamilnadu',
      name: 'Tamil Nadu',
      viewBox: '0 0 100 100',
      regionKind: 'districts',
      talukas: [
        { id: 'nilgiris', name: 'Nilgiris', color: '#111', score: 70, performance: 'watch' },
        { id: 'viluppuram', name: 'Viluppuram', color: '#222', score: 70, performance: 'watch' },
      ],
    };

    const merged = mergeLiveRegions(def, [
      { id: 'uuid-n', name: 'The Nilgiris', score: 30, kpis: kpis() },
      { id: 'uuid-v', name: 'Villupuram', score: 85, kpis: kpis() },
    ]);

    expect(merged.talukas).toHaveLength(2);
    expect(merged.talukas.find((t) => t.name === 'Nilgiris')!.score).toBe(30);
    expect(merged.talukas.find((t) => t.name === 'Viluppuram')!.score).toBe(85);
  });

  it('does not mutate the registry definition it was given', () => {
    const def = mapDef();

    mergeLiveRegions(def, [{ id: 'uuid-a', name: 'Pollachi', score: 12, kpis: kpis() }]);

    expect(def.talukas.find((t) => t.name === 'Pollachi')!.score).toBe(71);
    expect(def.talukas).toHaveLength(2);
  });
});
