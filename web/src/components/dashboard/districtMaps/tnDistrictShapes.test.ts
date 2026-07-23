import { describe, it, expect } from 'vitest';
import { TN_DISTRICT_SHAPES, TN_MAP_VIEWBOX } from './tnDistrictShapes';
import { normalizeRegionName } from './liveRegions';
import { DISTRICT_TALUKAS, formatDistrictName } from './talukaData';

describe('generated district shapes', () => {
  it('covers all but the newest district', () => {
    // Mayiladuthurai was carved out in 2020 and is absent from the source
    // dataset. Pinned deliberately: if a future dataset adds it this test
    // fails and tells us to drop the exception rather than silently keeping a
    // district unclickable.
    expect(TN_DISTRICT_SHAPES).toHaveLength(37);
  });

  it('every shape carries usable path data', () => {
    for (const shape of TN_DISTRICT_SHAPES) {
      expect(shape.d.startsWith('M')).toBe(true);
      expect(shape.d.endsWith('Z')).toBe(true);
      expect(shape.d.length).toBeGreaterThan(50);
    }
  });

  it('declares a viewBox the paths actually fit inside', () => {
    const [, , w, h] = TN_MAP_VIEWBOX.split(' ').map(Number);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);

    // Paths are multi-ring (M..Z M..Z), so pull coordinate pairs with a regex
    // rather than splitting on command letters.
    for (const shape of TN_DISTRICT_SHAPES) {
      for (const m of shape.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)) {
        const x = Number(m[1]); const y = Number(m[2]);
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(w + 1);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(h + 1);
      }
    }
  });

  it('has no duplicate districts', () => {
    const keys = TN_DISTRICT_SHAPES.map((s) => normalizeRegionName(s.name));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('matches the registry district names, so fills can be joined to live scores', () => {
    const registry = new Set(
      Object.keys(DISTRICT_TALUKAS).map((k) => normalizeRegionName(formatDistrictName(k))),
    );
    const unmatched = TN_DISTRICT_SHAPES
      .map((s) => s.name)
      .filter((n) => !registry.has(normalizeRegionName(n)));

    // A shape that matches nothing renders inert and grey — it must never
    // happen silently, because the district would look like it has no data.
    expect(unmatched).toEqual([]);
  });
});
