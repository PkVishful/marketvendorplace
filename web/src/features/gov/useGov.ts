import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  advanceDevOrder,
  awardGovOrder,
  closeGovBidding,
  createGovOrder,
  fetchConstructionStages,
  fetchStageUnits,
  fetchGovOrder,
  fetchGovOrders,
  fetchGovProjects,
  fetchGovVendor,
  fetchGovVendors,
  fetchProjectRequirements,
  floatGovOrder,
  generateRequirements,
  govKeys,
  registerGovVendor,
  reviewGovVendor,
  reviewGovVendorDocument,
  releaseGovPayment,
  verifyGovCertificate,
  fetchQualityDashboard,
  fetchVendorRatings,
  fetchProcurementAnalytics,
  fetchAuditChain,
  fetchAuditLog,
  fetchGovOfficers,
  fetchGovDashboardMap,
} from './api';

export function useGovProjects() {
  return useQuery({ queryKey: govKeys.projects, queryFn: fetchGovProjects });
}

export function useConstructionStages() {
  return useQuery({ queryKey: govKeys.stages, queryFn: fetchConstructionStages });
}

export function useStageUnits(stageCode: string) {
  return useQuery({
    queryKey: govKeys.stageUnits(stageCode),
    queryFn: () => fetchStageUnits(stageCode),
    enabled: Boolean(stageCode),
    select: (d) => d.units,
  });
}

export function useProjectRequirements(projectId: string) {
  return useQuery({
    queryKey: govKeys.requirements(projectId),
    queryFn: () => fetchProjectRequirements(projectId),
    enabled: Boolean(projectId),
  });
}

export function useGenerateRequirements(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { stageCode: string; quantities: Record<string, number>; requiredBy?: string }) =>
      generateRequirements(projectId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: govKeys.requirements(projectId) });
    },
  });
}

export function useGovOrders(projectId?: string) {
  return useQuery({
    queryKey: govKeys.orders(projectId),
    queryFn: () => fetchGovOrders(projectId),
  });
}

export function useGovOrder(id: string) {
  return useQuery({
    queryKey: govKeys.orderDetail(id),
    queryFn: () => fetchGovOrder(id),
    enabled: Boolean(id),
  });
}

export function useCreateGovOrder(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createGovOrder,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: govKeys.orders(projectId) });
      void qc.invalidateQueries({ queryKey: govKeys.orders() });
    },
  });
}

export function useFloatGovOrder(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, estimatedAmountPaise }: { orderId: string; estimatedAmountPaise?: number }) =>
      floatGovOrder(orderId, estimatedAmountPaise),
    onSuccess: (_data, { orderId }) => {
      void qc.invalidateQueries({ queryKey: govKeys.orders(projectId) });
      void qc.invalidateQueries({ queryKey: govKeys.orders() });
      void qc.invalidateQueries({ queryKey: govKeys.orderDetail(orderId) });
    },
  });
}

export function useCloseGovBidding(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => closeGovBidding(orderId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: govKeys.orderDetail(orderId) });
      void qc.invalidateQueries({ queryKey: govKeys.orders() });
    },
  });
}

export function useAwardGovOrder(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => awardGovOrder(orderId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: govKeys.orderDetail(orderId) });
      void qc.invalidateQueries({ queryKey: govKeys.orders() });
    },
  });
}

export function useAdvanceDevOrder(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stage: 'reveal' | 'award') => advanceDevOrder(orderId, stage),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: govKeys.orderDetail(orderId) });
      void qc.invalidateQueries({ queryKey: govKeys.orders() });
    },
  });
}

export function useGovVendors(status = 'SUBMITTED') {
  return useQuery({
    queryKey: govKeys.vendors(status),
    queryFn: () => fetchGovVendors(status),
  });
}

export function useGovVendor(id: string) {
  return useQuery({
    queryKey: govKeys.vendorDetail(id),
    queryFn: () => fetchGovVendor(id),
    enabled: Boolean(id),
  });
}

export function useRegisterGovVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: registerGovVendor,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gov', 'vendors'] });
    },
  });
}

export function useReviewGovVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      reviewGovVendor(id, decision),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ['gov', 'vendors'] });
      void qc.invalidateQueries({ queryKey: govKeys.vendorDetail(id) });
    },
  });
}

export function useReviewGovVendorDocument(vendorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      docType,
      decision,
      reason,
    }: {
      docType: string;
      decision: 'approve' | 'reject';
      reason?: string;
    }) => reviewGovVendorDocument(vendorId, docType, decision, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gov', 'vendors'] });
      void qc.invalidateQueries({ queryKey: govKeys.vendorDetail(vendorId) });
    },
  });
}

export function useVerifyGovCertificate(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { signerName?: string }) => verifyGovCertificate(orderId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: govKeys.orderDetail(orderId) });
    },
  });
}

export function useReleaseGovPayment(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { idempotencyKey: string; treasuryRef?: string; gstInvoiceNo?: string }) =>
      releaseGovPayment(orderId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: govKeys.orderDetail(orderId) });
    },
  });
}

export function useQualityDashboard(projectId?: string) {
  return useQuery({
    queryKey: govKeys.quality(projectId),
    queryFn: () => fetchQualityDashboard(projectId),
  });
}

export function useVendorRatings() {
  return useQuery({
    queryKey: govKeys.ratings,
    queryFn: fetchVendorRatings,
  });
}

export function useGovDashboardMap() {
  return useQuery({
    queryKey: govKeys.dashboardMap,
    queryFn: fetchGovDashboardMap,
  });
}

export function useProcurementAnalytics() {
  return useQuery({
    queryKey: govKeys.analytics,
    queryFn: fetchProcurementAnalytics,
  });
}

export function useAuditChain() {
  return useQuery({
    queryKey: govKeys.auditChain,
    queryFn: fetchAuditChain,
    retry: false,
  });
}

export function useAuditLog(before?: number) {
  return useQuery({
    queryKey: govKeys.audit(before),
    queryFn: () => fetchAuditLog(before),
  });
}

export function useAuditLogInfinite(enabled = true) {
  return useInfiniteQuery({
    queryKey: ['gov', 'audit', 'infinite'] as const,
    queryFn: ({ pageParam }) => fetchAuditLog(pageParam as number | undefined),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.length >= 50 ? lastPage[lastPage.length - 1]?.seq : undefined,
    enabled,
  });
}

export function useGovOfficers(enabled = true) {
  return useQuery({
    queryKey: govKeys.officers,
    queryFn: fetchGovOfficers,
    enabled,
  });
}
