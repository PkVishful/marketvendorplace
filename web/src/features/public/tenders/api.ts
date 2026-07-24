import { apiClient } from '@/lib/apiClient';
import type { PublicTenderDetailResponse, TenderBoardRow } from '@/types/domain';

export const publicTenderKeys = {
  board: ['public', 'tenders'] as const,
  detail: (noticeId: string) => ['public', 'tenders', noticeId] as const,
};

export function fetchPublicTenders() {
  return apiClient.get<TenderBoardRow[]>('/api/public/tenders');
}

export function fetchPublicTender(noticeId: string) {
  return apiClient.get<PublicTenderDetailResponse>(`/api/public/tenders/${noticeId}`);
}
