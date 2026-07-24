import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useFinanceOrder } from './useOversight';
import { formatPaise } from './financeModel';
import { formatDeadline } from '@/lib/time';

export function OrderFinanceDetail({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const { data: d, isPending } = useFinanceOrder(orderId);
  if (isPending || !d) return <div className="gov-card p-6 text-sm text-slate">…</div>;

  return (
    <article className="gov-card space-y-4 p-5">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">{d.milestone}</h3>
        <p className="mt-0.5 text-xs text-slate">{d.status}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rfq-meta-cell"><dt>{t('oversight.colEstimate')}</dt><dd>{formatPaise(d.estimatePaise)}</dd></div>
        <div className="rfq-meta-cell"><dt>{t('oversight.colBids')}</dt><dd>{d.bidCount}</dd></div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-ink">{t('oversight.detailBids')}</h4>
        {d.sealed ? (
          <p className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-slate">
            {t('oversight.sealed')} · {t('oversight.sealedCount', { count: d.bidCount })}
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {d.bids.map((b, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span>{b.vendorName}</span>
                <span className="tabular-nums">{formatPaise(b.pricePaise)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {d.award && (
        <div>
          <h4 className="text-sm font-semibold text-ink">{t('oversight.detailAward')}</h4>
          <p className="mt-1 flex justify-between text-sm">
            <span>{d.award.vendorName}</span>
            <span className="font-semibold tabular-nums">{formatPaise(d.award.pricePaise)}</span>
          </p>
        </div>
      )}

      {d.payment && (
        <div>
          <h4 className="text-sm font-semibold text-ink">{t('oversight.detailPayment')}</h4>
          <p className="mt-1 text-sm">
            {d.payment.status} · {formatPaise(d.payment.amountPaise)}<br />
            {d.payment.releasedAt
              ? t('oversight.releasedOn', { when: formatDeadline(d.payment.releasedAt) })
              : t('oversight.heldSince', { when: formatDeadline(d.payment.heldSince) })}
          </p>
        </div>
      )}

      {d.certificateId && (
        <Link to={`/verify/${d.certificateId}`} className="text-sm font-semibold text-brand hover:underline">
          {t('oversight.viewCertificate')} →
        </Link>
      )}
    </article>
  );
}
