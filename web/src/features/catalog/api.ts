import { apiClient } from '@/lib/apiClient';
import type { CatalogChecklist, ProjectChecklist } from '@/types/domain';

export const catalogKeys = {
  checklist: ['catalog', 'checklist'] as const,
  projectChecklist: (projectId: string) => ['catalog', 'checklist', projectId] as const,
};

export function fetchCatalogChecklist() {
  return apiClient.get<CatalogChecklist>('/api/catalog/checklist');
}

export function fetchProjectChecklist(projectId: string) {
  return apiClient.get<ProjectChecklist>(`/api/gov/projects/${projectId}/checklist`);
}
