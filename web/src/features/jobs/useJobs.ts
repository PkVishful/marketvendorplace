import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustodyEvent } from '@/types/domain';
import {
  acceptAward,
  advanceDevJob,
  bindSample,
  checkInToJob,
  fetchFieldJob,
  fetchFieldJobs,
  jobKeys,
  recordCustody,
  recordTestResult,
  uploadJobCertificate,
} from './api';

export function useFieldJobs() {
  return useQuery({ queryKey: jobKeys.all, queryFn: fetchFieldJobs });
}

export function useAcceptAward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acceptAward,
    onSuccess: (_data, orderId) => {
      void qc.invalidateQueries({ queryKey: jobKeys.all });
      void qc.invalidateQueries({ queryKey: ['vendor-orders', orderId] });
    },
  });
}

export function useFieldJob(id: string) {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: () => fetchFieldJob(id),
    enabled: Boolean(id),
  });
}

export function useCheckIn(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: checkInToJob.bind(null, jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
      void qc.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}

export function useBindSample(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: bindSample.bind(null, jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
      void qc.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}

export function useRecordCustody(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { qrCode: string; event: CustodyEvent; lat?: number; lon?: number; deviceId?: string }) =>
      recordCustody(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
    },
  });
}

export function useRecordTestResult(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: recordTestResult,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
    },
  });
}

export function useUploadCertificate(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: uploadJobCertificate.bind(null, jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
    },
  });
}

export function useAdvanceDevJob(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => advanceDevJob(jobId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
    },
  });
}
