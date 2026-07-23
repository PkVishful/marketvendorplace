import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@/lib/apiClient';
import { areaKeys, fetchArea } from './api';

export function useArea(orgUnitId?: string) {
  return useQuery({
    queryKey: areaKeys.detail(orgUnitId),
    queryFn: () => fetchArea(orgUnitId),
    // 403 means "outside your area" — a deliberate answer, not a blip. Retrying
    // it just delays the friendly screen.
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 403) && failureCount < 2,
  });
}
