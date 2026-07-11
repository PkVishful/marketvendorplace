import { describe, it, expect } from 'vitest';
import type { Session, UserRole } from '@/types/domain';
import {
  hasPermission,
  orgLevelOrdinal,
  primaryOrgLevel,
  primaryOrgPath,
  vendorStatusOf,
} from './permissions';

function role(partial: Partial<UserRole>): UserRole {
  return { code: 'X', orgName: 'Org', orgLevel: 'SECTION', orgPath: 'TN.A', ...partial };
}

const engineer: Session = {
  authenticated: true,
  portal: 'gov',
  roles: [role({ code: 'DISTRICT_OFFICER', orgLevel: 'DISTRICT', orgPath: 'TN.COIMBATORE' })],
  permissions: ['vendor.approve', 'order.read', 'audit.read'],
};

describe('hasPermission', () => {
  it('is true for a held permission', () => {
    expect(hasPermission(engineer, 'vendor.approve')).toBe(true);
  });
  it('is false for a permission not held', () => {
    expect(hasPermission(engineer, 'order.float')).toBe(false);
  });
  it('any-of: true when at least one of an array is held', () => {
    expect(hasPermission(engineer, ['order.float', 'order.read'])).toBe(true);
  });
  it('any-of: false when none are held', () => {
    expect(hasPermission(engineer, ['order.float', 'result.enter'])).toBe(false);
  });
  it('is false for an undefined/unauthenticated session', () => {
    expect(hasPermission(undefined, 'order.read')).toBe(false);
    expect(hasPermission({ authenticated: false }, 'order.read')).toBe(false);
  });
});

describe('orgLevelOrdinal', () => {
  it('ranks STATE above SECTION (lower ordinal = higher authority)', () => {
    expect(orgLevelOrdinal('STATE')).toBeLessThan(orgLevelOrdinal('SECTION'));
  });
  it('places CIRCLE below DIVISION (schema order)', () => {
    expect(orgLevelOrdinal('DIVISION')).toBeLessThan(orgLevelOrdinal('CIRCLE'));
  });
});

describe('primaryOrgLevel / primaryOrgPath', () => {
  it('picks the shallowest (highest-authority) level among roles', () => {
    const multi: Session = {
      authenticated: true,
      roles: [
        role({ orgLevel: 'SECTION', orgPath: 'TN.A.B.C.D.E' }),
        role({ orgLevel: 'DISTRICT', orgPath: 'TN.A' }),
      ],
    };
    expect(primaryOrgLevel(multi)).toBe('DISTRICT');
    expect(primaryOrgPath(multi)).toBe('TN.A');
  });
  it('is undefined when there are no roles', () => {
    expect(primaryOrgLevel({ authenticated: true })).toBeUndefined();
    expect(primaryOrgPath({ authenticated: true })).toBeUndefined();
  });
});

describe('vendorStatusOf', () => {
  it('returns the vendor status when present', () => {
    expect(vendorStatusOf({ authenticated: true, vendorStatus: 'APPROVED' })).toBe('APPROVED');
  });
  it('returns null when absent', () => {
    expect(vendorStatusOf(engineer)).toBeNull();
    expect(vendorStatusOf(undefined)).toBeNull();
  });
});
