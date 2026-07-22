import { describe, it, expect } from 'vitest';
import { primaryGovRole } from './domain';
import type { Session, UserRole } from './domain';

const role = (code: string, orgLevel: UserRole['orgLevel'], orgPath: string): UserRole =>
  ({ code, orgLevel, orgPath, orgName: orgPath });

describe('primaryGovRole', () => {
  it('picks the most senior gov role, not roles[0]', () => {
    const s = { authenticated: true, roles: [
      role('SITE_ENGINEER', 'SECTION', 'TN.MADURAI.DIV1.SEC1'),
      role('DISTRICT_OFFICER', 'DISTRICT', 'TN.MADURAI'),
    ] } as Session;
    expect(primaryGovRole(s)?.code).toBe('DISTRICT_OFFICER');
  });

  it('returns undefined when there is no gov role', () => {
    const s = { authenticated: true, roles: [role('LAB_VENDOR', 'DISTRICT', 'TN.SALEM')] } as Session;
    expect(primaryGovRole(s)).toBeUndefined();
  });

  it('returns undefined for an empty session', () => {
    expect(primaryGovRole(undefined)).toBeUndefined();
  });
});
