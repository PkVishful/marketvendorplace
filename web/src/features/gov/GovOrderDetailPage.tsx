import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { formatInr } from '@/lib/time';
import { useAdvanceDevOrder, useAwardGovOrder, useCloseGovBidding, useGovOrder } from './useGov';
import { GovOrderFulfillment } from './GovOrderFulfillment';
import { buildRfqDetailViewModel } from './rfq/rfqDetailModel';
import { RfqDetailView } from './rfq/RfqDetailView';

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
        <Link to="/gov/orders" className="text-sm font-semibold text-brand hover:underline">
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

  const vm = buildRfqDetailViewModel(order);
  const now = Date.now();
  const bidClosed = order.bidCloseAt ? new Date(order.bidCloseAt).getTime() <= now : false;
  const revealClosed = order.revealCloseAt ? new Date(order.revealCloseAt).getTime() <= now : false;
  const canAward =
    Boolean(order.canAward) && order.status === 'REVEALING' && revealClosed && !order.award;
  const canCloseBidding = order.status === 'FLOATED' && bidClosed;

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
    <>
      <RfqDetailView
        order={order}
        vm={vm}
        message={message}
        canAward={canAward}
        canCloseBidding={canCloseBidding}
        awardPending={award.isPending}
        closePending={closeBidding.isPending}
        onAward={() => void onAward()}
        onCloseBidding={() => void closeBidding.mutateAsync()}
      />

      {import.meta.env.DEV && order.status === 'FLOATED' && !bidClosed && (
        <div className="mt-4">
          <button
            type="button"
            className="gov-btn-secondary text-xs"
            disabled={advance.isPending}
            onClick={() => void advance.mutateAsync('reveal')}
          >
            {t('govAward.devSkipToReveal')}
          </button>
        </div>
      )}

      {order.status === 'AWARDED' && order.fulfillment && (
        <div className="mt-6">
          <GovOrderFulfillment orderId={id} fulfillment={order.fulfillment} />
        </div>
      )}
    </>
  );
}
