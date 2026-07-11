import { describe, it, expect } from 'vitest';
import type { Session, UserRole } from '@/types/domain';
import { govNavForSession } from './navConfig';

function role(code: string): UserRole {
  return { code, orgName: 'Coimbatore', orgLevel: 'DISTRICT', orgPath: 'TN.COIMBATORE' };
}

function gov(permissions: string[], roles: string[] = ['X']): Session {
  return { authenticated: true, portal: 'gov', roles: roles.map(role), permissions };
}

function tabs(session: Session): string[] {
  return govNavForSession(session).map((n) => n.to);
}

describe('govNavForSession (permission-driven)', () => {
  it('always shows the Dashboard tab, even with no permissions', () => {
    expect(tabs(gov([]))).toEqual(['/gov']);
  });

  it("reproduces a District Officer's tabs from their seeded permissions", () => {
    // vendor.approve, order.award, order.read, vendor.read, audit.read, user.read, catalog.manage
    const t = tabs(
      gov(['vendor.approve', 'order.award', 'order.read', 'vendor.read', 'audit.read', 'user.read', 'catalog.manage']),
    );
    expect(t).toContain('/gov/orders'); // order.read
    expect(t).toContain('/gov/vendors'); // vendor.read/approve
    expect(t).toContain('/gov/quality'); // order.read
    expect(t).toContain('/gov/ratings'); // vendor.read
    expect(t).toContain('/gov/analytics'); // order.read
    expect(t).toContain('/gov/audit'); // audit.read
  });

  it('reveals the Vendors tab from a delegated vendor.read alone', () => {
    expect(tabs(gov(['vendor.read']))).toContain('/gov/vendors');
  });

  it('hides the Audit tab when the user holds no audit permission', () => {
    expect(tabs(gov(['order.read']))).not.toContain('/gov/audit');
  });

  it('shows the Audit tab for audit.read_all as well as audit.read', () => {
    expect(tabs(gov(['audit.read_all']))).toContain('/gov/audit');
  });

  it('takes the union for a dual-role user (merged permission set)', () => {
    // Section engineer perms ∪ auditor perms
    const t = tabs(gov(['order.float', 'result.verify', 'order.read', 'audit.read_all']));
    expect(t).toContain('/gov/planner'); // order.float
    expect(t).toContain('/gov/quality'); // result.verify/order.read
    expect(t).toContain('/gov/audit'); // audit.read_all
  });
});
