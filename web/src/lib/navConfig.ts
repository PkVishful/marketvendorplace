import type { Session } from '@/types/domain';
import { hasPermission } from '@/auth/permissions';

export interface NavItem {
  to: string;
  labelKey: string;
  end?: boolean;
  icon?: string;
  navKey?: string;
  requiresPermission?: string | string[];
  roles?: string[];
}

/** Tab keys stored in eworks.settings.nav_visibility */
export const GOV_NAV_TAB_KEYS = [
  { key: 'dashboard', labelKey: 'gov.navHome' },
  { key: 'planner', labelKey: 'gov.planned.planner' },
  { key: 'checklist', labelKey: 'catalog.title' },
  { key: 'orders', labelKey: 'govOrders.nav' },
  { key: 'vendors', labelKey: 'govVendors.nav' },
  { key: 'officers', labelKey: 'officers.nav' },
  { key: 'quality', labelKey: 'quality.nav' },
  { key: 'ratings', labelKey: 'ratings.nav' },
  { key: 'analytics', labelKey: 'analytics.nav' },
  { key: 'audit', labelKey: 'audit.nav' },
  { key: 'tenders', labelKey: 'tender.nav' },
] as const;

const GOV_ALL: NavItem[] = [
  { to: '/gov', labelKey: 'gov.navHome', end: true, navKey: 'dashboard' },
  { to: '/gov/planner', labelKey: 'gov.planned.planner', navKey: 'planner', requiresPermission: ['order.float', 'order.read'] },
  { to: '/gov/checklist', labelKey: 'catalog.title', navKey: 'checklist', requiresPermission: 'order.read' },
  { to: '/gov/orders', labelKey: 'govOrders.nav', navKey: 'orders', requiresPermission: 'order.read' },
  { to: '/gov/vendors', labelKey: 'govVendors.nav', navKey: 'vendors', requiresPermission: ['vendor.read', 'vendor.approve'] },
  { to: '/gov/officers', labelKey: 'officers.nav', navKey: 'officers', requiresPermission: 'user.read' },
  { to: '/gov/quality', labelKey: 'quality.nav', navKey: 'quality', requiresPermission: ['result.verify', 'order.read'] },
  { to: '/gov/ratings', labelKey: 'ratings.nav', navKey: 'ratings', requiresPermission: 'vendor.read' },
  { to: '/gov/analytics', labelKey: 'analytics.nav', navKey: 'analytics', requiresPermission: 'order.read' },
  { to: '/gov/audit', labelKey: 'audit.nav', navKey: 'audit', requiresPermission: ['audit.read', 'audit.read_all'] },
  { to: '/gov/tenders', labelKey: 'tender.nav', navKey: 'tenders', requiresPermission: 'contract.manage' },
];

const VENDOR_OWNER: NavItem[] = [
  { to: '/vendor', labelKey: 'vendor.navHome', end: true },
  { to: '/vendor/onboarding', labelKey: 'kyc.nav', roles: ['LAB_VENDOR'] },
  { to: '/vendor/orders', labelKey: 'nav.orders' },
  { to: '/vendor/rates', labelKey: 'nav.rates', roles: ['LAB_VENDOR'] },
  { to: '/vendor/tests', labelKey: 'catalog.navVendor' },
  { to: '/vendor/jobs', labelKey: 'nav.jobs' },
  { to: '/vendor/notifications', labelKey: 'nav.notifications' },
  { to: '/vendor/earnings', labelKey: 'nav.earnings' },
];

const FIELD_TECH: NavItem[] = [
  { to: '/vendor/jobs', labelKey: 'nav.jobs', end: true },
  { to: '/vendor/notifications', labelKey: 'nav.notifications' },
];

const CONTRACTOR_NAV: NavItem[] = [
  { to: '/contractor', labelKey: 'contractor.navContracts', end: true },
  { to: '/contractor/registration', labelKey: 'contractor.navRegistration' },
  { to: '/contractor/eligibility', labelKey: 'eligibility.nav' },
];

export const VENDOR_MOBILE_NAV: NavItem[] = [
  { to: '/vendor/orders', labelKey: 'nav.orders', roles: ['LAB_VENDOR'] },
  { to: '/vendor/rates', labelKey: 'nav.rates', roles: ['LAB_VENDOR'] },
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

function visibleNavKeys(session: Session | undefined): Set<string> | null {
  const matrix = session?.navVisibility;
  if (!matrix || typeof matrix !== 'object') return null;
  const codes = roleCodes(session);
  const visible = new Set<string>();
  for (const code of codes) {
    const tabs = matrix[code];
    if (Array.isArray(tabs)) tabs.forEach((t) => visible.add(t));
  }
  return visible.size > 0 ? visible : null;
}

function isNavItemVisible(session: Session | undefined, item: NavItem): boolean {
  const keys = visibleNavKeys(session);
  if (!keys || !item.navKey) return true;
  return keys.has(item.navKey);
}

export function govNavForSession(session: Session | undefined): NavItem[] {
  return GOV_ALL.filter((item) => {
    if (item.requiresPermission && !hasPermission(session, item.requiresPermission)) return false;
    return isNavItemVisible(session, item);
  });
}

export function vendorNavForSession(session: Session | undefined): NavItem[] {
  const codes = roleCodes(session);
  if (codes.includes('FIELD_TECHNICIAN') && !codes.includes('LAB_VENDOR')) {
    return FIELD_TECH;
  }
  return VENDOR_OWNER;
}

export function contractorNavForSession(_session: Session | undefined): NavItem[] {
  return CONTRACTOR_NAV;
}

export function vendorMobileNavForSession(session: Session | undefined): NavItem[] {
  const codes = roleCodes(session);
  return VENDOR_MOBILE_NAV.filter((n) => hasAnyRole(codes, n.roles));
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
