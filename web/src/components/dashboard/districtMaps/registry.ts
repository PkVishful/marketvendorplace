import type { DistrictMapDefinition, TalukaRegion } from './types';
import { performanceFromScore } from './types';
import { COIMBATORE_MAP } from './coimbatore';
import { TAMIL_NADU_MAP } from './tamilNadu';
import { DISTRICT_TALUKAS, ORG_PATH_ALIASES, formatDistrictName } from './talukaData';
import { defaultTalukaDetails } from './talukaDetails';

const TALUKA_PALETTE = [
  '#e63946',
  '#9b1b6b',
  '#00acc1',
  '#f5a623',
  '#6aaf3a',
  '#e8712a',
  '#1a6fb0',
  '#8e44ad',
  '#16a085',
  '#d35400',
  '#2c3e50',
  '#27ae60',
];

/** Build a readable grid layout for districts without a hand-drawn SVG map. */
function buildGridMap(key: string, name: string, talukaNames: string[]): DistrictMapDefinition {
  const cols = talukaNames.length <= 4 ? 2 : talukaNames.length <= 6 ? 3 : 3;
  const rows = Math.ceil(talukaNames.length / cols);
  const cellW = 480 / cols;
  const cellH = 480 / rows;
  const pad = 8;

  const talukas: TalukaRegion[] = talukaNames.map((taluka, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 20 + col * cellW + pad;
    const y = 40 + row * cellH + pad;
    const w = cellW - pad * 2;
    const h = cellH - pad * 2;
    const score = 68 + ((i * 17 + name.length * 3) % 28);
    return {
      id: `${key}-${i}`,
      name: taluka,
      path: `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`,
      color: TALUKA_PALETTE[i % TALUKA_PALETTE.length],
      labelX: x + w / 2,
      labelY: y + h / 2,
      score,
      performance: performanceFromScore(score),
      details: defaultTalukaDetails(taluka, score),
    };
  });

  return {
    key,
    name,
    viewBox: '0 0 520 560',
    regionKind: 'talukas',
    talukas,
  };
}

const CUSTOM_MAPS: Record<string, DistrictMapDefinition> = {
  tamilnadu: TAMIL_NADU_MAP,
  coimbatore: COIMBATORE_MAP,
};

const GRID_MAPS = Object.fromEntries(
  Object.entries(DISTRICT_TALUKAS)
    .filter(([key]) => key !== 'coimbatore')
    .map(([key, talukas]) => [key, buildGridMap(key, formatDistrictName(key), talukas)]),
);

export const DISTRICT_MAP_REGISTRY: Record<string, DistrictMapDefinition> = {
  ...CUSTOM_MAPS,
  ...GRID_MAPS,
};

function isStateScope(orgName?: string, orgPath?: string): boolean {
  const path = (orgPath ?? '').trim().toUpperCase();
  if (path === 'TN' || path === 'TAMILNADU' || path === 'TAMIL_NADU') return true;
  // No district segment → state root (e.g. path "TN" only)
  if (path && !path.includes('.')) return true;
  const name = (orgName ?? '').toLowerCase();
  return name.includes('tamil nadu') || name === 'tn' || name === 'state';
}

/** Normalize org path / name to a district registry key, e.g. `TN.COIMBATORE.*` → `coimbatore`. */
export function resolveDistrictKey(orgName?: string, orgPath?: string): string {
  if (isStateScope(orgName, orgPath)) return 'tamilnadu';

  if (orgPath) {
    const segment = orgPath.split('.')[1]?.toLowerCase();
    if (segment) {
      const alias = ORG_PATH_ALIASES[segment] ?? segment.replace(/[^a-z]/g, '');
      if (DISTRICT_MAP_REGISTRY[alias]) return alias;
    }
  }

  if (orgName) {
    const normalized = orgName.toLowerCase();
    for (const key of Object.keys(DISTRICT_MAP_REGISTRY)) {
      if (key !== 'tamilnadu' && normalized.includes(key)) return key;
    }
    for (const key of Object.keys(DISTRICT_TALUKAS)) {
      const label = formatDistrictName(key).toLowerCase();
      if (normalized.includes(label)) return key;
    }
  }

  return 'tamilnadu';
}

export function getDistrictMap(orgName?: string, orgPath?: string): DistrictMapDefinition {
  const key = resolveDistrictKey(orgName, orgPath);
  return DISTRICT_MAP_REGISTRY[key] ?? COIMBATORE_MAP;
}

export function listDistrictMapKeys(): string[] {
  return Object.keys(DISTRICT_MAP_REGISTRY).sort();
}

export interface MapScope {
  level: 'state' | 'district';
  key: string;
  unavailable: boolean;
}

/** Resolve which map to show and whether we had to fall back. */
export function resolveMapScope(orgName?: string, orgPath?: string): MapScope {
  const key = resolveDistrictKey(orgName, orgPath);
  if (key === 'tamilnadu') {
    const wasStateInput = isStateScope(orgName, orgPath);
    return { level: 'state', key, unavailable: !wasStateInput };
  }
  return { level: 'district', key, unavailable: false };
}
