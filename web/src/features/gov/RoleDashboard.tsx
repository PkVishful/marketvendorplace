import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/auth/useSession';
import { hasPermission } from '@/auth/permissions';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { ModuleCard } from '@/components/dashboard/ModuleCard';
import { useGovDashboardData } from '@/features/dashboard/useDashboardData';
import { OrderStatusPill } from '@/features/orders/OrderStatusPill';
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  ICON_SIZE_KPI,
  ShieldCheck,
  Trophy,
} from '@/lib/navIcons';

import type { Session } from '@/types/domain';

function roleCodes(session: Session | undefined) {
  return session?.roles?.map((r) => r.code) ?? [];
}

export function RoleDashboard() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const codes = roleCodes(session);
  const data = useGovDashboardData(session);

  const isEngineer = codes.some((c) => c === 'SITE_ENGINEER');
  const isOfficer = codes.some((c) =>
    ['DISTRICT_OFFICER', 'SUPERINTENDING_ENGINEER', 'EXECUTIVE_ENGINEER'].includes(c),
  );
  const isAuditor = codes.includes('AUDITOR');
  const isAdmin = codes.includes('HEAD_ADMIN');

  const canOrders = hasPermission(session, 'order.read');
  const canQuality = hasPermission(session, ['result.verify', 'order.read']);
  const canVendors = hasPermission(session, ['vendor.read', 'vendor.approve']);

  const widgets = [
    {
      show: isEngineer || isAdmin,
      title: t('dashboard.engineer.planner'),
      desc: t('dashboard.engineer.plannerDesc'),
      to: '/gov/planner',
      tone: 'brand' as const,
    },
    {
      show: isEngineer || isOfficer || isAdmin,
      title: t('dashboard.engineer.orders'),
      desc: t('dashboard.engineer.ordersDesc'),
      to: '/gov/orders',
      tone: 'accent' as const,
    },
    {
      show: isOfficer || isAdmin,
      title: t('dashboard.officer.vendors'),
      desc: t('dashboard.officer.vendorsDesc'),
      to: '/gov/vendors',
      tone: 'warning' as const,
      badge: data.pendingKyc > 0 ? String(data.pendingKyc) : undefined,
    },
    {
      show: isEngineer || isOfficer || isAdmin,
      title: t('quality.nav'),
      desc: t('dashboard.qualityDesc'),
      to: '/gov/quality',
      tone: 'success' as const,
    },
    {
      show: isOfficer || isAdmin,
      title: t('analytics.nav'),
      desc: t('dashboard.analyticsDesc'),
      to: '/gov/analytics',
      tone: 'info' as const,
    },
    {
      show: isAuditor || isOfficer || isAdmin,
      title: t('audit.nav'),
      desc: t('dashboard.auditDesc'),
      to: '/gov/audit',
      tone: 'danger' as const,
    },
  ].filter((w) => w.show);

  const kpis = [
    canOrders && {
      label: t('dashboard.kpi.floated'),
      value: data.floated,
      icon: <ClipboardList className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'brand' as const,
    },
    canOrders && {
      label: t('dashboard.kpi.awarded'),
      value: data.awarded,
      icon: <Trophy className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'accent' as const,
    },
    canVendors && {
      label: t('dashboard.kpi.pendingKyc'),
      value: data.pendingKyc,
      hint: t('dashboard.kpi.pendingKycHint'),
      icon: <Building2 className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'warning' as const,
    },
    canQuality && {
      label: t('dashboard.kpi.qualityAlerts'),
      value: data.qualityAlerts,
      hint: data.healthPct != null ? t('dashboard.kpi.healthPct', { pct: data.healthPct }) : undefined,
      icon: <ShieldCheck className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'success' as const,
    },
    canQuality && data.escalations > 0 && {
      label: t('dashboard.kpi.escalations'),
      value: data.escalations,
      icon: <AlertTriangle className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'danger' as const,
    },
  ].filter(Boolean) as {
    label: string;
    value: number;
    hint?: string;
    icon: ReactNode;
    tone: 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  }[];

  return (
    <section className="dash-home space-y-8">
      <header className="dash-welcome relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-brand via-brand to-brand-dark p-6 text-white sm:p-8">
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-accent/20 blur-2xl"
          aria-hidden
        />
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent">{t('dashboard.welcome')}</p>
        <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">
          {session?.fullName ?? t('gov.title')}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-white/80">{t('dashboard.govSubtitle')}</p>
      </header>

      {kpis.length > 0 && (
        <div>
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-3">{t('dashboard.kpiTitle')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((k) => (
              <KpiCard
                key={k.label}
                label={k.label}
                value={k.value}
                hint={k.hint}
                icon={k.icon}
                tone={k.tone}
                loading={data.isLoading}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-3">{t('dashboard.modulesTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {widgets.map((w) => (
            <ModuleCard
              key={w.to}
              title={w.title}
              description={w.desc}
              to={w.to}
              tone={w.tone}
              badge={w.badge}
            />
          ))}
        </div>
      </div>

      {canOrders && data.recentOrders.length > 0 && (
        <div className="gov-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold text-ink">{t('dashboard.recentOrders')}</h2>
            <Link to="/gov/orders" className="text-sm font-semibold text-brand hover:underline">
              {t('dashboard.viewAll')} →
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {data.recentOrders.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/gov/orders/${o.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 transition hover:bg-surface-2"
                >
                  <span className="font-medium text-ink">{o.milestone}</span>
                  <OrderStatusPill status={o.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
