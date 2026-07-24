import { useQuery } from '@tanstack/react-query';
import { fetchPublicTender, fetchPublicTenders, publicTenderKeys } from './api';

export function usePublicTenders() {
  return useQuery({
    queryKey: publicTenderKeys.board,
    queryFn: fetchPublicTenders,
  });
}

export function usePublicTender(noticeId: string) {
  return useQuery({
    queryKey: publicTenderKeys.detail(noticeId),
    queryFn: () => fetchPublicTender(noticeId),
    enabled: Boolean(noticeId),
  });
}
