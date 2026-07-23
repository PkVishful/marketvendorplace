export type TalukaPerformance = 'strong' | 'watch' | 'attention';

export interface TalukaHotspot {
  /** Rectangle in map viewBox coordinates (for raster map overlays) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TalukaDetailStats {
  activeProjects: number;
  openRfqs: number;
  labsEngaged: number;
  pendingTests: number;
  sectionEngineer: string;
  blockOffice: string;
  recentProjects: string[];
}

/** Live counts for one region, as returned by GET /api/gov/dashboard/map. */
export interface RegionKpis {
  openOrders: number;
  activeJobs: number;
  failedTests30d: number;
  certificates30d: number;
  vendorsActive: number;
}

export interface TalukaRegion {
  id: string;
  name: string;
  /** SVG path `d` attribute — not required when the district uses a raster map image */
  path?: string;
  /** Click target on raster maps — same coordinate space as viewBox */
  hotspot?: TalukaHotspot;
  /** Brand color for this taluka (matches map region) */
  color: string;
  labelX?: number;
  labelY?: number;
  labelLine2?: string;
  labelLine2Y?: number;
  /** Performance KPI 0–100. Undefined means the endpoint reported no data. */
  score?: number;
  performance?: TalukaPerformance;
  /** Drill-down stats shown when the taluk is selected */
  details?: TalukaDetailStats;
  /** Live counts, present once merged with the dashboard map endpoint */
  kpis?: RegionKpis;
  /** org_units.id for this region — the registry `id` is a layout key, not a row id */
  liveId?: string;
}

export interface DistrictMapDefinition {
  key: string;
  name: string;
  viewBox: string;
  talukas: TalukaRegion[];
  /** Official map image (PNG/SVG) — used instead of hand-drawn paths */
  imageSrc?: string;
  /** Hide the built-in map title when the image already includes branding */
  hideMapHeader?: boolean;
  /** Label under the title: talukas (district view) or districts (state view) */
  regionKind?: 'talukas' | 'districts';
}

export function performanceFromScore(score: number): TalukaPerformance {
  if (score >= 80) return 'strong';
  if (score >= 65) return 'watch';
  return 'attention';
}

export const PERFORMANCE_COLORS: Record<TalukaPerformance, string> = {
  strong: '#1e8e5a',
  watch: '#e0a02d',
  attention: '#c0392b',
};
