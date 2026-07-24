import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { FeedSkeleton } from '@/components/Skeleton';
import { Pagination } from '@/components/Pagination';
import { pageWindow } from '@/lib/pagination';
import { formatDate } from '@/lib/time';
import { HealthPill } from './HealthPill';
import { useGovProjects, useQualityDashboard } from './useGov';
import { OrderStatusPill } from '@/features/orders/OrderStatusPill';

export function QualityDashboardPage() {
  const { t } = useTranslation();
  const { data: projects } = useGovProjects();
  const [projectFilter, setProjectFilter] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const { data, isPending, isError, refetch } = useQualityDashboard(projectFilter || undefined);

  if (isPending) return <FeedSkeleton />;

  const counts = data?.counts ?? { green: 0, amber: 0, red: 0, neutral: 0 };
  // The list runs to a hundred-plus milestones; page it so the table fits a
  // screen instead of an endless scroll.
  const milestones = data?.milestones ?? [];
  const win = pageWindow({ total: milestones.length, page, pageSize: PAGE_SIZE });
  const visible = milestones.slice((win.page - 1) * PAGE_SIZE, win.page * PAGE_SIZE);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold">{t('quality.title')}</h2>
          <p className="mt-1 text-sm text-ink-2">{t('quality.subtitle')}</p>
        </div>
        <label className="block min-w-[14rem]">
          <span className="gov-label">{t('quality.filterProject')}</span>
          <select
            className="gov-input mt-1"
            value={projectFilter}
            onChange={(e) => {
              setProjectFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('quality.allProjects')}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {isError ? (
        <div className="gov-card border-l-4 border-l-danger p-6 text-center">
          <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
          <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
            {t('states.retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ['green', 'border-l-green'],
                ['amber', 'border-l-warn'],
                ['red', 'border-l-danger'],
                ['neutral', 'border-l-ink-3'],
              ] as const
            ).map(([key, border]) => (
              <div key={key} className={`gov-card border-l-4 ${border} p-4`}>
                <p className="gov-label">{t(`quality.count.${key}`)}</p>
                <p className="mt-1 font-display text-3xl font-bold">{counts[key]}</p>
              </div>
            ))}
          </div>

          {milestones.length === 0 ? (
            <div className="gov-card p-10 text-center">
              <p className="font-semibold text-ink">{t('quality.emptyTitle')}</p>
              <p className="mt-2 text-sm text-ink-2">{t('quality.emptyBody')}</p>
            </div>
          ) : (
            <div className="gov-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                    <tr>
                      <th className="px-6 py-3 font-semibold">{t('quality.colHealth')}</th>
                      <th className="px-6 py-3 font-semibold">{t('quality.colMilestone')}</th>
                      <th className="px-6 py-3 font-semibold">{t('quality.colVendor')}</th>
                      <th className="px-6 py-3 font-semibold">{t('quality.colStatus')}</th>
                      <th className="px-6 py-3 font-semibold">{t('quality.colDue')}</th>
                      <th className="px-6 py-3 font-semibold">{t('quality.colAction')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hair">
                    {visible.map((m) => (
                      <tr key={m.id}>
                        <td className="px-6 py-4">
                          <HealthPill health={m.health}>{t(`quality.health.${m.health}`)}</HealthPill>
                          {m.openEscalations > 0 && (
                            <p className="mt-1 text-[10px] font-semibold uppercase text-danger">
                              {t('quality.escalationOpen', { count: m.openEscalations })}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-medium">{m.milestone}</span>
                          <span className="mt-0.5 block text-xs text-ink-3">
                            {m.stageCode} · {m.orgName}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-ink-2">{m.vendorName ?? '—'}</td>
                        <td className="px-6 py-4">
                          <OrderStatusPill status={m.status} />
                        </td>
                        <td className="px-6 py-4">{formatDate(m.requiredBy)}</td>
                        <td className="px-6 py-4">
                          <Link
                            to={`/gov/orders/${m.id}`}
                            className="text-xs font-semibold text-navy hover:underline"
                          >
                            {t('quality.viewOrder')} →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-6 py-4">
                <Pagination
                  total={milestones.length}
                  page={win.page}
                  pageSize={PAGE_SIZE}
                  onPage={setPage}
                />
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
