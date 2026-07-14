import { apiClient } from '@/lib/apiClient';
import type { ContractorOnboardingDTO, ContractSummary } from '@/types/domain';

export const contractorKeys = {
  onboarding: ['contractor', 'onboarding'] as const,
  contracts: ['contractor', 'contracts'] as const,
};

// Contractor KYC documents — matches eworks.contractor_doc_type.
export const CONTRACTOR_DOC_TYPES = [
  'PAN',
  'GST_CERTIFICATE',
  'LICENCE',
  'ADDRESS_PROOF',
  'ID_PROOF',
  'BANK_PROOF',
] as const;

export const CONTRACTOR_REQUIRED_DOCS = ['PAN', 'GST_CERTIFICATE', 'LICENCE', 'ID_PROOF', 'BANK_PROOF'];

export function fetchContractorOnboarding() {
  return apiClient.get<ContractorOnboardingDTO>('/api/contractor/onboarding');
}

export function saveContractorProfile(body: {
  legalName: string;
  gstin: string;
  pan: string;
  address: string;
  licenceClass: string;
  licenceNo: string;
}) {
  return apiClient.post<{ id: string; status: string }>('/api/contractor/onboarding/profile', body);
}

export function uploadContractorDocument(docType: string, dataUrl: string, mimeType: string) {
  return apiClient.post<{ docType: string; status: string }>('/api/contractor/onboarding/documents', {
    docType,
    dataUrl,
    mimeType,
  });
}

export function submitContractorOnboarding() {
  return apiClient.post<{ id: string; legalName: string; status: string }>('/api/contractor/onboarding/submit', {});
}

export function contractorFileUrl(contractorId: string, docType: string) {
  return `/api/contractor/files/${contractorId}/${docType}`;
}

export function fetchContractorContracts() {
  return apiClient.get<ContractSummary[]>('/api/contractor/contracts');
}

export function bidOnContract(contractId: string, amountPaise: number) {
  return apiClient.post<{ id: string; amountPaise: number }>(
    `/api/contractor/contracts/${contractId}/bid`,
    { amountPaise },
  );
}
