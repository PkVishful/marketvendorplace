import type { DistrictMapDefinition, TalukaRegion } from './types';
import { performanceFromScore } from './types';

/** Taluka KPI metadata — colors match the official Coimbatore district map asset. */
const talukas: TalukaRegion[] = [
  { id: 'mettupalayam', name: 'Mettupalayam', color: '#e63946', score: 86 },
  { id: 'coimbatore-north', name: 'Coimbatore North', color: '#9b1b6b', score: 91 },
  { id: 'sulur', name: 'Sulur', color: '#00acc1', score: 84 },
  { id: 'coimbatore-south', name: 'Coimbatore South', color: '#f5a623', score: 88 },
  { id: 'pollachi', name: 'Pollachi', color: '#6aaf3a', score: 79 },
  { id: 'valparai', name: 'Valparai', color: '#e8712a', score: 72 },
].map((t) => ({
  ...t,
  performance: performanceFromScore(t.score ?? 75),
}));

/** Coimbatore district — uses the official PWD taluka map image. */
export const COIMBATORE_MAP: DistrictMapDefinition = {
  key: 'coimbatore',
  name: 'Coimbatore',
  viewBox: '0 0 460 540',
  imageSrc: '/maps/coimbatore-talukas.png',
  hideMapHeader: true,
  regionKind: 'talukas',
  talukas,
};
