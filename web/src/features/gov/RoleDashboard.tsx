import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Award,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  ICON_SIZE_KPI,
  IndianRupee,
  MapPin,
  Plus,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trophy,
  Upload,
  UserPlus,
} from '@/lib/navIcons';
import { useSession } from '@/auth/useSession';
import { hasPermission } from '@/auth/permissions';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { ModuleCard } from '@/components/dashboard/ModuleCard';
import {
  BudgetGauge,
  ProcurementTrendChart,
  RfqStatusDonut,
} from '@/components/dashboard/DashboardCharts';
import { DistrictPerformanceMap } from '@/components/dashboard/DistrictMap';
import { useGovDashboardData } from '@/features/dashboard/useDashboardData';
import { OrderStatusPill } from '@/features/orders/OrderStatusPill';
import { CheckCircle, Clock, FileBarChart } from 'lucide-react';

import type { Session } from '@/types/domain';

function roleCodes(session: Session | undefined) {
  return session?.roles?.map((r) => r.code) ?? [];
}

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 12) return 'dashboard.greetingMorning';
  if (h < 17) return 'dashboard.greetingAfternoon';
  return 'dashboard.greetingEvening';
}

function formatDateLong(d: Date) {
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function PanelCard({
  title,
  badge,
  children,
  className = '',
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`gov-card overflow-hidden ${className}`}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {badge}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
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

  const orgName = session?.roles?.[0]?.orgName ?? 'Coimbatore';
  const districtId = `#PWD/${orgName.slice(0, 4).toUpperCase()}`;
  const compliancePct = data.healthPct ?? 89;

  const rfqDonutData = data.analytics?.ordersByStatus?.length
    ? data.analytics.ordersByStatus.map((s) => ({
        name: s.status,
        value: s.count,
      }))
    : [
        { name: 'Open', value: 22, color: '#1a6fb0' },
        { name: 'Awarded', value: 13, color: '#1e8e5a' },
        { name: 'Closed', value: 7, color: '#8a94a8' },
        { name: 'Cancelled', value: 4, color: '#c0392b' },
      ];

  const quickActions = [
    { label: t('dashboard.actions.createRfq'), icon: Plus, to: '/gov/planner', show: isEngineer || isAdmin },
    { label: t('dashboard.actions.registerVendor'), icon: UserPlus, to: '/gov/vendors', show: isOfficer || isAdmin },
    { label: t('dashboard.actions.uploadReport'), icon: Upload, to: '/gov/quality', show: canQuality },
    { label: t('dashboard.actions.approveVendor'), icon: CheckCircle2, to: '/gov/vendors', show: canVendors },
    { label: t('dashboard.actions.generateReport'), icon: FileText, to: '/gov/analytics', show: canOrders },
    { label: t('dashboard.actions.viewAnalytics'), icon: BarChart3, to: '/gov/analytics', show: canOrders },
  ].filter((a) => a.show);

  const govKpis = [
    {
      label: t('dashboard.kpi.complianceRate'),
      value: `${compliancePct}%`,
      trend: '+2.3%',
      trendDirection: 'up' as const,
      icon: <ShieldCheck className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'success' as const,
    },
    {
      label: t('dashboard.kpi.pendingApprovals'),
      value: data.pendingKyc || 15,
      trend: t('dashboard.kpi.zeroCritical'),
      trendDirection: 'neutral' as const,
      icon: <Clock className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'warning' as const,
    },
    {
      label: t('dashboard.kpi.rfqClosingToday'),
      value: data.floated || 1,
      trend: '₹ 24.6 Cr',
      trendDirection: 'up' as const,
      icon: <ClipboardList className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'brand' as const,
    },
    {
      label: t('dashboard.kpi.vendorRegistrations'),
      value: data.pendingKyc || 1,
      trend: t('dashboard.kpi.thisWeek', { count: 11 }),
      trendDirection: 'up' as const,
      icon: <Building2 className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'info' as const,
    },
    {
      label: t('dashboard.kpi.criticalAlerts'),
      value: data.qualityAlerts || 2,
      trend: t('dashboard.kpi.highPriority', { count: 1 }),
      trendDirection: 'down' as const,
      icon: <AlertTriangle className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'danger' as const,
    },
    {
      label: t('dashboard.kpi.budgetUtilization'),
      value: '72%',
      trend: '₹ 4.2 Cr used',
      trendDirection: 'up' as const,
      icon: <IndianRupee className={ICON_SIZE_KPI} strokeWidth={2} />,
      tone: 'success' as const,
    },
  ];

  const modules = [
    {
      show: isEngineer || isAdmin || canOrders,
      title: t('dashboard.engineer.orders'),
      to: '/gov/orders',
      tone: 'brand' as const,
      icon: <ClipboardList className="h-5 w-5" strokeWidth={2} />,
      stat: t('dashboard.modules.activeRfq', { count: data.floated || 1 }),
      subStats: [
        { label: t('dashboard.modules.awarded'), value: String(data.awarded || 0) },
        { label: t('dashboard.modules.pending'), value: String(data.pendingKyc || 1) },
      ],
    },
    {
      show: isOfficer || isAdmin || canVendors,
      title: t('dashboard.officer.vendors'),
      to: '/gov/vendors',
      tone: 'warning' as const,
      icon: <Building2 className="h-5 w-5" strokeWidth={2} />,
      stat: t('dashboard.modules.pendingKyc', { count: data.pendingKyc || 1 }),
      subStats: [{ label: t('dashboard.modules.approved'), value: '24' }],
      badge: data.pendingKyc > 0 ? String(data.pendingKyc) : undefined,
    },
    {
      show: isEngineer || isOfficer || isAdmin || canQuality,
      title: t('quality.nav'),
      to: '/gov/quality',
      tone: 'success' as const,
      icon: <ShieldCheck className="h-5 w-5" strokeWidth={2} />,
      stat: t('dashboard.modules.qualityAlerts', { count: data.qualityAlerts || 2 }),
      subStats: [{ label: t('dashboard.modules.onTrack'), value: `${compliancePct}%` }],
    },
    {
      show: isOfficer || isAdmin || canOrders,
      title: t('analytics.nav'),
      to: '/gov/analytics',
      tone: 'info' as const,
      icon: <BarChart3 className="h-5 w-5" strokeWidth={2} />,
      stat: t('dashboard.modules.yoyGrowth', { pct: '15.4' }),
      subStats: [{ label: t('dashboard.modules.peakValue'), value: '₹ 60 Cr' }],
    },
    {
      show: isAuditor || isOfficer || isAdmin,
      title: t('audit.nav'),
      to: '/gov/audit',
      tone: 'danger' as const,
      icon: <ScrollText className="h-5 w-5" strokeWidth={2} />,
      stat: t('dashboard.modules.auditEvents', { count: 128 }),
      subStats: [{ label: t('dashboard.modules.today'), value: '12' }],
    },
    {
      show: isEngineer || isAdmin,
      title: t('dashboard.engineer.planner'),
      to: '/gov/planner',
      tone: 'accent' as const,
      icon: <CalendarDays className="h-5 w-5" strokeWidth={2} />,
      stat: t('dashboard.modules.scheduledTests', { count: 8 }),
      subStats: [{ label: t('dashboard.modules.certificates'), value: '3' }],
    },
  ].filter((m) => m.show);

  const priorityActions = [
    { label: t('dashboard.priority.expiringRfq'), count: 1, tone: 'warning' },
    { label: t('dashboard.priority.openEscalations'), count: data.escalations || 2, tone: 'danger' },
    { label: t('dashboard.priority.kycReview'), count: data.pendingKyc || 3, tone: 'warning' },
    { label: t('dashboard.priority.certRenewal'), count: 2, tone: 'info' },
  ];

  const notifications = [
    { text: t('dashboard.notif.kycAwaiting'), time: t('dashboard.notif.minAgo', { n: 8 }) },
    { text: t('dashboard.notif.rfqClosing'), time: t('dashboard.notif.hrAgo', { n: 1 }) },
    { text: t('dashboard.notif.vendorApproved'), time: t('dashboard.notif.hrAgo', { n: 3 }) },
    { text: t('dashboard.notif.qualityAlert'), time: t('dashboard.notif.hrAgo', { n: 5 }) },
  ];

  const aiInsights = [
    t('dashboard.insights.vendorApprovals'),
    t('dashboard.insights.complianceTrend'),
    t('dashboard.insights.budgetForecast'),
  ];

  const deptPerformance = [
    { label: t('dashboard.dept.roads'), pct: 78 },
    { label: t('dashboard.dept.buildings'), pct: 64 },
    { label: t('dashboard.dept.water'), pct: 71 },
    { label: t('dashboard.dept.quality'), pct: 89 },
  ];

  const recentActivities = [
    { icon: ClipboardList, text: t('dashboard.activity.rfqFloated'), time: t('dashboard.notif.hrAgo', { n: 1 }) },
    { icon: Award, text: t('dashboard.activity.vendorApproved'), time: t('dashboard.notif.hrAgo', { n: 2 }) },
    { icon: FileBarChart, text: t('dashboard.activity.reportUploaded'), time: t('dashboard.notif.hrAgo', { n: 4 }) },
    { icon: CheckCircle, text: t('dashboard.activity.kycCompleted'), time: t('dashboard.notif.hrAgo', { n: 6 }) },
    { icon: Trophy, text: t('dashboard.activity.awardIssued'), time: t('dashboard.notif.hrAgo', { n: 8 }) },
  ];

  const deadlines = [
    { date: '17 Jul', task: t('dashboard.deadline.kycBatch'), priority: 'MEDIUM' },
    { date: '20 Jul', task: t('dashboard.deadline.rfqReview'), priority: 'HIGH' },
    { date: '25 Jul', task: t('dashboard.deadline.qualityAudit'), priority: 'LOW' },
    { date: '31 Jul', task: t('dashboard.deadline.budgetReport'), priority: 'HIGH' },
  ];

  const priorityColors: Record<string, string> = {
    HIGH: 'bg-danger-bg text-danger',
    MEDIUM: 'bg-warning-bg text-warning',
    LOW: 'bg-success-bg text-success',
  };

  return (
    <section className="dash-home mx-auto max-w-[90rem] space-y-6">
      {/* Welcome banner */}
      <header className="dash-welcome relative overflow-hidden rounded-2xl border border-brand/20 bg-gradient-to-br from-[#1a3a6b] via-[#1e4480] to-[#12294d] p-6 text-white sm:p-8">
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-accent/15 blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold sm:text-2xl">
                {t(greetingKey())}, {session?.fullName ?? t('gov.title')}
              </h1>
              <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-200 ring-1 ring-success/30">
                <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
                {t('dashboard.verified')}
              </span>
            </div>
            <p className="mt-2 text-sm text-white/80">
              {t('dashboard.managingWorks', { district: orgName })}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/15">
                {formatDateLong(new Date())}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/15">
                RFQ: {data.floated || 1} {t('dashboard.open')}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/15">
                <MapPin className="h-3 w-3" strokeWidth={2} />
                {orgName}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium ring-1 ring-white/15">
                {districtId}
              </span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold ring-1 ring-white/15">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {t('dashboard.systemsLive')}
            </div>
            <p className="mt-2 text-xs text-white/60">FY 2024-25 · Q1 Active</p>
          </div>
        </div>
      </header>

      {/* Quick actions */}
      {quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickActions.map((a) => (
            <Link
              key={a.label}
              to={a.to}
              className="gov-btn-secondary gap-2 px-4 py-2 text-xs sm:text-sm"
            >
              <a.icon className="h-4 w-4" strokeWidth={2} />
              {a.label}
            </Link>
          ))}
        </div>
      )}

      {/* KPI row */}
      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-3">
          {t('dashboard.kpiTitleGov')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {govKpis.map((k) => (
            <KpiCard
              key={k.label}
              label={k.label}
              value={k.value}
              icon={k.icon}
              tone={k.tone}
              trend={k.trend}
              trendDirection={k.trendDirection}
              loading={data.isLoading}
            />
          ))}
        </div>
      </div>

      {/* Operational intelligence */}
      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-3">
          {t('dashboard.operationalIntel')}
        </h2>
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <div className="grid gap-4 lg:grid-cols-2">
            <PanelCard title={t('dashboard.procurementTrend')}>
              <ProcurementTrendChart />
              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center text-[11px]">
                <div>
                  <p className="text-ink-3">{t('dashboard.peakValue')}</p>
                  <p className="font-bold text-ink">₹ 60 Cr</p>
                </div>
                <div>
                  <p className="text-ink-3">{t('dashboard.monthlyAvg')}</p>
                  <p className="font-bold text-ink">₹ 41 Cr</p>
                </div>
                <div>
                  <p className="text-ink-3">{t('dashboard.yoyGrowth')}</p>
                  <p className="font-bold text-success">+15.4%</p>
                </div>
              </div>
            </PanelCard>

            <PanelCard title={t('dashboard.rfqStatus')}>
              <RfqStatusDonut data={rfqDonutData} />
              <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                {rfqDonutData.map((d, i) => (
                  <span key={d.name} className="flex items-center gap-1.5 text-slate">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: ['#1a6fb0', '#1e8e5a', '#8a94a8', '#c0392b'][i % 4],
                      }}
                    />
                    {d.name} ({d.value})
                  </span>
                ))}
              </div>
            </PanelCard>

            <PanelCard title={t('dashboard.budgetGauge')} className="lg:col-span-2">
              <div className="flex flex-col items-center sm:flex-row sm:justify-around sm:gap-8">
                <BudgetGauge pct={72} utilized="₹ 4.2 Cr" remaining="₹ 5.8 Cr" />
                <div className="mt-4 max-w-xs text-center text-sm text-slate sm:mt-0 sm:text-left">
                  <p>{t('dashboard.budgetDesc')}</p>
                  <p className="mt-2 font-display text-lg font-bold text-ink">
                    {t('dashboard.totalBudget')}: ₹ 10 Cr
                  </p>
                </div>
              </div>
            </PanelCard>
          </div>

          <div className="space-y-4">
            <PanelCard title={t('dashboard.priorityActions')}>
              <ul className="space-y-2.5">
                {priorityActions.map((a) => (
                  <li key={a.label} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink">{a.label}</span>
                    <span
                      className={`flex h-6 min-w-[1.5rem] items-center justify-center rounded-md px-1.5 text-xs font-bold ${
                        a.tone === 'danger'
                          ? 'bg-danger-bg text-danger'
                          : a.tone === 'warning'
                            ? 'bg-warning-bg text-warning'
                            : 'bg-info-bg text-info'
                      }`}
                    >
                      {a.count}
                    </span>
                  </li>
                ))}
              </ul>
            </PanelCard>

            <PanelCard title={t('dashboard.notificationsPanel')}>
              <ul className="space-y-3">
                {notifications.map((n) => (
                  <li key={n.text} className="border-b border-line pb-3 last:border-0 last:pb-0">
                    <p className="text-sm text-ink">{n.text}</p>
                    <p className="mt-0.5 text-[11px] text-ink-3">{n.time}</p>
                  </li>
                ))}
              </ul>
            </PanelCard>

            <PanelCard
              title={t('dashboard.aiInsights')}
              badge={
                <span className="rounded bg-success-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-success">
                  Live
                </span>
              }
            >
              <ul className="space-y-2.5">
                {aiInsights.map((insight) => (
                  <li key={insight} className="flex gap-2 text-sm text-ink">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
                    {insight}
                  </li>
                ))}
              </ul>
            </PanelCard>
          </div>
        </div>
      </div>

      {/* Department modules */}
      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-3">
          {t('dashboard.modulesTitle')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <ModuleCard
              key={m.to}
              title={m.title}
              to={m.to}
              tone={m.tone}
              icon={m.icon}
              stat={m.stat}
              subStats={m.subStats}
              badge={m.badge}
            />
          ))}
        </div>
      </div>

      {/* Performance section */}
      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-ink-3">
          {t('dashboard.performanceTitle')}
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <PanelCard title={t('dashboard.districtPerformance')}>
            <DistrictPerformanceMap
              districtName={session?.roles?.[0]?.orgName}
              orgPath={session?.roles?.[0]?.orgPath}
            />
          </PanelCard>

          <PanelCard title={t('dashboard.deptPerformance')}>
            <ul className="space-y-4">
              {deptPerformance.map((d) => (
                <li key={d.label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium text-ink">{d.label}</span>
                    <span className="font-bold tabular-nums text-brand">{d.pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand to-brand/70 transition-all"
                      style={{ width: `${d.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </PanelCard>

          <PanelCard title={t('dashboard.budgetSummary')}>
            <p className="text-sm text-slate">{t('dashboard.budgetUtilized', { pct: 42 })}</p>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full w-[42%] rounded-full bg-success" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-ink-3">{t('dashboard.utilized')}</p>
                <p className="font-display text-xl font-bold text-ink">₹ 4.2 Cr</p>
              </div>
              <div>
                <p className="text-xs text-ink-3">{t('dashboard.remaining')}</p>
                <p className="font-display text-xl font-bold text-ink">₹ 5.8 Cr</p>
              </div>
            </div>
          </PanelCard>
        </div>
      </div>

      {/* Activities & deadlines */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PanelCard title={t('dashboard.recentActivities')}>
          <ul className="relative space-y-0">
            {recentActivities.map((a, i) => (
              <li key={a.text} className="relative flex gap-3 pb-5 last:pb-0">
                {i < recentActivities.length - 1 && (
                  <span
                    className="absolute left-[15px] top-8 h-[calc(100%-12px)] w-px bg-line"
                    aria-hidden
                  />
                )}
                <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-tint text-brand">
                  <a.icon className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-sm text-ink">{a.text}</p>
                  <p className="text-[11px] text-ink-3">{a.time}</p>
                </div>
              </li>
            ))}
          </ul>
        </PanelCard>

        <PanelCard title={t('dashboard.upcomingDeadlines')}>
          <ul className="space-y-3">
            {deadlines.map((d) => (
              <li
                key={d.task}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/50 px-4 py-3"
              >
                <div>
                  <p className="text-xs font-bold text-brand">{d.date}</p>
                  <p className="text-sm font-medium text-ink">{d.task}</p>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-bold ${priorityColors[d.priority]}`}
                >
                  {d.priority}
                </span>
              </li>
            ))}
          </ul>
        </PanelCard>
      </div>

      {/* Recent orders from API */}
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
