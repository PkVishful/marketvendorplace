import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchKycOnboarding,
  kycKeys,
  saveKycCapabilities,
  saveKycProfile,
  submitKycOnboarding,
  uploadKycDocument,
} from './api';

export function useKycOnboarding() {
  return useQuery({
    queryKey: kycKeys.onboarding,
    queryFn: fetchKycOnboarding,
  });
}

export function useSaveKycProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveKycProfile,
    onSuccess: () => void qc.invalidateQueries({ queryKey: kycKeys.onboarding }),
  });
}

export function useUploadKycDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docType, dataUrl, mimeType }: { docType: string; dataUrl: string; mimeType: string }) =>
      uploadKycDocument(docType, dataUrl, mimeType),
    onSuccess: () => void qc.invalidateQueries({ queryKey: kycKeys.onboarding }),
  });
}

export function useSaveKycCapabilities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (testIds: string[]) => saveKycCapabilities(testIds),
    onSuccess: () => void qc.invalidateQueries({ queryKey: kycKeys.onboarding }),
  });
}

export function useSubmitKyc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitKycOnboarding,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: kycKeys.onboarding });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export async function fileToDataUrl(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: String(reader.result), mimeType: file.type || 'image/jpeg' });
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
