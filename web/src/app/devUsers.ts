// Dev-only fixture identities matching supabase/tests fixtures + seed-dev.mjs.
// Lets you switch personas in the UI to see RLS scoping first-hand.

export type Portal = 'vendor' | 'gov';

export interface DevUser {
  userId: string;
  label: string;
  sub: string;
  portal: Portal;
}

export const DEV_VENDOR_USERS: DevUser[] = [
  {
    userId: '44444444-0000-0000-0000-00000000000a',
    label: 'Kovai Testing Labs',
    sub: 'Coimbatore · NABL lapsed — dead link demo',
    portal: 'vendor',
  },
  {
    userId: '44444444-0000-0000-0000-00000000000c',
    label: 'Salem Statewide Labs',
    sub: 'Salem · eligible · live order link',
    portal: 'vendor',
  },
  {
    userId: '44444444-0000-0000-0000-00000000000d',
    label: 'Lapsed Accreditation Labs',
    sub: 'Coimbatore · expired NABL',
    portal: 'vendor',
  },
  {
    userId: '44444444-0000-0000-0000-00000000000e',
    label: 'Unapproved Labs (KYC queue)',
    sub: 'Coimbatore · SUBMITTED — officer review demo',
    portal: 'vendor',
  },
  {
    userId: '44444444-0000-0000-0000-000000000010',
    label: 'New Lab Applicant',
    sub: 'Coimbatore · no vendor row — KYC wizard demo',
    portal: 'vendor',
  },
  {
    userId: '44444444-0000-0000-0000-00000000000f',
    label: 'Field Technician (Kovai)',
    sub: 'Geo check-in · QR bind · custody',
    portal: 'vendor',
  },
];

export const DEV_GOV_USERS: DevUser[] = [
  {
    userId: '22222222-0000-0000-0000-00000000000d',
    label: 'Coimbatore Section Engineer',
    sub: 'Float orders · verify certificates',
    portal: 'gov',
  },
  {
    userId: '22222222-0000-0000-0000-00000000000b',
    label: 'Coimbatore District Officer',
    sub: 'Vendor KYC approval · district oversight',
    portal: 'gov',
  },
  {
    userId: '22222222-0000-0000-0000-00000000000a',
    label: 'Head Admin',
    sub: 'State-wide · catalog & settings',
    portal: 'gov',
  },
];

export const DEV_USERS: DevUser[] = [...DEV_VENDOR_USERS, ...DEV_GOV_USERS];

export function devUserById(userId: string | undefined) {
  return DEV_USERS.find((u) => u.userId === userId);
}

/** @deprecated use DEV_VENDOR_USERS */
export const DEV_VENDORS = DEV_VENDOR_USERS;
