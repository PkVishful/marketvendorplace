import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bidOnContract,
  contractorKeys,
  fetchContractorContracts,
  fetchContractorOnboarding,
  saveContractorProfile,
  submitContractorOnboarding,
  uploadContractorDocument,
} from './api';

export function useContractorOnboarding() {
  return useQuery({
    queryKey: contractorKeys.onboarding,
    queryFn: fetchContractorOnboarding,
  });
}

export function useSaveContractorProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveContractorProfile,
    onSuccess: () => void qc.invalidateQueries({ queryKey: contractorKeys.onboarding }),
  });
}

export function useUploadContractorDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docType, dataUrl, mimeType }: { docType: string; dataUrl: string; mimeType: string }) =>
      uploadContractorDocument(docType, dataUrl, mimeType),
    onSuccess: () => void qc.invalidateQueries({ queryKey: contractorKeys.onboarding }),
  });
}

export function useSubmitContractor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitContractorOnboarding,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: contractorKeys.onboarding });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useContractorContracts() {
  return useQuery({
    queryKey: contractorKeys.contracts,
    queryFn: fetchContractorContracts,
  });
}

export function useBidOnContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ contractId, amountPaise }: { contractId: string; amountPaise: number }) =>
      bidOnContract(contractId, amountPaise),
    onSuccess: () => void qc.invalidateQueries({ queryKey: contractorKeys.contracts }),
  });
}

// Reuse the vendor KYC file→dataURL helper so both wizards behave identically.
export async function fileToDataUrl(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: String(reader.result), mimeType: file.type || 'image/jpeg' });
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
