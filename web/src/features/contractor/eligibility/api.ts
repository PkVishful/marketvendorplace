import { apiClient } from '@/lib/apiClient';
import type { ContractorEligibility } from '@/types/domain';

export const eligibilityKeys = {
  all: ['contractor', 'eligibility'] as const,
};

export function fetchEligibility() {
  return apiClient.get<ContractorEligibility>('/api/contractor/eligibility');
}

export function addExperience(body: {
  workName: string;
  clientName?: string;
  valuePaise: number;
  completedOn?: string | null;
}) {
  return apiClient.post<ContractorEligibility>('/api/contractor/eligibility/experience', body);
}

export function addMachinery(body: { name: string; quantity: number; capacity?: string }) {
  return apiClient.post<ContractorEligibility>('/api/contractor/eligibility/machinery', body);
}

export function addEngineer(body: { name: string; qualification?: string; role?: string }) {
  return apiClient.post<ContractorEligibility>('/api/contractor/eligibility/engineers', body);
}

export type EligibilityKind = 'experience' | 'machinery' | 'engineers';

export function deleteEligibilityRow(kind: EligibilityKind, id: string) {
  return apiClient.delete<ContractorEligibility>(`/api/contractor/eligibility/${kind}/${id}`);
}
