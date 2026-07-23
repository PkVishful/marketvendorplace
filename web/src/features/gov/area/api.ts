import { apiClient } from '@/lib/apiClient';
import type { OrgLevel } from '@/types/domain';
import type { RegionKpis } from '@/components/dashboard/districtMaps/types';

export interface AreaNode {
  id: string;
  name: string;
  level: OrgLevel;
  path: string;
}

export interface AreaCrumb {
  id: string;
  name: string;
  level: OrgLevel;
  /** False for crumbs above the caller's own anchor — context, not a link. */
  inScope: boolean;
}

export interface AreaSummary {
  openOrders: number;
  activeJobs: number;
  failedTests30d: number;
  certificates30d: number;
  pendingApprovals: number;
  qualityScore: number | null;
}

export interface AreaChild {
  id: string;
  name: string;
  score: number | null;
  kpis: RegionKpis;
}

export interface AreaProject {
  id: string;
  name: string;
  requiredTests: number;
  certifiedTests: number;
  openOrders: number;
}

export interface AreaDTO {
  node: AreaNode;
  requestedId: string;
  /** Nodes the single-child collapse walked through to reach `node`. */
  skipped: Array<{ id: string; name: string; level: OrgLevel }>;
  breadcrumbs: AreaCrumb[];
  summary: AreaSummary;
  children: AreaChild[];
  projects: AreaProject[];
}

export const areaKeys = {
  detail: (id?: string) => ['gov', 'area', id ?? 'self'] as const,
};

// No id means "my own anchor" — the BFF resolves the caller's most senior gov
// org unit, so the client never needs to know its own node id.
export function fetchArea(orgUnitId?: string) {
  return apiClient.get<AreaDTO>(`/api/gov/area${orgUnitId ? `/${orgUnitId}` : ''}`);
}
