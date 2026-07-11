import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FeedSkeleton } from '@/components/Skeleton';
import { OrderStatusPill } from '@/features/orders/OrderStatusPill';
import { formatDate, formatDeadline } from '@/lib/time';
import { useFloatGovOrder, useGovOrders, useGovProjects } from './useGov';

export function GovOrdersPage() {
  const { t } = useTranslation();
  const { data: projects } = useGovProjects();
  const [projectFilter, setProjectFilter] = useState('');
  const projectId = projectFilter || undefined;
  const { data: orders, isPending, isError, refetch } = useGovOrders(projectId);
  const floatOrder = useFloatGovOrder(projectId);
  const [message, setMessage] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);

  async function onFloat(orderId: string) {
    setMessage(null);
    try {
      const row = await floatOrder.mutateAsync(orderId);
      setMessage({
        tone: 'good',
        text: t('govOrders.floatedOk', {
          close: formatDeadline(row.bidCloseAt),
        }),
      });
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: err instanceof Error ? err.message : t('govOrders.floatFailed'),
      });
    }
  }

  if (isPending) return <FeedSkeleton />;

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold">{t('govOrders.title')}</h2>
          <p className="mt-1 text-sm text-ink-2">{t('govOrders.subtitle')}</p>
        </div>
        <label className="block min-w-[14rem]">
          <span className="gov-label">{t('govOrders.filterProject')}</span>
          <select
            className="gov-input mt-1"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="">{t('govOrders.allProjects')}</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {message && (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            message.tone === 'good'
              ? 'border-good/30 bg-good-soft text-good'
              : 'border-danger/30 bg-danger-soft text-danger'
          }`}
        >
          {message.text}
        </p>
      )}

      {isError ? (
        <div className="gov-card border-l-4 border-l-danger p-6 text-center">
          <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
          <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
            {t('states.retry')}
          </button>
        </div>
      ) : (orders ?? []).length === 0 ? (
        <div className="gov-card p-10 text-center">
          <p className="font-semibold text-ink">{t('govOrders.emptyTitle')}</p>
          <p className="mt-2 text-sm text-ink-2">{t('govOrders.emptyBody')}</p>
          <Link to="/gov/planner" className="gov-btn-primary mt-4 inline-flex">
            {t('govOrders.goPlanner')}
          </Link>
        </div>
      ) : (
        <div className="gov-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-6 py-3 font-semibold">{t('govOrders.colMilestone')}</th>
                  <th className="px-6 py-3 font-semibold">{t('govOrders.colStage')}</th>
                  <th className="px-6 py-3 font-semibold">{t('govOrders.colStatus')}</th>
                  <th className="px-6 py-3 font-semibold">{t('govOrders.colItems')}</th>
                  <th className="px-6 py-3 font-semibold">{t('govOrders.colDue')}</th>
                  <th className="px-6 py-3 font-semibold">{t('govOrders.colAction')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {(orders ?? []).map((o) => (
                  <tr key={o.id}>
                    <td className="px-6 py-4">
                      <span className="font-medium text-ink">{o.milestone}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">{o.orgName}</span>
                    </td>
                    <td className="px-6 py-4 text-ink-2">{o.stageCode}</td>
                    <td className="px-6 py-4">
                      <OrderStatusPill status={o.status} />
                    </td>
                    <td className="px-6 py-4 font-mono">{o.itemCount}</td>
                    <td className="px-6 py-4">{formatDate(o.requiredBy)}</td>
                    <td className="px-6 py-4">
                      {o.status === 'DRAFT' && o.itemCount > 0 ? (
                        <button
                          type="button"
                          className="gov-btn-primary text-xs"
                          disabled={floatOrder.isPending}
                          onClick={() => void onFloat(o.id)}
                        >
                          {floatOrder.isPending ? t('govOrders.floating') : t('govOrders.float')}
                        </button>
                      ) : o.status !== 'DRAFT' ? (
                        <Link
                          to={`/gov/orders/${o.id}`}
                          className="text-xs font-semibold text-navy hover:underline"
                        >
                          {t('govOrders.viewBids')} →
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-3">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
