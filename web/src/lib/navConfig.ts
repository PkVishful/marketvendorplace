import type { Session } from '@/types/domain';
import { hasPermission } from '@/auth/permissions';

export interface NavItem {
  to: string;
  labelKey: string;
  end?: boolean;
  icon?: string;
  // Permission code(s) that reveal this item; any-of. Absent ⇒ always shown.
  // Tabs are driven by held permissions, not role names, so a delegated grant
  // reveals its tab automatically. UX only — RLS still gates the data.
  requiresPermission?: string | string[];
  // Vendor nav still keys off role codes until status-mode routing (Phase 3).
  roles?: string[];
}

const GOV_ALL: NavItem[] = [
  { to: '/gov', labelKey: 'gov.navHome', end: true },
  { to: '/gov/planner', labelKey: 'gov.planned.planner', requiresPermission: ['order.float', 'order.read'] },
  { to: '/gov/orders', labelKey: 'govOrders.nav', requiresPermission: 'order.read' },
  { to: '/gov/vendors', labelKey: 'govVendors.nav', requiresPermission: ['vendor.read', 'vendor.approve'] },
  { to: '/gov/quality', labelKey: 'quality.nav', requiresPermission: ['result.verify', 'order.read'] },
  { to: '/gov/ratings', labelKey: 'ratings.nav', requiresPermission: 'vendor.read' },
  { to: '/gov/analytics', labelKey: 'analytics.nav', requiresPermission: 'order.read' },
  { to: '/gov/audit', labelKey: 'audit.nav', requiresPermission: ['audit.read', 'audit.read_all'] },
];

const VENDOR_OWNER: NavItem[] = [
  { to: '/vendor', labelKey: 'vendor.navHome', end: true },
  { to: '/vendor/onboarding', labelKey: 'kyc.nav', roles: ['LAB_VENDOR'] },
  { to: '/vendor/orders', labelKey: 'nav.orders' },
  { to: '/vendor/jobs', labelKey: 'nav.jobs' },
  { to: '/vendor/notifications', labelKey: 'nav.notifications' },
  { to: '/vendor/earnings', labelKey: 'nav.earnings' },
];

const FIELD_TECH: NavItem[] = [
  { to: '/vendor/jobs', labelKey: 'nav.jobs', end: true },
  { to: '/vendor/notifications', labelKey: 'nav.notifications' },
];

export const VENDOR_MOBILE_NAV: NavItem[] = [
  { to: '/vendor/orders', labelKey: 'nav.orders', roles: ['LAB_VENDOR'] },
  { to: '/vendor/jobs', labelKey: 'nav.jobs' },
  { to: '/vendor/notifications', labelKey: 'nav.notifications' },
  { to: '/vendor/earnings', labelKey: 'nav.earnings', roles: ['LAB_VENDOR'] },
];

function roleCodes(session: Session | undefined): string[] {
  return session?.roles?.map((r) => r.code) ?? [];
}

function hasAnyRole(codes: string[], allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.some((r) => codes.includes(r));
}

export function govNavForSession(session: Session | undefined): NavItem[] {
  return GOV_ALL.filter(
    (item) => !item.requiresPermission || hasPermission(session, item.requiresPermission),
  );
}

export function vendorNavForSession(session: Session | undefined): NavItem[] {
  const codes = roleCodes(session);
  if (codes.includes('FIELD_TECHNICIAN') && !codes.includes('LAB_VENDOR')) {
    return FIELD_TECH;
  }
  return VENDOR_OWNER;
}

export function vendorMobileNavForSession(session: Session | undefined): NavItem[] {
  const codes = roleCodes(session);
  const isFieldOnly = codes.includes('FIELD_TECHNICIAN') && !codes.includes('LAB_VENDOR');
  if (isFieldOnly) {
    return VENDOR_MOBILE_NAV.filter((n) => n.to !== '/vendor/orders' && n.to !== '/vendor/earnings');
  }
  return VENDOR_MOBILE_NAV.filter((n) => hasAnyRole(codes, n.roles ?? []));
}

export function primaryOrgScope(session: Session | undefined): string {
  const role = session?.roles?.[0];
  return role?.orgName ?? 'Tamil Nadu';
}

export function primaryRoleLabel(session: Session | undefined): string {
  const code = session?.roles?.[0]?.code;
  if (!code) return '';
  return code.replace(/_/g, ' ');
}
