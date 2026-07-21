import { useQuery } from '@tanstack/react-query';
import { catalogKeys, fetchCatalogChecklist, fetchProjectChecklist } from './api';

export function useCatalogChecklist() {
  return useQuery({ queryKey: catalogKeys.checklist, queryFn: fetchCatalogChecklist });
}

export function useProjectChecklist(projectId: string) {
  return useQuery({
    queryKey: catalogKeys.projectChecklist(projectId),
    queryFn: () => fetchProjectChecklist(projectId),
    enabled: Boolean(projectId),
  });
}
