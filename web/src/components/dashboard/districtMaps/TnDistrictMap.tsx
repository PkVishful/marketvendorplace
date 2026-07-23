import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeRegionName } from './liveRegions';
import { PERFORMANCE_COLORS, performanceFromScore } from './types';
import { TN_DISTRICT_SHAPES, TN_MAP_VIEWBOX } from './tnDistrictShapes';

/** Same grey the cards use, so "no data" reads identically wherever it appears. */
const NO_DATA_FILL = '#cbd5e1';

export interface MapRegion {
  id: string;
  name: string;
  score: number | null;
}

/**
 * Tamil Nadu districts as real, individually clickable shapes.
 *
 * Fill encodes the live quality score, so the map carries information rather
 * than being decoration — which the raster it replaced could never do.
 */
export function TnDistrictMap({
  regions,
  selectedId,
  onSelect,
}: {
  regions: MapRegion[];
  selectedId?: string | null;
  onSelect: (region: MapRegion) => void;
}) {
  const { t } = useTranslation();

  // Shapes come from a public dataset, region names from org_units, so they are
  // matched on the same normaliser the score merge uses rather than on ===.
  const byName = useMemo(() => {
    const map = new Map<string, MapRegion>();
    for (const r of regions) map.set(normalizeRegionName(r.name), r);
    return map;
  }, [regions]);

  return (
    <svg
      viewBox={TN_MAP_VIEWBOX}
      className="h-full w-full"
      role="img"
      aria-label={t('districtMap.ariaLabel')}
    >
      {TN_DISTRICT_SHAPES.map((shape) => {
        const region = byName.get(normalizeRegionName(shape.name)) ?? null;
        const selected = region != null && region.id === selectedId;
        const fill = region?.score != null
          ? PERFORMANCE_COLORS[performanceFromScore(region.score)]
          : NO_DATA_FILL;

        return (
          <path
            key={shape.name}
            d={shape.d}
            fill={fill}
            stroke={selected ? '#0f172a' : '#ffffff'}
            strokeWidth={selected ? 3 : 1}
            strokeLinejoin="round"
            // A district with no matching org unit stays inert rather than
            // navigating to nothing.
            className={region ? 'cursor-pointer transition-opacity hover:opacity-80' : 'opacity-60'}
            onClick={region ? () => onSelect(region) : undefined}
            role={region ? 'button' : undefined}
            tabIndex={region ? 0 : undefined}
            aria-label={region ? shape.name : undefined}
            onKeyDown={region ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(region); }
            } : undefined}
          >
            <title>
              {shape.name}
              {region?.score != null ? ` — ${region.score}%` : ''}
            </title>
          </path>
        );
      })}
    </svg>
  );
}
