import { apiClient } from '@/lib/apiClient';

export const kycKeys = {
  onboarding: ['vendor', 'onboarding'] as const,
};

export interface KycVendorProfile {
  id: string;
  legalName: string;
  gstin: string;
  pan: string;
  address: string;
  serviceRadiusKm: number;
  nablNo: string | null;
  nablValidUntil: string | null;
  isGovtApproved: boolean;
  status: string;
  orgUnitId: string;
  districtName: string;
  lat: number;
  lng: number;
}

export interface KycDocument {
  id: string;
  docType: string;
  status: string;
  mimeType: string;
  storagePath: string;
  rejectReason?: string | null;
}

export interface KycTestOption {
  id: string;
  code: string;
  name: string;
  requiresNabl: boolean;
}

export interface KycCapability {
  testId: string;
  testCode: string;
  testName: string;
  isNablAccredited: boolean;
}

export interface KycOnboardingDTO {
  vendor: KycVendorProfile | null;
  documents: KycDocument[];
  capabilities: KycCapability[];
  tests: KycTestOption[];
}

export function fetchKycOnboarding() {
  return apiClient.get<KycOnboardingDTO>('/api/vendor/onboarding');
}

export function saveKycProfile(body: {
  legalName: string;
  gstin: string;
  pan: string;
  address: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
  nablNo?: string;
  nablValidUntil?: string;
  isGovtApproved?: boolean;
}) {
  return apiClient.post<{ id: string; status: string }>('/api/vendor/onboarding/profile', body);
}

export function uploadKycDocument(docType: string, dataUrl: string, mimeType: string) {
  return apiClient.post<KycDocument>('/api/vendor/onboarding/documents', { docType, dataUrl, mimeType });
}

export function saveKycCapabilities(testIds: string[]) {
  return apiClient.post<{ inserted: number }>('/api/vendor/onboarding/capabilities', { testIds });
}

export function submitKycOnboarding() {
  return apiClient.post<{ id: string; legalName: string; status: string }>('/api/vendor/onboarding/submit', {});
}

export function kycFileUrl(vendorId: string, docType: string) {
  return `/api/kyc/files/${vendorId}/${docType}`;
}
