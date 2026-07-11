import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { OrderStatusPill } from '@/features/orders/OrderStatusPill';
import { formatDate, formatDeadline, formatInr } from '@/lib/time';
import { useAdvanceDevOrder, useAwardGovOrder, useCloseGovBidding, useGovOrder } from './useGov';
import { GovOrderFulfillment } from './GovOrderFulfillment';

function BidStatusPill({ status }: { status: string }) {
  const tone =
    status === 'REVEALED'
      ? 'bg-good-soft text-good'
      : status === 'COMMITTED'
        ? 'bg-warn-soft text-warn'
        : status === 'FORFEITED' || status === 'DISQUALIFIED'
          ? 'bg-danger-soft text-danger'
          : 'bg-surface-2 text-ink-3';
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${tone}`}>{status}</span>
  );
}

export function GovOrderDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { data: order, isPending, isError, refetch } = useGovOrder(id);
  const award = useAwardGovOrder(id);
  const closeBidding = useCloseGovBidding(id);
  const advance = useAdvanceDevOrder(id);
  const [message, setMessage] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);

  if (isPending) return <FeedSkeleton />;

  if (isError || !order) {
    return (
      <section>
        <Link to="/gov/orders" className="text-sm font-semibold text-navy hover:underline">
          ← {t('govOrders.title')}
        </Link>
        <div className="gov-card mt-6 border-l-4 border-l-danger p-8 text-center">
          <p className="font-semibold text-danger">{t('govAward.notFound')}</p>
          <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
            {t('states.retry')}
          </button>
        </div>
      </section>
    );
  }

  const now = Date.now();
  const bidClosed = order.bidCloseAt ? new Date(order.bidCloseAt).getTime() <= now : false;
  const revealClosed = order.revealCloseAt ? new Date(order.revealCloseAt).getTime() <= now : false;
  const canDevAdvanceReveal = order.status === 'FLOATED';
  const canDevAdvanceAward = order.status === 'REVEALING' && !revealClosed;
  const canAward =
    Boolean(order.canAward) && order.status === 'REVEALING' && revealClosed && !order.award;

  async function onAward() {
    setMessage(null);
    try {
      const result = await award.mutateAsync();
      if (result.failed) {
        setMessage({ tone: 'danger', text: t('govAward.failedNoWinner') });
      } else {
        setMessage({
          tone: 'good',
          text: t('govAward.success', {
            vendor: result.vendorName,
            price: formatInr(result.pricePaise ?? 0),
          }),
        });
      }
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: err instanceof Error ? err.message : t('govAward.awardFailed'),
      });
    }
  }

  return (
    <section className="space-y-6">
      <Link to="/gov/orders" className="text-sm font-semibold text-navy hover:underline">
        ← {t('govOrders.title')}
      </Link>

      <div className="gov-card overflow-hidden">
        <div className="border-b border-hair bg-navy px-6 py-4 text-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-display text-xl font-bold">{order.milestone}</p>
              <p className="mt-1 text-sm text-white/80">
                {order.orgName} · {order.stageCode}
              </p>
            </div>
            <OrderStatusPill status={order.status} />
          </div>
        </div>
        <div className="grid gap-px bg-hair sm:grid-cols-3">
          {[
            [t('orders.bidCloses'), order.bidCloseAt ? formatDeadline(order.bidCloseAt) : '—'],
            [t('orders.revealCloses'), order.revealCloseAt ? formatDeadline(order.revealCloseAt) : '—'],
            [t('orders.requiredBy'), formatDate(order.requiredBy)],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <p className="gov-label">{label}</p>
              <p className="mt-0.5 text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </div>

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

      {order.award && (
        <div className="gov-card border-l-4 border-l-green p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-green">{t('govAward.winner')}</p>
          <p className="mt-1 font-display text-lg font-bold">{order.award.vendorName}</p>
          <p className="mt-1 text-sm text-ink-2">
            {formatInr(order.award.pricePaise)} · L1 among {order.award.qualifiedBidCount}{' '}
            {t('govAward.qualifiedBids')}
          </p>
        </div>
      )}

      {order.status === 'FLOATED' && !bidClosed && (
        <div className="gov-card border-l-4 border-l-saffron p-5">
          <p className="text-sm text-ink-2">{t('govAward.biddingOpen')}</p>
          {canDevAdvanceReveal && (
            <button
              type="button"
              className="gov-btn-secondary mt-3 text-xs"
              disabled={advance.isPending}
              onClick={() => void advance.mutateAsync('reveal')}
            >
              {t('govAward.devSkipToReveal')}
            </button>
          )}
        </div>
      )}

      {order.status === 'FLOATED' && bidClosed && (
        <div className="gov-card p-5">
          <p className="text-sm text-ink-2">{t('govAward.readyToClose')}</p>
          <button
            type="button"
            className="gov-btn-primary mt-3 text-xs"
            disabled={closeBidding.isPending}
            onClick={() => void closeBidding.mutateAsync()}
          >
            {t('govAward.closeBidding')}
          </button>
        </div>
      )}

      {order.status === 'REVEALING' && (
        <>
          <div className="gov-card overflow-hidden">
            <div className="border-b border-hair px-6 py-4">
              <h2 className="font-display text-lg font-bold">{t('govAward.bidComparison')}</h2>
              <p className="mt-1 text-sm text-ink-2">{t('govAward.bidComparisonHint')}</p>
            </div>
            {order.bids.length === 0 ? (
              <p className="p-8 text-center text-sm text-ink-3">{t('govAward.noBidsVisible')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                    <tr>
                      <th className="px-6 py-3 font-semibold">{t('govAward.colVendor')}</th>
                      <th className="px-6 py-3 font-semibold">{t('govAward.colStatus')}</th>
                      <th className="px-6 py-3 font-semibold">{t('govAward.colPrice')}</th>
                      <th className="px-6 py-3 font-semibold">{t('govAward.colCommitted')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hair">
                    {order.bids.map((b) => (
                      <tr key={b.id}>
                        <td className="px-6 py-3 font-medium">{b.vendorName}</td>
                        <td className="px-6 py-3">
                          <BidStatusPill status={b.status} />
                        </td>
                        <td className="px-6 py-3 font-mono">
                          {b.revealedPricePaise != null ? formatInr(b.revealedPricePaise) : '—'}
                        </td>
                        <td className="px-6 py-3 text-ink-3">{formatDeadline(b.committedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {canDevAdvanceAward && (
            <button
              type="button"
              className="gov-btn-secondary text-xs"
              disabled={advance.isPending}
              onClick={() => void advance.mutateAsync('award')}
            >
              {t('govAward.devSkipToAward')}
            </button>
          )}

          {canAward && (
            <div className="gov-card border-l-4 border-l-navy p-5">
              <p className="text-sm text-ink-2">{t('govAward.readyToAward')}</p>
              <button
                type="button"
                className="gov-btn-primary mt-3"
                disabled={award.isPending}
                onClick={() => void onAward()}
              >
                {award.isPending ? t('govAward.awarding') : t('govAward.awardL1')}
              </button>
            </div>
          )}

          {!order.canAward && order.status === 'REVEALING' && revealClosed && !order.award && (
            <p className="text-sm text-ink-3">{t('govAward.noAwardPermission')}</p>
          )}
        </>
      )}

      {order.status === 'AWARDED' && order.fulfillment && (
        <GovOrderFulfillment orderId={id} fulfillment={order.fulfillment} />
      )}

      <div className="gov-card p-5">
        <h3 className="font-semibold">{t('orders.itemsTitle')}</h3>
        <ul className="mt-3 space-y-2 text-sm text-ink-2">
          {order.items.map((item) => (
            <li key={item.id}>
              {item.testName}{' '}
              <span className="font-mono text-xs text-ink-3">×{item.quantity}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
