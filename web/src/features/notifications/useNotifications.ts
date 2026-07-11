import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NotificationDTO } from '@/types/domain';
import { fetchNotifications, markNotificationRead } from './api';

export const NOTIFICATIONS_KEY = ['notifications'] as const;

export function useNotifications(options?: { enabled?: boolean }) {
  return useQuery<NotificationDTO[]>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: fetchNotifications,
    enabled: options?.enabled ?? true,
  });
}

export function unreadCount(list: NotificationDTO[] | undefined): number {
  return (list ?? []).filter((n) => n.readAt === null).length;
}

interface MarkReadContext {
  previous?: NotificationDTO[];
}

// Optimistic mark-as-read: the row updates instantly and the unread badge
// follows; on error we roll back to the pre-mutation snapshot.
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation<{ updated: number }, Error, string, MarkReadContext>({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = qc.getQueryData<NotificationDTO[]>(NOTIFICATIONS_KEY);
      qc.setQueryData<NotificationDTO[]>(NOTIFICATIONS_KEY, (old) =>
        (old ?? []).map((n) =>
          n.id === id && n.readAt === null
            ? { ...n, readAt: new Date().toISOString() }
            : n,
        ),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(NOTIFICATIONS_KEY, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    },
  });
}
