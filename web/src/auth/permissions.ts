// Session selectors for permission-, org-level-, and vendor-status-based UI.
//
// IMPORTANT: everything here is UX only. The real authorization gate is RLS in
// the database (eworks.has_permission / in_scope, keyed off app.user_id set by
// the BFF). A user tampering with these client checks gains nothing — the query
// still fails closed server-side.

import { ORG_LEVELS } from '@/types/domain';
import type { OrgLevel, Session, VendorStatus } from '@/types/domain';
import { useSession } from './useSession';

/** True when the session holds `perm` (a single code, or any-of an array). */
export function hasPermission(
  session: Session | undefined,
  perm: string | string[],
): boolean {
  const held = session?.permissions;
  if (!held || held.length === 0) return false;
  const wanted = Array.isArray(perm) ? perm : [perm];
  return wanted.some((p) => held.includes(p));
}

/** Authority rank of a level: 0 = STATE (highest) … 5 = SECTION (lowest). */
export function orgLevelOrdinal(level: OrgLevel): number {
  return ORG_LEVELS.indexOf(level);
}

/** The user's highest-authority (shallowest) org level, if any. */
export function primaryOrgLevel(session: Session | undefined): OrgLevel | undefined {
  return primaryRole(session)?.orgLevel;
}

/** The org path of the user's highest-authority role, if any. */
export function primaryOrgPath(session: Session | undefined): string | undefined {
  return primaryRole(session)?.orgPath;
}

/** The vendor's KYC status, or null when the user is not a vendor. */
export function vendorStatusOf(session: Session | undefined): VendorStatus | null {
  return session?.vendorStatus ?? null;
}

function primaryRole(session: Session | undefined) {
  const roles = session?.roles;
  if (!roles || roles.length === 0) return undefined;
  return roles.reduce((best, r) =>
    orgLevelOrdinal(r.orgLevel) < orgLevelOrdinal(best.orgLevel) ? r : best,
  );
}

// --- hooks -----------------------------------------------------------------

/** Reactive `hasPermission` over the current `/me` session. */
export function usePermission(perm: string | string[]): boolean {
  const { data: session } = useSession();
  return hasPermission(session, perm);
}
