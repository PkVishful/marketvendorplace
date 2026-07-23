import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import { ApiError } from '@/lib/apiClient';
import { useSession } from '@/auth/useSession';
import { DistrictPerformanceMap } from '@/components/dashboard/DistrictMap';
import { useArea } from './useArea';
import { AreaBreadcrumbs } from './AreaBreadcrumbs';
import { AreaChildCard } from './AreaChildCard';
import { AreaProjectList } from './AreaProjectList';
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
  const { data: session } = useSession();
  const { data, isPending, isError, error } = useArea(orgUnitId);

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

  const { node, breadcrumbs, summary, children, projects } = data;
  const showMap = node.level === 'STATE' || node.level === 'DISTRICT';
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

      {showMap && (
        <div className="mb-5 rounded-xl border border-line bg-surface p-4">
          <DistrictPerformanceMap
            districtName={session?.roles?.[0]?.orgName}
            orgPath={session?.roles?.[0]?.orgPath}
          />
        </div>
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

      {children.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-3">
            {t('area.childrenHeading')}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((child) => (
              <AreaChildCard key={child.id} child={child} />
            ))}
          </div>
        </section>
      )}

      {!isProject && children.length === 0 && projects.length === 0 && (
        <p className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-slate">
          {t('area.emptyNode')}
        </p>
      )}
    </div>
  );
}
