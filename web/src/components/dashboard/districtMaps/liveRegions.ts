// Merges live region scores from GET /api/gov/dashboard/map onto the static map
// registry.
//
// The two sources own different halves of the picture and neither can replace
// the other: the registry owns geometry (SVG paths, raster hotspots, colors,
// label positions) and the endpoint owns the numbers. They are joined on the
// region name because the ids are unrelated — registry ids are layout keys
// (`coimbatore-3`), endpoint ids are `org_units.id` UUIDs.
//
// The registry also carries hand-seeded placeholder scores so the dashboard had
// something to draw before this endpoint existed. Those must never survive the
// merge: a placeholder rendered in the same chip as a live score is
// indistinguishable from real data. Anything the endpoint does not report comes
// back with no score at all, which the UI renders as "no data".

import type { DistrictMapDefinition, RegionKpis, TalukaRegion } from './types';
import { performanceFromScore } from './types';

export type { RegionKpis } from './types';

export interface LiveRegion {
  id: string;
  name: string;
  /** null when the region has no orders to score */
  score: number | null;
  kpis: RegionKpis;
}

export interface DashboardMapDTO {
  level: 'state' | 'district';
  key: string;
  regions: LiveRegion[];
}

/** Fill for live regions the registry has no geometry or palette entry for. */
const UNMAPPED_REGION_COLOR = '#94a3b8';

/**
 * Tamil district names have more than one accepted romanization, and the
 * registry and `org_units` were populated from different sources. Keyed by the
 * punctuation-stripped form; both sides are folded onto the same value.
 *
 * Only add entries for names that are genuinely the same district — near-misses
 * like Tirupathur/Tiruppur and Tiruvallur/Tiruvarur are distinct districts.
 */
const REGION_NAME_ALIASES: Record<string, string> = {
  villupuram: 'viluppuram',
  vilupuram: 'viluppuram',
  thoothukkudi: 'thoothukudi',
  tuticorin: 'thoothukudi',
  trichy: 'tiruchirappalli',
  tiruchirapalli: 'tiruchirappalli',
  kanniyakumari: 'kanyakumari',
};

export function normalizeRegionName(name: string): string {
  const bare = name
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
  return REGION_NAME_ALIASES[bare] ?? bare;
}

function applyLive(region: TalukaRegion, live: LiveRegion | undefined): TalukaRegion {
  const { score: _placeholder, performance: _derived, ...geometry } = region;

  if (!live) return geometry;
  if (live.score == null) return { ...geometry, kpis: live.kpis, liveId: live.id };

  return {
    ...geometry,
    score: live.score,
    performance: performanceFromScore(live.score),
    kpis: live.kpis,
    liveId: live.id,
  };
}

/**
 * Returns a copy of `mapDef` carrying live scores. Regions the endpoint did not
 * report lose their placeholder score; regions the endpoint reported but the
 * registry does not know about are appended so nothing is silently dropped.
 */
export function mergeLiveRegions(
  mapDef: DistrictMapDefinition,
  regions: LiveRegion[] | undefined,
): DistrictMapDefinition {
  const byName = new Map((regions ?? []).map((r) => [normalizeRegionName(r.name), r]));
  const matched = new Set<string>();

  const talukas = mapDef.talukas.map((region) => {
    const key = normalizeRegionName(region.name);
    const live = byName.get(key);
    if (live) matched.add(key);
    return applyLive(region, live);
  });

  const unmapped = (regions ?? [])
    .filter((live) => !matched.has(normalizeRegionName(live.name)))
    .map((live) =>
      applyLive({ id: `live-${live.id}`, name: live.name, color: UNMAPPED_REGION_COLOR }, live),
    );

  return { ...mapDef, talukas: [...talukas, ...unmapped] };
}
