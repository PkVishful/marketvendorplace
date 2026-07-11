import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { JobStatusPill } from './JobStatusPill';
import { useFieldJobs } from './useJobs';
import { formatDate } from '@/lib/time';

export function JobsPage() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useFieldJobs();

  if (isPending) return <FeedSkeleton />;

  if (isError) {
    return (
      <div className="gov-card border-l-4 border-l-danger p-8 text-center">
        <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
          {t('states.retry')}
        </button>
      </div>
    );
  }

  if ((data ?? []).length === 0) {
    return (
      <div className="gov-card p-12 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-2xl text-ink-3">
          ◉
        </div>
        <p className="mt-4 font-display text-lg font-bold">{t('jobs.emptyTitle')}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">{t('jobs.emptyBody')}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {(data ?? []).map((job) => (
        <li key={job.id}>
          <Link
            to={`/vendor/jobs/${job.id}`}
            className="gov-card block border-l-4 border-l-green p-0 transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-navy"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 p-5">
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-bold text-ink">{job.milestone}</p>
                <p className="mt-1 font-mono text-xs text-ink-3">
                  {job.id.slice(0, 8).toUpperCase()} · {job.sampleCount} {t('jobs.samples')}
                </p>
              </div>
              <JobStatusPill status={job.status} />
            </div>
            <div className="grid grid-cols-2 gap-px border-t border-hair bg-hair">
              <div className="bg-surface-2 px-4 py-3">
                <p className="gov-label">{t('orders.requiredBy')}</p>
                <p className="mt-0.5 text-sm font-semibold">{formatDate(job.requiredBy)}</p>
              </div>
              <div className="bg-surface px-4 py-3">
                <p className="text-xs font-semibold text-navy">{t('jobs.viewDetail')} →</p>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
