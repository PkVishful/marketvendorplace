// Dev-only fixture identities matching supabase/tests fixtures + seed-dev.mjs.
// Lets you switch personas in the UI to see RLS scoping first-hand.

import type { OrgLevel } from '@/types/domain';

export type Portal = 'vendor' | 'gov' | 'contractor';

export interface DevUser {
  userId: string;
  label: string;
  sub: string;
  portal: Portal;
  /** Org level this persona is attached to (matches eworks.org_units.level) */
  orgLevel?: OrgLevel;
  /** District or state name for grouping in the sign-in picker */
  scopeLabel?: string;
}

export const DEV_VENDOR_USERS: DevUser[] = [
  {
    userId: '44444444-0000-0000-0000-00000000000a',
    label: 'Kovai Testing Labs',
    sub: 'Coimbatore · NABL lapsed — dead link demo',
    portal: 'vendor',
    scopeLabel: 'Coimbatore',
  },
  {
    userId: '44444444-0000-0000-0000-00000000000c',
    label: 'Salem Statewide Labs',
    sub: 'Salem · eligible · live order link',
    portal: 'vendor',
    scopeLabel: 'Salem',
  },
  {
    userId: '44444444-0000-0000-0000-00000000000d',
    label: 'Lapsed Accreditation Labs',
    sub: 'Coimbatore · expired NABL',
    portal: 'vendor',
    scopeLabel: 'Coimbatore',
  },
  {
    userId: '44444444-0000-0000-0000-00000000000e',
    label: 'Unapproved Labs (KYC queue)',
    sub: 'Coimbatore · SUBMITTED — officer review demo',
    portal: 'vendor',
    scopeLabel: 'Coimbatore',
  },
  {
    userId: '44444444-0000-0000-0000-000000000010',
    label: 'New Lab Applicant',
    sub: 'Coimbatore · no vendor row — KYC wizard demo',
    portal: 'vendor',
    scopeLabel: 'Coimbatore',
  },
  {
    userId: '44444444-0000-0000-0000-00000000000f',
    label: 'Field Technician (Kovai)',
    sub: 'Geo check-in · QR bind · custody',
    portal: 'vendor',
    scopeLabel: 'Coimbatore',
  },
];

/** Government personas — one login per org level in the PWD hierarchy. */
export const DEV_GOV_USERS: DevUser[] = [
  {
    userId: '22222222-0000-0000-0000-00000000000a',
    label: 'Head Admin',
    sub: 'State-wide · catalog & settings · all districts',
    portal: 'gov',
    orgLevel: 'STATE',
    scopeLabel: 'Tamil Nadu',
  },
  {
    userId: '22222222-0000-0000-0000-00000000000b',
    label: 'Coimbatore District Officer',
    sub: 'Vendor KYC approval · district oversight',
    portal: 'gov',
    orgLevel: 'DISTRICT',
    scopeLabel: 'Coimbatore',
  },
  {
    userId: '22222222-0000-0000-0000-00000000000c',
    label: 'Salem District Officer',
    sub: 'Vendor KYC approval · district oversight',
    portal: 'gov',
    orgLevel: 'DISTRICT',
    scopeLabel: 'Salem',
  },
  {
    userId: '22222222-0000-0000-0000-00000000000d',
    label: 'Coimbatore Section Engineer',
    sub: 'Float orders · verify certificates · Section 1',
    portal: 'gov',
    orgLevel: 'SECTION',
    scopeLabel: 'Coimbatore',
  },
  {
    userId: '22222222-0000-0000-0000-00000000000e',
    label: 'Coimbatore Auditor',
    sub: 'Audit trail · district compliance review',
    portal: 'gov',
    orgLevel: 'DISTRICT',
    scopeLabel: 'Coimbatore',
  },
];

/** Contractor personas — seeded by server/seed-contracts.mjs. */
export const DEV_CONTRACTOR_USERS: DevUser[] = [
  {
    userId: 'c0a00000-0000-0000-0000-000000000001',
    label: 'Coimbatore Builders',
    sub: 'Coimbatore · APPROVED · awarded + open tenders',
    portal: 'contractor',
    scopeLabel: 'Coimbatore',
  },
  {
    userId: 'c0a00000-0000-0000-0000-000000000002',
    label: 'Salem Builders',
    sub: 'Salem · APPROVED · awarded contract',
    portal: 'contractor',
    scopeLabel: 'Salem',
  },
  {
    userId: 'c0a00000-0000-0000-0000-000000000003',
    label: 'New Contractor Applicant',
    sub: 'Coimbatore · no registration yet — wizard demo',
    portal: 'contractor',
    scopeLabel: 'Coimbatore',
  },
];

export const DEV_USERS: DevUser[] = [...DEV_VENDOR_USERS, ...DEV_GOV_USERS, ...DEV_CONTRACTOR_USERS];

export function devUserById(userId: string | undefined) {
  return DEV_USERS.find((u) => u.userId === userId);
}

/** @deprecated use DEV_VENDOR_USERS */
export const DEV_VENDORS = DEV_VENDOR_USERS;

export const GOV_ORG_LEVEL_ORDER: OrgLevel[] = [
  'STATE',
  'DISTRICT',
  'DIVISION',
  'CIRCLE',
  'SUBDIVISION',
  'SECTION',
  'FIELD_UNIT',
  'PROJECT',
];

export function govUsersByOrgLevel() {
  const groups = new Map<OrgLevel, DevUser[]>();
  for (const u of DEV_GOV_USERS) {
    const level = u.orgLevel ?? 'DISTRICT';
    const list = groups.get(level) ?? [];
    list.push(u);
    groups.set(level, list);
  }
  return GOV_ORG_LEVEL_ORDER.filter((l) => groups.has(l)).map((level) => ({
    level,
    users: groups.get(level)!,
  }));
}
