import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getDistrictMap } from './districtMaps/registry';
import { PERFORMANCE_COLORS, type TalukaPerformance } from './districtMaps/types';

interface DistrictPerformanceMapProps {
  districtName?: string;
  orgPath?: string;
}

function TalukaLabel({
  x,
  y,
  name,
  line2,
  line2Y,
}: {
  x: number;
  y: number;
  name: string;
  line2?: string;
  line2Y?: number;
}) {
  const words = name.split(' ');
  const useTwoLines = line2 != null || words.length > 1;
  const line1 = line2 ? name : words.slice(0, Math.ceil(words.length / 2)).join(' ');
  const line2Text = line2 ?? words.slice(Math.ceil(words.length / 2)).join(' ');

  return (
    <text
      textAnchor="middle"
      dominantBaseline="middle"
      fill="white"
      fontSize={useTwoLines ? 13 : 14}
      fontWeight="700"
      style={{ pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
    >
      <tspan x={x} y={useTwoLines ? y - 6 : y}>
        {line1}
      </tspan>
      {useTwoLines && line2Text && (
        <tspan x={x} y={line2Y ?? y + 14}>
          {line2Text}
        </tspan>
      )}
    </text>
  );
}

export function DistrictPerformanceMap({ districtName, orgPath }: DistrictPerformanceMapProps) {
  const { t } = useTranslation();
  const mapDef = useMemo(() => getDistrictMap(districtName, orgPath), [districtName, orgPath]);

  const performanceCounts = mapDef.talukas.reduce(
    (acc, taluka) => {
      const p = taluka.performance ?? 'watch';
      acc[p] += 1;
      return acc;
    },
    { strong: 0, watch: 0, attention: 0 } as Record<TalukaPerformance, number>,
  );

  const uid = mapDef.key;
  const usesImage = Boolean(mapDef.imageSrc);
  const isStateMap = mapDef.key === 'tamilnadu' || mapDef.regionKind === 'districts';
  const regionLabel = isStateMap
    ? t('dashboard.districtMap.districts')
    : t('dashboard.districtMap.talukas');
  /** State view lists many districts — keep KPI strip compact. */
  const kpiRows = isStateMap ? mapDef.talukas.slice(0, 12) : mapDef.talukas;

  return (
    <div className="district-map">
      {!mapDef.hideMapHeader && (
        <div className="mb-3">
          <p className="font-display text-sm font-bold uppercase tracking-wide text-ink">
            {mapDef.name} {t('dashboard.districtMap.title')}
          </p>
          <p className="text-xs text-ink-3">{regionLabel}</p>
        </div>
      )}

      {usesImage ? (
        <figure className={`mx-auto w-full ${isStateMap ? 'max-w-md' : 'max-w-sm'}`}>
          <img
            src={mapDef.imageSrc}
            alt={t('dashboard.districtMap.ariaLabel', { district: mapDef.name })}
            className="h-auto w-full object-contain"
            loading="lazy"
            decoding="async"
          />
        </figure>
      ) : (
        <svg
          viewBox={mapDef.viewBox}
          className="mx-auto h-[240px] w-full max-w-md"
          role="img"
          aria-label={t('dashboard.districtMap.ariaLabel', { district: mapDef.name })}
        >
          <defs>
            <filter id={`${uid}-shadow`} x="-8%" y="-8%" width="116%" height="116%">
              <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#1a3a6b" floodOpacity="0.18" />
            </filter>
          </defs>

          {mapDef.talukas.map((taluka) =>
            taluka.path ? (
              <g key={taluka.id} filter={`url(#${uid}-shadow)`}>
                <path
                  d={taluka.path}
                  fill={taluka.color}
                  stroke="white"
                  strokeWidth="2.5"
                  className="transition-opacity hover:opacity-90"
                />
                {taluka.labelX != null && taluka.labelY != null && (
                  <TalukaLabel
                    x={taluka.labelX}
                    y={taluka.labelY}
                    name={taluka.name}
                    line2={taluka.labelLine2}
                    line2Y={taluka.labelLine2Y}
                  />
                )}
              </g>
            ) : null,
          )}
        </svg>
      )}

      <ul
        className={`mt-4 grid gap-2 sm:grid-cols-2 ${
          isStateMap ? 'max-h-48 overflow-y-auto pr-1' : ''
        }`}
      >
        {kpiRows.map((taluka) => (
          <li
            key={taluka.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: taluka.color }}
                aria-hidden
              />
              <span className="truncate font-medium text-ink">{taluka.name}</span>
            </span>
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
              style={{
                color: PERFORMANCE_COLORS[taluka.performance ?? 'watch'],
                backgroundColor: `${PERFORMANCE_COLORS[taluka.performance ?? 'watch']}18`,
              }}
            >
              {taluka.score ?? '—'}%
            </span>
          </li>
        ))}
      </ul>
      {isStateMap && mapDef.talukas.length > kpiRows.length && (
        <p className="mt-2 text-center text-[11px] text-ink-3">
          {t('dashboard.districtMap.showingDistricts', {
            shown: kpiRows.length,
            total: mapDef.talukas.length,
          })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap justify-center gap-4 border-t border-line pt-3 text-[11px]">
        {(['strong', 'watch', 'attention'] as const).map((level) => (
          <span key={level} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: PERFORMANCE_COLORS[level] }}
            />
            {t(`dashboard.districtMap.${level}`)} · {performanceCounts[level]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** @deprecated use DistrictPerformanceMap */
export { DistrictPerformanceMap as DistrictMap };
