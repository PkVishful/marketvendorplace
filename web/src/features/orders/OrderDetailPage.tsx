import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { BidPanel } from './BidPanel';
import { OrderStatusPill } from './OrderStatusPill';
import { useVendorOrder } from './useOrders';
import { formatDate, formatDeadline } from '@/lib/time';

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { data: order, isPending, isError, refetch } = useVendorOrder(id);

  if (isPending) return <FeedSkeleton />;

  if (isError || !order) {
    return (
      <section>
        <Link to="/vendor/orders" className="text-sm font-semibold text-navy hover:underline">
          ← {t('orders.title')}
        </Link>
        <div className="gov-card mt-6 border-l-4 border-l-danger p-8 text-center">
          <p className="font-display text-lg font-bold text-danger">{t('orders.notFoundTitle')}</p>
          <p className="mt-2 text-sm text-ink-2">{t('orders.notFoundBody')}</p>
          <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
            {t('states.retry')}
          </button>
        </div>
      </section>
    );
  }

  const stats: [string, string][] = [
    [t('orders.requiredBy'), formatDate(order.requiredBy)],
    [t('orders.evalMethod'), order.evalMethod],
    [t('orders.bidCloses'), order.bidCloseAt ? formatDeadline(order.bidCloseAt) : '—'],
    [t('orders.revealCloses'), order.revealCloseAt ? formatDeadline(order.revealCloseAt) : '—'],
    [t('orders.site'), `${order.lat.toFixed(4)}°, ${order.lng.toFixed(4)}°`],
    [t('orders.floatedAt'), order.floatedAt ? formatDeadline(order.floatedAt) : '—'],
  ];

  return (
    <section>
      <Link to="/vendor/orders" className="text-sm font-semibold text-navy hover:underline">
        ← {t('orders.title')}
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-ink-3">{order.id.slice(0, 8).toUpperCase()}</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">{order.milestone}</h2>
          <p className="mt-1 text-sm text-ink-2">{order.orgName}</p>
        </div>
        <OrderStatusPill status={order.status} />
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(([label, value]) => (
          <div key={label} className="gov-stat">
            <dt className="gov-label">{label}</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <BidPanel order={order} />
      </div>

      <h3 className="gov-label mt-8">{t('orders.itemsTitle')}</h3>
      <ul className="mt-3 flex flex-col gap-2">
        {order.items.map((item) => (
          <li key={item.id} className="gov-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{item.testName}</p>
                <p className="mt-0.5 font-mono text-xs text-ink-3">
                  {item.testCode}
                  {item.isCode ? ` · ${item.isCode}` : ''}
                </p>
              </div>
              <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-bold text-ink-2">
                ×{item.quantity}
              </span>
            </div>
            {item.requiresNabl && (
              <p className="mt-2 text-xs font-semibold text-warn">{t('orders.nablRequired')}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
