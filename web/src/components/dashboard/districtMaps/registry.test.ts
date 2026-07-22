import { describe, it, expect } from 'vitest';
import { resolveDistrictKey, resolveMapScope } from './registry';
import { DISTRICT_TALUKAS } from './talukaData';

describe('district map resolution', () => {
  it('resolves every seeded district path to its own key (no Coimbatore fallback)', () => {
    for (const key of Object.keys(DISTRICT_TALUKAS)) {
      const path = `TN.${key.toUpperCase()}`; // seed codes are UPPER(registry key)
      expect(resolveDistrictKey(undefined, path)).toBe(key);
    }
  });

  it('falls back to the state map (never coimbatore) for an unknown path', () => {
    expect(resolveDistrictKey(undefined, 'TN.NOWHERE_DISTRICT')).toBe('tamilnadu');
  });

  it('resolveMapScope flags unavailable only on a real miss', () => {
    expect(resolveMapScope(undefined, 'TN.MADURAI')).toEqual(
      { level: 'district', key: 'madurai', unavailable: false });
    expect(resolveMapScope(undefined, 'TN')).toEqual(
      { level: 'state', key: 'tamilnadu', unavailable: false });
    expect(resolveMapScope(undefined, 'TN.NOWHERE_DISTRICT')).toEqual(
      { level: 'state', key: 'tamilnadu', unavailable: true });
  });
});
