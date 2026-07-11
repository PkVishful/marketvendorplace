import { apiClient } from '@/lib/apiClient';
import type {
  ConstructionStage,
  GovOrderDetail,
  GovOrderSummary,
  GovProject,
  GovVendorDetail,
  GovVendorSummary,
  ProjectRequirement,
  QualityDashboardDTO,
  VendorRatingRow,
  AuditLogRow,
  AuditChainStatus,
  ProcurementAnalyticsDTO,
} from '@/types/domain';

export const govKeys = {
  projects: ['gov', 'projects'] as const,
  stages: ['gov', 'stages'] as const,
  requirements: (projectId: string) => ['gov', 'requirements', projectId] as const,
  orders: (projectId?: string) => ['gov', 'orders', projectId ?? 'all'] as const,
  orderDetail: (id: string) => ['gov', 'orders', id] as const,
  vendors: (status?: string) => ['gov', 'vendors', status ?? 'SUBMITTED'] as const,
  vendorDetail: (id: string) => ['gov', 'vendors', id] as const,
  quality: (projectId?: string) => ['gov', 'quality', projectId ?? 'all'] as const,
  ratings: ['gov', 'ratings'] as const,
  analytics: ['gov', 'analytics'] as const,
  audit: (before?: number) => ['gov', 'audit', before ?? 'start'] as const,
  auditChain: ['gov', 'audit', 'chain'] as const,
};

export function fetchGovProjects() {
  return apiClient.get<GovProject[]>('/api/gov/projects');
}

export function fetchConstructionStages() {
  return apiClient.get<ConstructionStage[]>('/api/gov/stages');
}

export function fetchProjectRequirements(projectId: string) {
  return apiClient.get<ProjectRequirement[]>(`/api/gov/projects/${projectId}/requirements`);
}

export function generateRequirements(
  projectId: string,
  body: { stageCode: string; quantities: Record<string, number>; requiredBy?: string },
) {
  return apiClient.post<{ inserted: number }>(
    `/api/gov/projects/${projectId}/planner/generate`,
    body,
  );
}

export function fetchGovOrders(projectId?: string) {
  const q = projectId ? `?projectId=${projectId}` : '';
  return apiClient.get<GovOrderSummary[]>(`/api/gov/orders${q}`);
}

export function fetchGovOrder(id: string) {
  return apiClient.get<GovOrderDetail>(`/api/gov/orders/${id}`);
}

export function createGovOrder(body: {
  projectId: string;
  stageCode: string;
  milestone: string;
  requirementIds: string[];
}) {
  return apiClient.post<{ id: string; status: string; milestone: string; itemCount: number }>(
    '/api/gov/orders',
    body,
  );
}

export function floatGovOrder(orderId: string) {
  return apiClient.post<{
    id: string;
    status: string;
    floatedAt: string;
    bidCloseAt: string;
    revealCloseAt: string;
  }>(`/api/gov/orders/${orderId}/float`, {});
}

export function closeGovBidding(orderId: string) {
  return apiClient.post<{ id: string; status: string }>(`/api/gov/orders/${orderId}/close-bidding`, {});
}

export function awardGovOrder(orderId: string) {
  return apiClient.post<{
    failed: boolean;
    orderStatus?: string;
    vendorId?: string;
    vendorName?: string;
    pricePaise?: number;
    qualifiedBidCount?: number;
  }>(`/api/gov/orders/${orderId}/award`, {});
}

export function advanceDevOrder(orderId: string, stage: 'reveal' | 'award') {
  return apiClient.post<{ id: string; status: string }>(`/api/dev/orders/${orderId}/advance`, { stage });
}

export function fetchGovVendors(status = 'SUBMITTED') {
  return apiClient.get<GovVendorSummary[]>(`/api/gov/vendors?status=${status}`);
}

export function fetchGovVendor(id: string) {
  return apiClient.get<GovVendorDetail>(`/api/gov/vendors/${id}`);
}

export function reviewGovVendor(id: string, decision: 'approve' | 'reject') {
  return apiClient.post<{ id: string; legalName: string; status: string }>(
    `/api/gov/vendors/${id}/review`,
    { decision },
  );
}

export function reviewGovVendorDocument(
  vendorId: string,
  docType: string,
  decision: 'approve' | 'reject',
  reason?: string,
) {
  return apiClient.post<{ docType: string; status: string }>(
    `/api/gov/vendors/${vendorId}/documents/${docType}/review`,
    { decision, reason },
  );
}

export function verifyGovCertificate(orderId: string, body?: { signerName?: string }) {
  return apiClient.post(`/api/gov/orders/${orderId}/certificate/verify`, body ?? {});
}

export function releaseGovPayment(
  orderId: string,
  body: { idempotencyKey: string; treasuryRef?: string; gstInvoiceNo?: string },
) {
  return apiClient.post(`/api/gov/orders/${orderId}/payment/release`, body);
}

export function fetchQualityDashboard(projectId?: string) {
  const q = projectId ? `?projectId=${projectId}` : '';
  return apiClient.get<QualityDashboardDTO>(`/api/gov/quality${q}`);
}

export function fetchVendorRatings() {
  return apiClient.get<VendorRatingRow[]>('/api/gov/ratings');
}

export function fetchProcurementAnalytics() {
  return apiClient.get<ProcurementAnalyticsDTO>('/api/gov/analytics');
}

export function fetchAuditChain() {
  return apiClient.get<AuditChainStatus>('/api/gov/audit/chain');
}

export function fetchAuditLog(before?: number) {
  const q = before ? `?before=${before}` : '';
  return apiClient.get<AuditLogRow[]>(`/api/gov/audit${q}`);
}
