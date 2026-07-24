import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchGovTender,
  govTenderKeys,
  issueTenderCorrigendum,
  publishTenderNotice,
  recordSanction,
  saveTenderNotice,
  type TenderNoticeInput,
} from './api';

export function useGovTender(contractId: string) {
  return useQuery({
    queryKey: govTenderKeys.detail(contractId),
    queryFn: () => fetchGovTender(contractId),
    enabled: Boolean(contractId),
  });
}

export function useRecordSanction(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { amountPaise: number; orderNo: string }) => recordSanction(contractId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: govTenderKeys.detail(contractId) }),
  });
}

export function useSaveTenderNotice(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TenderNoticeInput) => saveTenderNotice(contractId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: govTenderKeys.detail(contractId) }),
  });
}

export function usePublishTenderNotice(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => publishTenderNotice(contractId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: govTenderKeys.detail(contractId) }),
  });
}

export function useIssueTenderCorrigendum(contractId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { summary: string; changes?: Record<string, unknown> }) =>
      issueTenderCorrigendum(contractId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: govTenderKeys.detail(contractId) }),
  });
}
