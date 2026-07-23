import type { TalukaDetailStats } from './types';

/** Mock drill-down stats per Coimbatore taluk until BFF exposes taluk-scoped KPIs. */
export const COIMBATORE_TALUKA_DETAILS: Record<string, TalukaDetailStats> = {
  mettupalayam: {
    activeProjects: 4,
    openRfqs: 2,
    labsEngaged: 5,
    pendingTests: 11,
    sectionEngineer: 'Er. Karthikeyan · AE (Mettupalayam)',
    blockOffice: 'PWD Block Office, Mettupalayam',
    recentProjects: ['Bhavani River Bridge Phase II', 'Mettupalayam Bus Stand Upgrade', 'NH-181 Overlay'],
  },
  'coimbatore-north': {
    activeProjects: 7,
    openRfqs: 3,
    labsEngaged: 8,
    pendingTests: 18,
    sectionEngineer: 'Er. Priya Sundar · EE (Coimbatore North)',
    blockOffice: 'PWD Division Office, Gandhipuram',
    recentProjects: ['Coimbatore Flyover Package A', 'Race Course Road Widening', 'Ukkadam Smart City Works'],
  },
  sulur: {
    activeProjects: 3,
    openRfqs: 1,
    labsEngaged: 4,
    pendingTests: 8,
    sectionEngineer: 'Er. Murugesan · AE (Sulur)',
    blockOffice: 'PWD Sub-Division, Sulur',
    recentProjects: ['Sulur Industrial Link Road', 'Air Force Station Perimeter Drain'],
  },
  'coimbatore-south': {
    activeProjects: 6,
    openRfqs: 2,
    labsEngaged: 7,
    pendingTests: 14,
    sectionEngineer: 'Er. Rajesh Kumar · AE (Coimbatore South)',
    blockOffice: 'PWD Division Office, Peelamedu',
    recentProjects: ['Coimbatore Flyover Package B', 'Peelamedu Grade Separator', 'Singanallur Lake Bund'],
  },
  pollachi: {
    activeProjects: 5,
    openRfqs: 2,
    labsEngaged: 6,
    pendingTests: 16,
    sectionEngineer: 'Er. Lakshmi · AE (Pollachi)',
    blockOffice: 'PWD Division Office, Pollachi',
    recentProjects: ['Pollachi–Palani NH Strengthening', 'Anamalai Check Dam', 'Valparai Ghat Road Maintenance'],
  },
  valparai: {
    activeProjects: 2,
    openRfqs: 1,
    labsEngaged: 3,
    pendingTests: 6,
    sectionEngineer: 'Er. Anand · AE (Valparai)',
    blockOffice: 'PWD Sub-Division, Valparai',
    recentProjects: ['Valparai Ghat Road Phase III', 'Sholayar Dam Approach Works'],
  },
};

export function defaultTalukaDetails(name: string, score = 75): TalukaDetailStats {
  const factor = score / 100;
  return {
    activeProjects: Math.max(1, Math.round(3 * factor + 1)),
    openRfqs: Math.max(0, Math.round(2 * factor)),
    labsEngaged: Math.max(2, Math.round(5 * factor)),
    pendingTests: Math.max(3, Math.round(12 * (1.1 - factor))),
    sectionEngineer: `Er. Officer · AE (${name})`,
    blockOffice: `PWD Block Office, ${name}`,
    recentProjects: [`${name} Road Package`, `${name} Bridge Works`],
  };
}
