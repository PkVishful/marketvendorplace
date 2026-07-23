import { normalizeRegionName } from '@/components/dashboard/districtMaps/liveRegions';
import type { AreaChild } from './api';

/**
 * Filter sub-areas by a typed query.
 *
 * Reuses the map's name normaliser rather than a plain `includes`, so the same
 * romanisation variants that the live-score merge already reconciles are also
 * searchable: someone who types "Villupuram" or "Trichy" finds the district
 * stored as "Viluppuram" / "Tiruchirappalli". A search that only matched the
 * stored spelling would look broken to whoever typed the other one.
 */
/** Punctuation/case only — keeps a leading article that normalizeRegionName drops. */
function bareName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function filterChildren(children: AreaChild[], query: string): AreaChild[] {
  const q = normalizeRegionName(query.trim());
  if (!q) return children;

  return children.filter((child) => {
    // Two forms per district: article-stripped ("nilgiris") and literal
    // ("thenilgiris"). Someone typing either spelling should find it.
    //
    // The query is never article-stripped: "Theni" is its own district, and
    // trimming a leading "the" would reduce it to "ni" and match half the state.
    const canonical = normalizeRegionName(child.name);
    const literal = bareName(child.name);
    return canonical.includes(q) || literal.includes(q);
  });
}
