import { apiClient } from '@/lib/apiClient';
import type { GovTenderView } from '@/types/domain';

export const govTenderKeys = {
  detail: (contractId: string) => ['gov', 'tender', contractId] as const,
};

export function fetchGovTender(contractId: string) {
  return apiClient.get<GovTenderView>(`/api/gov/tenders/${contractId}`);
}

export function recordSanction(contractId: string, body: { amountPaise: number; orderNo: string }) {
  return apiClient.post<GovTenderView>(`/api/gov/tenders/${contractId}/sanction`, body);
}

export interface TenderNoticeCriterionInput {
  label: string;
  description?: string;
  kind?: string;
}

export interface TenderNoticeInput {
  noticeNo: string;
  scopeSummary: string;
  estimatedValuePaise: number;
  completionPeriodDays: number;
  emdAmountPaise?: number;
  publishAt?: string | null;
  queryDeadlineAt?: string | null;
  submissionCloseAt?: string | null;
  technicalOpeningAt?: string | null;
  financialOpeningAt?: string | null;
  criteria?: TenderNoticeCriterionInput[];
}

export function saveTenderNotice(contractId: string, body: TenderNoticeInput) {
  return apiClient.post<GovTenderView>(`/api/gov/tenders/${contractId}/notice`, body);
}

export function publishTenderNotice(contractId: string) {
  return apiClient.post<GovTenderView>(`/api/gov/tenders/${contractId}/notice/publish`, {});
}

export function issueTenderCorrigendum(
  contractId: string,
  body: { summary: string; changes?: Record<string, unknown> },
) {
  return apiClient.post<GovTenderView>(`/api/gov/tenders/${contractId}/notice/corrigendum`, body);
}
