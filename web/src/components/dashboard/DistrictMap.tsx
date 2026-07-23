import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { getDistrictMap } from './districtMaps/registry';
import { mergeLiveRegions } from './districtMaps/liveRegions';
import { useGovDashboardMap } from '@/features/gov/useGov';
import {
  PERFORMANCE_COLORS,
  type TalukaDetailStats,
  type TalukaPerformance,
  type TalukaRegion,
} from './districtMaps/types';
import { defaultTalukaDetails } from './districtMaps/talukaDetails';

interface DistrictPerformanceMapProps {
  districtName?: string;
  orgPath?: string;
}

/** Regions the endpoint reported no score for. Deliberately outside the
 *  performance palette so "no data" never reads as a rating. */
const NO_DATA_COLOR = '#94a3b8';

function scoreChipStyle(performance?: TalukaPerformance) {
  const color = performance ? PERFORMANCE_COLORS[performance] : NO_DATA_COLOR;
  return { color, backgroundColor: `${color}18` };
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

function TalukaDetailPanel({
  taluka,
  onClear,
}: {
  taluka: TalukaRegion;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const details: TalukaDetailStats =
    taluka.details ?? defaultTalukaDetails(taluka.name, taluka.score ?? 75);
  const performance = taluka.performance;

  // Live counts when the endpoint reported this region; the placeholder set
  // otherwise, so the panel never mixes real and invented numbers.
  const stats = taluka.kpis
    ? [
        { label: t('dashboard.districtMap.openOrders'), value: taluka.kpis.openOrders },
        { label: t('dashboard.districtMap.activeJobs'), value: taluka.kpis.activeJobs },
        { label: t('dashboard.districtMap.vendorsActive'), value: taluka.kpis.vendorsActive },
        { label: t('dashboard.districtMap.certificates30d'), value: taluka.kpis.certificates30d },
      ]
    : [
        { label: t('dashboard.districtMap.activeProjects'), value: details.activeProjects },
        { label: t('dashboard.districtMap.openRfqs'), value: details.openRfqs },
        { label: t('dashboard.districtMap.labsEngaged'), value: details.labsEngaged },
        { label: t('dashboard.districtMap.pendingTests'), value: details.pendingTests },
      ];

  return (
    <article
      className="taluk-detail-panel mt-4 overflow-hidden rounded-xl border border-brand/20 bg-surface-2/50"
      aria-live="polite"
    >
      <div
        className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3"
        style={{ borderLeftWidth: 4, borderLeftColor: taluka.color }}
      >
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
            {t('dashboard.districtMap.talukDetails')}
          </p>
          <h4 className="font-display text-base font-bold text-ink">{taluka.name}</h4>
          <p className="mt-0.5 text-xs text-slate">{details.blockOffice}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded px-2 py-0.5 text-xs font-bold tabular-nums"
            style={scoreChipStyle(performance)}
          >
            {taluka.score != null ? `${taluka.score}%` : t('dashboard.districtMap.noData')}
          </span>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-slate hover:bg-surface-2"
            aria-label={t('dashboard.districtMap.clearSelection')}
            onClick={onClear}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">{s.label}</p>
            <p className="mt-1 font-display text-xl font-bold tabular-nums text-brand">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
          {t('dashboard.districtMap.sectionEngineer')}
        </p>
        <p className="mt-1 text-sm font-medium text-ink">{details.sectionEngineer}</p>
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
          {t('dashboard.districtMap.recentProjects')}
        </p>
        <ul className="mt-2 space-y-1.5">
          {details.recentProjects.map((project) => (
            <li key={project} className="flex items-center gap-2 text-sm text-ink">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
              {project}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
        <Link to="/gov/orders" className="gov-btn-primary text-xs">
          {t('dashboard.districtMap.viewTalukRfqs')}
        </Link>
        <Link to="/gov/quality" className="gov-btn-secondary text-xs">
          {t('dashboard.districtMap.viewTalukQuality')}
        </Link>
      </div>
    </article>
  );
}

export function DistrictPerformanceMap({ districtName, orgPath }: DistrictPerformanceMapProps) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useGovDashboardMap();
  const baseMap = useMemo(() => getDistrictMap(districtName, orgPath), [districtName, orgPath]);
  // Scores always come from the endpoint. Until it answers, the registry's
  // placeholder numbers are stripped rather than shown as if they were real.
  const mapDef = useMemo(() => mergeLiveRegions(baseMap, data?.regions), [baseMap, data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedTaluka = mapDef.talukas.find((t) => t.id === selectedId) ?? null;
  const isStateMap = mapDef.key === 'tamilnadu' || mapDef.regionKind === 'districts';
  const regionLabel = isStateMap
    ? t('dashboard.districtMap.districts')
    : t('dashboard.districtMap.talukas');
  const kpiRows = isStateMap ? mapDef.talukas.slice(0, 12) : mapDef.talukas;
  const usesImage = Boolean(mapDef.imageSrc);
  const uid = mapDef.key;
  const selectable = !isStateMap;

  // Unscored regions get their own bucket — folding them into `watch` would
  // inflate a rating the endpoint never gave.
  const performanceCounts = mapDef.talukas.reduce(
    (acc, taluka) => {
      if (taluka.performance) acc[taluka.performance] += 1;
      else acc.noData += 1;
      return acc;
    },
    { strong: 0, watch: 0, attention: 0, noData: 0 } as Record<TalukaPerformance | 'noData', number>,
  );

  function selectTaluka(id: string) {
    if (!selectable) return;
    setSelectedId((prev) => (prev === id ? null : id));
  }

  function talukaRowClass(id: string) {
    const selected = selectedId === id;
    return [
      'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition',
      selected
        ? 'border-brand bg-brand-tint/40 ring-1 ring-brand/30'
        : 'border-line bg-surface-2/60 hover:border-brand/30 hover:bg-surface-2',
      selectable ? 'cursor-pointer' : '',
    ].join(' ');
  }

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

      {selectable && !selectedTaluka && (
        <p className="mb-2 text-xs text-slate">{t('dashboard.districtMap.selectTaluk')}</p>
      )}

      {isPending && (
        <p className="mb-2 text-xs text-slate" role="status">
          {t('dashboard.districtMap.loading')}
        </p>
      )}

      {isError && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
          <p className="text-xs text-danger">{t('dashboard.districtMap.loadFailed')}</p>
          <button
            type="button"
            className="rounded border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-surface-2"
            onClick={() => void refetch()}
          >
            {t('dashboard.districtMap.retry')}
          </button>
        </div>
      )}

      {usesImage ? (
        <figure className={`relative mx-auto w-full ${isStateMap ? 'max-w-md' : 'max-w-sm'}`}>
          <img
            src={mapDef.imageSrc}
            alt={t('dashboard.districtMap.ariaLabel', { district: mapDef.name })}
            className="h-auto w-full object-contain"
            loading="lazy"
            decoding="async"
          />
          {selectable && (
            <svg
              viewBox={mapDef.viewBox}
              className="absolute inset-0 h-full w-full"
              aria-hidden
            >
              {mapDef.talukas.map((taluka) =>
                taluka.hotspot ? (
                  <rect
                    key={taluka.id}
                    x={taluka.hotspot.x}
                    y={taluka.hotspot.y}
                    width={taluka.hotspot.w}
                    height={taluka.hotspot.h}
                    fill={selectedId === taluka.id ? `${taluka.color}55` : 'transparent'}
                    stroke={selectedId === taluka.id ? taluka.color : 'transparent'}
                    strokeWidth={selectedId === taluka.id ? 3 : 0}
                    className="cursor-pointer transition-colors hover:fill-white/10"
                    onClick={() => selectTaluka(taluka.id)}
                  />
                ) : null,
              )}
            </svg>
          )}
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
                  stroke={selectedId === taluka.id ? '#1a3a6b' : 'white'}
                  strokeWidth={selectedId === taluka.id ? 3.5 : 2.5}
                  className={`transition-opacity ${selectable ? 'cursor-pointer hover:opacity-90' : ''}`}
                  opacity={selectedId && selectedId !== taluka.id ? 0.55 : 1}
                  onClick={() => selectTaluka(taluka.id)}
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
        {kpiRows.map((taluka) => {
          const inner = (
            <>
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
                style={scoreChipStyle(taluka.performance)}
              >
                {taluka.score != null ? `${taluka.score}%` : t('dashboard.districtMap.noData')}
              </span>
            </>
          );

          return (
            <li key={taluka.id}>
              {selectable ? (
                <button type="button" className={talukaRowClass(taluka.id)} onClick={() => selectTaluka(taluka.id)}>
                  {inner}
                </button>
              ) : (
                <div className={talukaRowClass(taluka.id)}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>

      {isStateMap && mapDef.talukas.length > kpiRows.length && (
        <p className="mt-2 text-center text-[11px] text-ink-3">
          {t('dashboard.districtMap.showingDistricts', {
            shown: kpiRows.length,
            total: mapDef.talukas.length,
          })}
        </p>
      )}

      {selectedTaluka && selectable && (
        <TalukaDetailPanel taluka={selectedTaluka} onClear={() => setSelectedId(null)} />
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
        {performanceCounts.noData > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: NO_DATA_COLOR }} />
            {t('dashboard.districtMap.noDataLegend')} · {performanceCounts.noData}
          </span>
        )}
      </div>
    </div>
  );
}

/** @deprecated use DistrictPerformanceMap */
export { DistrictPerformanceMap as DistrictMap };
