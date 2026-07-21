import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { FeedSkeleton } from '@/components/Skeleton';
import type { ProjectChecklistRow, ProjectChecklistStage } from '@/types/domain';
import { useGovProjects } from './useGov';
import { useProjectChecklist } from '@/features/catalog/useCatalog';

/**
 * Live per-project checklist — all 9 construction levels, showing which required
 * tests are certified, ordered, or still missing, with deep links to the order
 * or job behind each row. Printable as a "site copy" (☑ / ☐ / ✗).
 */
export function ProjectChecklistPage() {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  const { data: projects } = useGovProjects();
  const { data, isPending, isError, refetch } = useProjectChecklist(projectId);
  const project = projects?.find((p) => p.id === projectId);

  if (isPending) return <FeedSkeleton />;

  if (isError) {
    return (
      <section className="gov-card border-l-4 border-l-danger p-4">
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary">
          {t('states.retry')}
        </button>
      </section>
    );
  }

  const stages = data?.stages ?? [];
  const totalDone = stages.reduce((n, s) => n + s.certifiedCount, 0);
  const total = stages.reduce((n, s) => n + s.totalCount, 0);
  const plannedLevels = stages.filter((s) => s.planned).length;

  return (
    <section className="print-sheet space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/gov/planner" className="text-sm font-semibold text-navy hover:underline">
          ← {t('planner.title')}
        </Link>
        <button type="button" onClick={() => window.print()} className="gov-btn-primary">
          {t('checklist.print')}
        </button>
      </div>

      <header>
        <h2 className="font-display text-xl font-bold text-ink">{t('checklist.title')}</h2>
        <p className="text-sm text-ink-2">{project ? `${project.name} · ${project.code}` : projectId}</p>
      </header>

      <div className="gov-card p-4">
        <p className="text-sm font-semibold text-ink">
          {t('checklist.summary', { done: totalDone, total, stages: plannedLevels })}
        </p>
      </div>

      {stages.map((stage, i) => (
        <StageCard key={stage.code} stage={stage} index={i} projectId={projectId} />
      ))}
    </section>
  );
}

function StageCard({
  stage, index, projectId,
}: {
  stage: ProjectChecklistStage;
  index: number;
  projectId: string;
}) {
  const { t } = useTranslation();
  const pct = stage.totalCount > 0 ? Math.round((stage.certifiedCount / stage.totalCount) * 100) : 0;
  return (
    <div className="gov-card p-4" style={{ breakInside: 'avoid' }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-base font-bold text-ink">{index + 1}. {stage.name}</h3>
        {stage.planned && (
          <span className="text-xs font-semibold text-ink-3">
            {t('checklist.progress', { done: stage.certifiedCount, total: stage.totalCount })}
          </span>
        )}
      </div>
      {stage.planned ? (
        <>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-hair">
            <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-3 divide-y divide-hair">
            {stage.rows.map((r) => <ChecklistRow key={r.requirementId} row={r} />)}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-3">
          {t('checklist.notPlanned')} ·{' '}
          <Link
            to={`/gov/planner?projectId=${projectId}&stage=${stage.code}`}
            className="text-navy hover:underline"
          >
            {t('checklist.planThisLevel')}
          </Link>
        </p>
      )}
    </div>
  );
}

function ChecklistRow({ row }: { row: ProjectChecklistRow }) {
  const { t } = useTranslation();
  const done = row.status === 'CERTIFIED';
  const failed = row.status === 'FAILED';
  return (
    <li className="flex items-start gap-3 py-2">
      <input
        type="checkbox" checked={done} readOnly
        aria-label={`${row.testName}: ${t(`checklist.status.${row.status}`)}`}
        className="mt-0.5 h-4 w-4"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          {row.testName} <span className="font-mono text-xs font-normal text-ink-3">{row.testCode}</span>
        </p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span>{t('checklist.samples', { count: row.plannedCount })}</span>
          {failed ? (
            <span className="chip chip-danger">{t('checklist.status.FAILED')}</span>
          ) : (
            <span>{t(`checklist.status.${row.status}`)}</span>
          )}
          {row.orderId && (
            <Link to={`/gov/orders/${row.orderId}`} className="text-navy hover:underline">
              {failed ? t('checklist.retestTrail') : t('checklist.viewOrder')}
            </Link>
          )}
        </p>
      </div>
    </li>
  );
}
