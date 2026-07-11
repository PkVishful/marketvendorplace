import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { formatDate } from '@/lib/time';
import { useProcurementAnalytics } from './useGov';

function formatInr(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function AnalyticsPage() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useProcurementAnalytics();

  if (isPending) return <FeedSkeleton />;

  if (isError || !data) {
    return (
      <div className="gov-card border-l-4 border-l-danger p-6 text-center">
        <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
          {t('states.retry')}
        </button>
      </div>
    );
  }

  const { totals, ordersByStatus, recentAwards } = data;

  const kpiCards = [
    { label: t('analytics.kpi.floated'), value: totals.floated, accent: 'border-l-navy' },
    { label: t('analytics.kpi.awarded'), value: totals.awarded, accent: 'border-l-green' },
    { label: t('analytics.kpi.bids'), value: totals.bidsSubmitted, accent: 'border-l-saffron' },
    {
      label: t('analytics.kpi.held'),
      value: formatInr(totals.paymentsHeldPaise),
      accent: 'border-l-warn',
    },
    {
      label: t('analytics.kpi.released'),
      value: formatInr(totals.paymentsReleasedPaise),
      accent: 'border-l-green',
    },
    { label: t('analytics.kpi.escalations'), value: totals.openEscalations, accent: 'border-l-danger' },
  ];

  return (
    <section className="space-y-6">
      <header>
        <h2 className="font-display text-xl font-bold">{t('analytics.title')}</h2>
        <p className="mt-1 text-sm text-ink-2">{t('analytics.subtitle')}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kpiCards.map((k) => (
          <div key={k.label} className={`gov-card border-l-4 ${k.accent} p-4`}>
            <p className="gov-label">{k.label}</p>
            <p className="mt-1 font-display text-2xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="gov-card overflow-hidden">
          <div className="border-b border-hair px-6 py-4">
            <h3 className="font-semibold text-ink">{t('analytics.ordersByStatus')}</h3>
          </div>
          {ordersByStatus.length === 0 ? (
            <p className="p-6 text-sm text-ink-2">{t('analytics.emptyOrders')}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-6 py-3 font-semibold">{t('analytics.colStatus')}</th>
                  <th className="px-6 py-3 font-semibold text-right">{t('analytics.colCount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {ordersByStatus.map((row) => (
                  <tr key={row.status}>
                    <td className="px-6 py-3 font-medium">{row.status.replace(/_/g, ' ')}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="gov-card overflow-hidden">
          <div className="border-b border-hair px-6 py-4">
            <h3 className="font-semibold text-ink">{t('analytics.recentAwards')}</h3>
          </div>
          {recentAwards.length === 0 ? (
            <p className="p-6 text-sm text-ink-2">{t('analytics.emptyAwards')}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-6 py-3 font-semibold">{t('analytics.colMilestone')}</th>
                  <th className="px-6 py-3 font-semibold">{t('analytics.colLab')}</th>
                  <th className="px-6 py-3 font-semibold text-right">{t('analytics.colPrice')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {recentAwards.map((a) => (
                  <tr key={`${a.orderId}-${a.awardedAt}`}>
                    <td className="px-6 py-3">
                      <span className="font-medium">{a.milestone}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">{formatDate(a.awardedAt)}</span>
                    </td>
                    <td className="px-6 py-3 text-ink-2">{a.vendorName}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{formatInr(a.pricePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="text-xs text-ink-3">{t('analytics.footnote')}</p>
    </section>
  );
}
