import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileText,
  IndianRupee,
  LayoutDashboard,
  MapPin,
  Menu,
  Moon,
  Plus,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  TestTube2,
  Trophy,
  Upload,
  UserPlus,
  Users,
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
  '/gov/officers': Users,
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
  Award,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  IndianRupee,
  MapPin,
  Menu,
  Moon,
  Plus,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Sun,
  TestTube2,
  Trophy,
  Upload,
  UserPlus,
  Users,
  X,
};
