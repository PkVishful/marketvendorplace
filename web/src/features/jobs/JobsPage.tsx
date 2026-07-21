import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { JobStatusPill } from './JobStatusPill';
import { useAcceptAward, useFieldJobs } from './useJobs';
import { formatDate } from '@/lib/time';
import type { AwaitingJob } from '@/types/domain';

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

  const jobs = data?.jobs ?? [];
  const awaiting = data?.awaiting ?? [];

  if (jobs.length === 0 && awaiting.length === 0) {
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
    <div className="flex flex-col gap-6">
      {awaiting.length > 0 && (
        <section>
          <h3 className="gov-label mb-3">{t('jobs.awaitingTitle')}</h3>
          <ul className="flex flex-col gap-3">
            {awaiting.map((a) => (
              <li key={a.orderId}>
                <AwaitingCard awaiting={a} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {jobs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
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
      )}
    </div>
  );
}

function AwaitingCard({ awaiting }: { awaiting: AwaitingJob }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accept = useAcceptAward();
  return (
    <div className="gov-card border-l-4 border-l-accent p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold text-ink">{awaiting.milestone}</p>
          <p className="mt-1 text-xs text-ink-3">
            {t('orders.requiredBy')}: {formatDate(awaiting.requiredBy)}
          </p>
        </div>
        <button
          type="button"
          className="gov-btn-primary"
          disabled={accept.isPending}
          onClick={() =>
            accept.mutate(awaiting.orderId, {
              onSuccess: (r) => navigate(`/vendor/jobs/${r.jobId}`),
            })
          }
        >
          {accept.isPending ? t('jobs.accepting') : t('jobs.acceptStart')}
        </button>
      </div>
    </div>
  );
}
