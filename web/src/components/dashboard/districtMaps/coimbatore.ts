import type { DistrictMapDefinition, TalukaRegion } from './types';
import { performanceFromScore } from './types';
import { COIMBATORE_TALUKA_DETAILS } from './talukaDetails';

/** Approximate click hotspots on the official map image (viewBox 0 0 460 540). */
const talukaRows: Omit<TalukaRegion, 'performance'>[] = [
  {
    id: 'mettupalayam',
    name: 'Mettupalayam',
    color: '#e63946',
    score: 86,
    hotspot: { x: 95, y: 18, w: 210, h: 115 },
    details: COIMBATORE_TALUKA_DETAILS['mettupalayam'],
  },
  {
    id: 'coimbatore-north',
    name: 'Coimbatore North',
    color: '#9b1b6b',
    score: 91,
    hotspot: { x: 55, y: 128, w: 195, h: 95 },
    details: COIMBATORE_TALUKA_DETAILS['coimbatore-north'],
  },
  {
    id: 'sulur',
    name: 'Sulur',
    color: '#00acc1',
    score: 84,
    hotspot: { x: 255, y: 165, w: 145, h: 105 },
    details: COIMBATORE_TALUKA_DETAILS.sulur,
  },
  {
    id: 'coimbatore-south',
    name: 'Coimbatore South',
    color: '#f5a623',
    score: 88,
    hotspot: { x: 85, y: 218, w: 175, h: 95 },
    details: COIMBATORE_TALUKA_DETAILS['coimbatore-south'],
  },
  {
    id: 'pollachi',
    name: 'Pollachi',
    color: '#6aaf3a',
    score: 79,
    hotspot: { x: 45, y: 310, w: 220, h: 115 },
    details: COIMBATORE_TALUKA_DETAILS.pollachi,
  },
  {
    id: 'valparai',
    name: 'Valparai',
    color: '#e8712a',
    score: 72,
    hotspot: { x: 110, y: 425, w: 240, h: 95 },
    details: COIMBATORE_TALUKA_DETAILS.valparai,
  },
];

const talukas: TalukaRegion[] = talukaRows.map((t) => ({
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
