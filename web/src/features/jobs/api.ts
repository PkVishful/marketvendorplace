import { apiClient } from '@/lib/apiClient';
import type { CustodyEvent, FieldJobDetail, FieldJobsResponse } from '@/types/domain';

export const jobKeys = {
  all: ['vendor', 'jobs'] as const,
  detail: (id: string) => ['vendor', 'jobs', id] as const,
};

export function fetchFieldJobs() {
  return apiClient.get<FieldJobsResponse>('/api/vendor/jobs');
}

export function fetchFieldJob(id: string) {
  return apiClient.get<FieldJobDetail>(`/api/vendor/jobs/${id}`);
}

export function acceptAward(orderId: string) {
  return apiClient.post<{ jobId: string; status: string }>(`/api/vendor/orders/${orderId}/accept`, {});
}

export function checkInToJob(
  jobId: string,
  body: {
    lat: number;
    lon: number;
    accuracyM: number;
    photo: string;
    deviceId: string;
    reportedAt?: string;
  },
) {
  return apiClient.post<{ id: string; distanceM: number }>(`/api/vendor/jobs/${jobId}/check-in`, body);
}

export function checkinPhotoUrl(jobId: string) {
  return `/api/vendor/jobs/${jobId}/checkin-photo`;
}

export function bindSample(
  jobId: string,
  body: { testCode: string; qrCode: string; specimenNo: number; testAgeDays?: number },
) {
  return apiClient.post(`/api/vendor/jobs/${jobId}/samples`, body);
}

export function recordCustody(body: {
  qrCode: string;
  event: CustodyEvent;
  lat?: number;
  lon?: number;
  deviceId?: string;
}) {
  return apiClient.post(`/api/vendor/custody`, body);
}

export function recordTestResult(body: {
  qrCode: string;
  measurements: Record<string, number>;
}) {
  return apiClient.post<{
    id: string;
    passed: boolean;
    isProvisional: boolean;
    metric: string;
    metricValue: number;
    thresholdMin: number | null;
  }>('/api/vendor/results', body);
}

export function uploadJobCertificate(jobId: string, body: { storagePath: string; sha256: string }) {
  return apiClient.post(`/api/vendor/jobs/${jobId}/certificate`, body);
}

export function advanceDevJob(jobId: string) {
  return apiClient.post<{ id: string; status: string; qrCode: string }>(`/api/dev/jobs/${jobId}/advance`, {});
}
