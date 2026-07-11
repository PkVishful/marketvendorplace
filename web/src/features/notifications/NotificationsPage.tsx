import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { NotificationDTO } from '@/types/domain';
import { hasLiveOrder } from '@/types/domain';
import { FeedSkeleton } from '@/components/Skeleton';
import { UnreadBadge } from './UnreadBadge';
import { NotificationRow } from './NotificationRow';
import { useNotifications, useMarkRead, unreadCount } from './useNotifications';

export function NotificationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isPending, isError, refetch, isFetching } = useNotifications();
  const markRead = useMarkRead();

  function onOpen(n: NotificationDTO) {
    if (n.readAt === null) markRead.mutate(n.id);
    // Live order → navigate. Dead link or vendor-subject → stay put.
    if (hasLiveOrder(n)) navigate(`/vendor/orders/${n.orderId}`);
  }

  const unread = unreadCount(data);

  return (
    <section>
      <header className="mb-4 flex items-center gap-3">
        <h2 className="font-display text-xl font-bold">{t('feed.title')}</h2>
        <UnreadBadge count={unread} />
        {isFetching && !isPending && (
          <span className="ml-auto text-xs text-ink-3" role="status">
            {t('states.loading')}
          </span>
        )}
      </header>

      {isPending ? (
        <FeedSkeleton />
      ) : isError ? (
        <div className="gov-card border-l-4 border-l-danger p-6 text-center">
          <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
          <p className="mt-1 text-sm text-ink-2">{t('states.errorBody')}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="gov-btn-secondary mt-4"
          >
            {t('states.retry')}
          </button>
        </div>
      ) : (data ?? []).length === 0 ? (
        <div className="gov-card p-12 text-center">
          <div className="text-3xl text-ink-3" aria-hidden="true">◔</div>
          <p className="mt-3 font-semibold text-ink">{t('states.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-3">{t('states.emptyBody')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {(data ?? []).map((n) => (
            <NotificationRow key={n.id} notification={n} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}
