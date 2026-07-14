import type { DistrictMapDefinition, TalukaRegion } from './types';
import { performanceFromScore } from './types';
import { DISTRICT_TALUKAS, formatDistrictName } from './talukaData';

const DISTRICT_COLORS = [
  '#2e7d32',
  '#558b2f',
  '#f9a825',
  '#ef6c00',
  '#c62828',
  '#ad1457',
  '#6a1b9a',
  '#283593',
  '#0277bd',
  '#00838f',
  '#00695c',
  '#4527a0',
];

/** Highlight districts with seeded demo performance for Head Admin state view. */
const HIGHLIGHT_DISTRICTS = [
  'coimbatore',
  'salem',
  'chennai',
  'madurai',
  'erode',
  'tiruppur',
  'tiruchirappalli',
  'thanjavur',
  'dindigul',
  'nilgiris',
  'kanchipuram',
  'vellore',
] as const;

const districts: TalukaRegion[] = Object.keys(DISTRICT_TALUKAS).map((key, i) => {
  const score = 62 + ((i * 13 + key.length * 5) % 35);
  return {
    id: key,
    name: formatDistrictName(key),
    color: DISTRICT_COLORS[i % DISTRICT_COLORS.length],
    score,
    performance: performanceFromScore(score),
  };
});

/** State-level map for Head Admin — stylized Tamil Nadu districts image. */
export const TAMIL_NADU_MAP: DistrictMapDefinition = {
  key: 'tamilnadu',
  name: 'Tamil Nadu',
  viewBox: '0 0 800 900',
  imageSrc: '/maps/tamil-nadu-districts.png',
  hideMapHeader: true,
  regionKind: 'districts',
  /** Keep the KPI list readable — show seeded priority districts first in UI */
  talukas: [
    ...HIGHLIGHT_DISTRICTS.map((key) => districts.find((d) => d.id === key)!).filter(Boolean),
    ...districts.filter((d) => !(HIGHLIGHT_DISTRICTS as readonly string[]).includes(d.id)),
  ],
};
