import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { formatDeadline } from '@/lib/time';
import { useFloatGovOrder, useGovOrders, useGovProjects } from './useGov';
import { RfqPipelineView } from './rfq/RfqPipelineView';

export function GovOrdersPage() {
  const { t } = useTranslation();
  const { data: projects } = useGovProjects();
  const [projectFilter, setProjectFilter] = useState('');
  const projectId = projectFilter || undefined;
  const { data: orders, isPending, isError, refetch } = useGovOrders(projectId);
  const floatOrder = useFloatGovOrder(projectId);
  const [message, setMessage] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);

  async function onFloat(orderId: string, estimatedAmountPaise?: number) {
    setMessage(null);
    try {
      const row = await floatOrder.mutateAsync({ orderId, estimatedAmountPaise });
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

  if (isError) {
    return (
      <section className="rfq-pipeline space-y-6">
        <div className="gov-card border-l-4 border-l-danger p-6 text-center">
          <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
          <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
            {t('states.retry')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <RfqPipelineView
      orders={orders ?? []}
      projects={projects ?? []}
      projectFilter={projectFilter}
      onProjectFilterChange={setProjectFilter}
      message={message}
      floatPending={floatOrder.isPending}
      onFloat={(id, est) => void onFloat(id, est)}
    />
  );
}
