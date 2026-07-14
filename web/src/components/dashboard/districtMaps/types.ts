export type TalukaPerformance = 'strong' | 'watch' | 'attention';

export interface TalukaRegion {
  id: string;
  name: string;
  /** SVG path `d` attribute — not required when the district uses a raster map image */
  path?: string;
  /** Brand color for this taluka (matches map region) */
  color: string;
  labelX?: number;
  labelY?: number;
  labelLine2?: string;
  labelLine2Y?: number;
  /** Performance KPI 0–100 */
  score?: number;
  performance?: TalukaPerformance;
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
