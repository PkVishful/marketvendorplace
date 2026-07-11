import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Circle,
  ClipboardList,
  FileText,
  IndianRupee,
  LayoutDashboard,
  MapPin,
  Menu,
  Moon,
  ScrollText,
  ShieldCheck,
  Star,
  Sun,
  TestTube2,
  Trophy,
  X,
} from 'lucide-react';

/** Consistent stroke icons for nav and KPI tiles */
export const ICON_SIZE = 'h-[18px] w-[18px]';
export const ICON_SIZE_KPI = 'h-5 w-5';

const NAV_ICON_MAP: Record<string, LucideIcon> = {
  '/gov': LayoutDashboard,
  '/gov/planner': CalendarDays,
  '/gov/orders': ClipboardList,
  '/gov/vendors': Building2,
  '/gov/quality': ShieldCheck,
  '/gov/ratings': Star,
  '/gov/analytics': BarChart3,
  '/gov/audit': ScrollText,
  '/vendor': LayoutDashboard,
  '/vendor/onboarding': FileText,
  '/vendor/orders': ClipboardList,
  '/vendor/jobs': MapPin,
  '/vendor/notifications': Bell,
  '/vendor/earnings': IndianRupee,
};

export function NavIcon({ path, className = ICON_SIZE }: { path: string; className?: string }) {
  const Icon = NAV_ICON_MAP[path] ?? Circle;
  return <Icon className={className} strokeWidth={2} aria-hidden />;
}

export {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  ClipboardList,
  IndianRupee,
  MapPin,
  Menu,
  Moon,
  ShieldCheck,
  Sun,
  TestTube2,
  Trophy,
  X,
};
