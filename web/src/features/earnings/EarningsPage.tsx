import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { formatDate, formatDeadline, formatInr } from '@/lib/time';
import { useVendorEarnings } from './useEarnings';

function PaymentStatusPill({ status }: { status: string }) {
  const tone =
    status === 'RELEASED'
      ? 'bg-good-soft text-good'
      : status === 'HELD'
        ? 'bg-warn-soft text-warn'
        : 'bg-surface-2 text-ink-3';
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${tone}`}>{status}</span>
  );
}

export function EarningsPage() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useVendorEarnings();

  if (isPending) return <FeedSkeleton />;

  if (isError || !data) {
    return (
      <div className="gov-card border-l-4 border-l-danger p-8 text-center">
        <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
          {t('states.retry')}
        </button>
      </div>
    );
  }

  const { summary, payments } = data;

  return (
    <section className="space-y-6">
      <header>
        <h2 className="font-display text-xl font-bold">{t('earnings.title')}</h2>
        <p className="mt-1 text-sm text-ink-2">{t('earnings.subtitle')}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="gov-card border-l-4 border-l-warn p-5">
          <p className="gov-label">{t('earnings.held')}</p>
          <p className="mt-1 font-display text-2xl font-bold">{formatInr(Number(summary.heldPaise))}</p>
          <p className="mt-1 text-xs text-ink-3">
            {t('earnings.countHeld', { count: summary.heldCount })}
          </p>
        </div>
        <div className="gov-card border-l-4 border-l-green p-5">
          <p className="gov-label">{t('earnings.released')}</p>
          <p className="mt-1 font-display text-2xl font-bold">{formatInr(Number(summary.releasedPaise))}</p>
          <p className="mt-1 text-xs text-ink-3">
            {t('earnings.countReleased', { count: summary.releasedCount })}
          </p>
        </div>
      </div>

      {payments.length === 0 ? (
        <div className="gov-card p-10 text-center">
          <p className="font-semibold text-ink">{t('earnings.emptyTitle')}</p>
          <p className="mt-2 text-sm text-ink-2">{t('earnings.emptyBody')}</p>
          <Link to="/vendor/orders" className="gov-btn-primary mt-4 inline-flex">
            {t('nav.orders')}
          </Link>
        </div>
      ) : (
        <div className="gov-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-6 py-3 font-semibold">{t('earnings.colMilestone')}</th>
                  <th className="px-6 py-3 font-semibold">{t('earnings.colAmount')}</th>
                  <th className="px-6 py-3 font-semibold">{t('earnings.colStatus')}</th>
                  <th className="px-6 py-3 font-semibold">{t('earnings.colDate')}</th>
                  <th className="px-6 py-3 font-semibold">{t('earnings.colRef')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-6 py-4">
                      <span className="font-medium">{p.milestone}</span>
                      <span className="mt-0.5 block font-mono text-xs text-ink-3">
                        {p.orderId.slice(0, 8).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono font-semibold">{formatInr(p.amountPaise)}</td>
                    <td className="px-6 py-4">
                      <PaymentStatusPill status={p.status} />
                    </td>
                    <td className="px-6 py-4 text-ink-2">
                      {p.status === 'RELEASED' && p.releasedAt
                        ? formatDeadline(p.releasedAt)
                        : formatDate(p.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-xs text-ink-3">
                      {p.treasuryRef ?? '—'}
                      {p.gstInvoiceNo && (
                        <span className="mt-0.5 block">{p.gstInvoiceNo}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-hair px-6 py-3 text-xs text-ink-3">{t('earnings.footnote')}</p>
        </div>
      )}
    </section>
  );
}
