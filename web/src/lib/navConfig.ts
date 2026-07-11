import type { Session } from '@/types/domain';

export interface NavItem {
  to: string;
  labelKey: string;
  end?: boolean;
  icon?: string;
  roles?: string[];
}

const GOV_ALL: NavItem[] = [
  { to: '/gov', labelKey: 'gov.navHome', end: true },
  { to: '/gov/planner', labelKey: 'gov.planned.planner', roles: ['SITE_ENGINEER', 'EXECUTIVE_ENGINEER', 'HEAD_ADMIN'] },
  { to: '/gov/orders', labelKey: 'govOrders.nav', roles: ['SITE_ENGINEER', 'EXECUTIVE_ENGINEER', 'DISTRICT_OFFICER', 'SUPERINTENDING_ENGINEER', 'HEAD_ADMIN'] },
  { to: '/gov/vendors', labelKey: 'govVendors.nav', roles: ['DISTRICT_OFFICER', 'SUPERINTENDING_ENGINEER', 'HEAD_ADMIN'] },
  { to: '/gov/quality', labelKey: 'quality.nav', roles: ['SITE_ENGINEER', 'EXECUTIVE_ENGINEER', 'DISTRICT_OFFICER', 'SUPERINTENDING_ENGINEER', 'HEAD_ADMIN', 'AUDITOR'] },
  { to: '/gov/ratings', labelKey: 'ratings.nav', roles: ['EXECUTIVE_ENGINEER', 'DISTRICT_OFFICER', 'SUPERINTENDING_ENGINEER', 'HEAD_ADMIN'] },
  { to: '/gov/analytics', labelKey: 'analytics.nav', roles: ['EXECUTIVE_ENGINEER', 'DISTRICT_OFFICER', 'SUPERINTENDING_ENGINEER', 'HEAD_ADMIN'] },
  { to: '/gov/audit', labelKey: 'audit.nav', roles: ['DISTRICT_OFFICER', 'EXECUTIVE_ENGINEER', 'AUDITOR', 'HEAD_ADMIN'] },
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
  { to: '/vendor/orders', labelKey: 'nav.orders', icon: '📋', roles: ['LAB_VENDOR'] },
  { to: '/vendor/jobs', labelKey: 'nav.jobs', icon: '📍' },
  { to: '/vendor/notifications', labelKey: 'nav.notifications', icon: '🔔' },
  { to: '/vendor/earnings', labelKey: 'nav.earnings', icon: '₹', roles: ['LAB_VENDOR'] },
];

function roleCodes(session: Session | undefined): string[] {
  return session?.roles?.map((r) => r.code) ?? [];
}

function hasAnyRole(codes: string[], allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.some((r) => codes.includes(r));
}

export function govNavForSession(session: Session | undefined): NavItem[] {
  const codes = roleCodes(session);
  if (codes.includes('HEAD_ADMIN')) return GOV_ALL;
  return GOV_ALL.filter((item) => hasAnyRole(codes, item.roles ?? []));
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
