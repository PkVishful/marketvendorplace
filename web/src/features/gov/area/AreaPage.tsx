import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, ShieldAlert } from 'lucide-react';
import { ApiError } from '@/lib/apiClient';
import { DistrictMapSection } from './DistrictMapSection';
import { useArea } from './useArea';
import { AreaBreadcrumbs } from './AreaBreadcrumbs';
import { AreaChildCard } from './AreaChildCard';
import { AreaProjectList } from './AreaProjectList';
import { filterChildren } from './filterChildren';
import type { AreaSummary } from './api';

function OutsideAreaScreen() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-8 text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-warning" aria-hidden />
      <h2 className="mt-3 font-display text-lg font-bold text-ink">{t('area.outsideTitle')}</h2>
      <p className="mt-2 text-sm text-slate">{t('area.outsideBody')}</p>
      <Link to="/gov/area" className="gov-btn-primary mt-5 inline-block text-sm">
        {t('area.backToMyArea')}
      </Link>
    </div>
  );
}

function SummaryStrip({ summary }: { summary: AreaSummary }) {
  const { t } = useTranslation();
  const items = [
    { label: t('area.kpi.openOrders'), value: summary.openOrders },
    { label: t('area.kpi.activeJobs'), value: summary.activeJobs },
    { label: t('area.kpi.pendingApprovals'), value: summary.pendingApprovals },
    { label: t('area.kpi.certificates30d'), value: summary.certificates30d },
    { label: t('area.kpi.failedTests30d'), value: summary.failedTests30d },
    {
      label: t('area.kpi.qualityScore'),
      value: summary.qualityScore != null ? `${summary.qualityScore}%` : t('area.noData'),
    },
  ];
  return (
    <ul className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((i) => (
        <li key={i.label} className="rounded-xl border border-line bg-surface px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">{i.label}</p>
          <p className="mt-1 font-display text-xl font-bold tabular-nums text-brand">{i.value}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * One page for every level of the org tree. The BFF collapses single-child
 * chains before answering, so `node` is the level actually worth rendering —
 * this component switches on it rather than on the id that was requested.
 */
export function AreaPage() {
  const { orgUnitId } = useParams<{ orgUnitId?: string }>();
  const { t } = useTranslation();
  const { data, isPending, isError, error } = useArea(orgUnitId);
  const [query, setQuery] = useState('');

  // Memoised off `data` rather than rebuilt inline: a fresh [] each render would
  // make the filter memo below recompute on every keystroke for nothing.
  const allChildren = useMemo(() => data?.children ?? [], [data]);
  const visibleChildren = useMemo(
    () => filterChildren(allChildren, query),
    [allChildren, query],
  );

  if (isError && error instanceof ApiError && error.status === 403) {
    return <OutsideAreaScreen />;
  }

  if (isPending) {
    return (
      <p className="text-sm text-slate" role="status">
        {t('area.loading')}
      </p>
    );
  }

  if (isError || !data) {
    return <p className="text-sm text-danger">{t('area.loadFailed')}</p>;
  }

  const { node, breadcrumbs, summary, projects } = data;
  const isProject = node.level === 'PROJECT';

  return (
    <div>
      <AreaBreadcrumbs crumbs={breadcrumbs} />

      <header className="mb-4">
        <h1 className="font-display text-xl font-bold text-ink">{node.name}</h1>
        <p className="text-xs uppercase tracking-wide text-ink-3">
          {t(`area.level.${node.level}`)}
        </p>
      </header>

      <SummaryStrip summary={summary} />

      {/* The vector map only carries district shapes, so it is shown where the
          children *are* districts. Deeper levels get the card grid alone. */}
      {node.level === 'STATE' && allChildren.length > 0 && (
        <DistrictMapSection districts={allChildren} />
      )}

      {isProject && (
        <Link to={`/gov/projects/${node.id}/checklist`} className="gov-btn-primary text-sm">
          {t('area.openChecklist')}
        </Link>
      )}

      {projects.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-3">
            {t('area.projectsHeading')}
          </h2>
          <AreaProjectList projects={projects} />
        </section>
      )}

      {allChildren.length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-ink-3">
              {t('area.childrenHeading')}
            </h2>
            {/* Every sub-area is listed; search narrows rather than paginates,
                so a district is never merely unreachable. */}
            <div className="relative w-full sm:w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('area.searchPlaceholder')}
                aria-label={t('area.searchLabel')}
                className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand/30"
              />
            </div>
          </div>

          <p className="mb-3 text-[11px] text-ink-3" aria-live="polite">
            {t('area.showingCount', {
              shown: visibleChildren.length,
              total: allChildren.length,
            })}
          </p>

          {visibleChildren.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleChildren.map((child) => (
                <AreaChildCard key={child.id} child={child} />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-slate">
              {t('area.noSearchMatch', { query })}
            </p>
          )}
        </section>
      )}

      {!isProject && allChildren.length === 0 && projects.length === 0 && (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-slate">
          {t('area.emptyNode')}
        </p>
      )}
    </div>
  );
}
