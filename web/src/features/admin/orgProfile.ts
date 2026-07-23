// The department's own identity — name, logo, address — as shown on the
// Organization Profile screen.
//
// Stored as a single row in eworks.settings under ORG_PROFILE_KEY rather than
// in a new table: it is exactly one record for the whole deployment, the admin
// settings endpoint already reads and writes arbitrary keys behind
// catalog.manage (head admin only), and a table for one row earns nothing.
//
// The trade-off is that the column is untyped jsonb, so nothing at the database
// level guarantees the shape. parseOrgProfile is therefore defensive: a
// hand-edited or partially-written row must not white-screen the only screen
// that can repair it.

export const ORG_PROFILE_KEY = 'org_profile';

export interface OrgProfile {
  name: string;
  industry: string;
  location: string;
  logoDataUrl: string;
  attention: string;
  street1: string;
  street2: string;
  city: string;
  pinCode: string;
  state: string;
  phone: string;
  fax: string;
}

const FIELDS: (keyof OrgProfile)[] = [
  'name', 'industry', 'location', 'logoDataUrl',
  'attention', 'street1', 'street2', 'city', 'pinCode', 'state', 'phone', 'fax',
];

export function emptyOrgProfile(): OrgProfile {
  return Object.fromEntries(FIELDS.map((f) => [f, ''])) as unknown as OrgProfile;
}

export function parseOrgProfile(raw: unknown): OrgProfile {
  const base = emptyOrgProfile();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const source = raw as Record<string, unknown>;
  for (const field of FIELDS) {
    const value = source[field];
    // Anything that is not a string is treated as unset rather than rendered —
    // a number or object in a text input is worse than an empty field.
    base[field] = typeof value === 'string' ? value : '';
  }
  return base;
}

export type OrgProfileErrors = Partial<Record<keyof OrgProfile, string>>;

export function validateOrgProfile(profile: OrgProfile): OrgProfileErrors {
  const errors: OrgProfileErrors = {};
  if (!profile.name.trim()) errors.name = 'required';
  if (!profile.location.trim()) errors.location = 'required';
  // Address is optional, but a pin code that is present must be a real one.
  if (profile.pinCode.trim() && !/^\d{6}$/.test(profile.pinCode.trim())) {
    errors.pinCode = 'invalid';
  }
  return errors;
}
