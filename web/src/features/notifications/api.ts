import { apiClient } from '@/lib/apiClient';
import type { NotificationDTO } from '@/types/domain';

// RLS-scoped by the BFF to the signed-in vendor (or an auditor). The client
// does not — and must not — re-filter by user id beyond what RLS returns.
export function fetchNotifications(): Promise<NotificationDTO[]> {
  return apiClient.get<NotificationDTO[]>('/api/notifications');
}

// Sets read_at on the vendor's own row only. The read_at-only column grant and
// the row policy are what enforce that server-side; this is just the call.
export function markNotificationRead(id: string): Promise<{ updated: number }> {
  return apiClient.post<{ updated: number }>(`/api/notifications/${id}/read`);
}
