import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PERFORMANCE_COLORS, performanceFromScore } from '@/components/dashboard/districtMaps/types';
import type { AreaChild } from './api';

/** Matches DistrictMap's treatment: an unscored region is grey, never amber. */
const NO_DATA_COLOR = '#94a3b8';

function scoreStyle(score: number | null) {
  const color = score == null ? NO_DATA_COLOR : PERFORMANCE_COLORS[performanceFromScore(score)];
  return { color, backgroundColor: `${color}18` };
}

export function AreaChildCard({ child }: { child: AreaChild }) {
  const { t } = useTranslation();

  const stats = [
    { label: t('area.kpi.openOrders'), value: child.kpis.openOrders },
    { label: t('area.kpi.activeJobs'), value: child.kpis.activeJobs },
    { label: t('area.kpi.vendorsActive'), value: child.kpis.vendorsActive },
    { label: t('area.kpi.certificates30d'), value: child.kpis.certificates30d },
    { label: t('area.kpi.failedTests30d'), value: child.kpis.failedTests30d },
  ];

  return (
    <Link
      to={`/gov/area/${child.id}`}
      className="block rounded-xl border border-line bg-surface p-4 transition hover:border-brand/40 hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-base font-bold text-ink">{child.name}</h3>
        <span
          className="shrink-0 rounded px-2 py-0.5 text-xs font-bold tabular-nums"
          style={scoreStyle(child.score)}
        >
          {child.score != null ? `${child.score}%` : t('area.noData')}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline justify-between gap-2">
            <dt className="truncate text-[11px] text-ink-3">{s.label}</dt>
            <dd className="font-display text-sm font-bold tabular-nums text-ink">{s.value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}
