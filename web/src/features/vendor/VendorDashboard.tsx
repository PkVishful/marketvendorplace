import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/auth/useSession';
import { useKycOnboarding } from '@/features/kyc/useKyc';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { ModuleCard } from '@/components/dashboard/ModuleCard';
import { useVendorDashboardData } from '@/features/dashboard/useDashboardData';
import { formatInr, relativeTime } from '@/lib/time';
import {
  Bell,
  ClipboardList,
  ICON_SIZE_KPI,
  IndianRupee,
  MapPin,
} from '@/lib/navIcons';

export function VendorDashboard() {
  const { t, i18n } = useTranslation();
  const { data: session } = useSession();
  const { data: kyc } = useKycOnboarding();
  const data = useVendorDashboardData(Boolean(session?.authenticated));
  const isLabOwner = session?.roles?.some((r) => r.code === 'LAB_VENDOR');
  const isFieldOnly =
    session?.roles?.some((r) => r.code === 'FIELD_TECHNICIAN') &&
    !session?.roles?.some((r) => r.code === 'LAB_VENDOR');
  const vendorStatus = kyc?.vendor?.status;
  const needsKyc =
    isLabOwner &&
    (!kyc?.vendor || vendorStatus === 'DRAFT' || vendorStatus === 'REJECTED');

  const modules = [
    !isFieldOnly && {
      title: t('nav.orders'),
      desc: t('dashboard.vendor.ordersDesc'),
      to: '/vendor/orders',
      tone: 'brand' as const,
    },
    {
      title: t('nav.jobs'),
      desc: t('dashboard.vendor.jobsDesc'),
      to: '/vendor/jobs',
      tone: 'success' as const,
    },
    {
      title: t('nav.notifications'),
      desc: t('dashboard.vendor.alertsDesc'),
      to: '/vendor/notifications',
      tone: 'accent' as const,
      badge: data.unread > 0 ? String(data.unread) : undefined,
    },
    !isFieldOnly && {
      title: t('nav.earnings'),
      desc: t('dashboard.vendor.earningsDesc'),
      to: '/vendor/earnings',
      tone: 'warning' as const,
    },
  ].filter(Boolean) as {
    title: string;
    desc: string;
    to: string;
    tone: 'brand' | 'accent' | 'success' | 'warning';
    badge?: string;
  }[];

  return (
    <section className="dash-home space-y-8">
      {needsKyc && (
        <div className="gov-card border-l-4 border-l-accent p-5">
          <h3 className="font-semibold text-ink">{t('kyc.bannerTitle')}</h3>
          <p className="mt-1 text-sm text-slate">{t('kyc.bannerBody')}</p>
          <Link to="/vendor/onboarding" className="gov-btn-accent mt-4 inline-flex">
            {t('kyc.bannerCta')}
          </Link>
        </div>
      )}

      {isLabOwner && vendorStatus === 'SUBMITTED' && (
        <div className="gov-card border-l-4 border-l-info p-5 text-sm text-slate">
          <p className="font-semibold text-ink">{t('kyc.pendingTitle')}</p>
          <p className="mt-1">{t('kyc.pendingBody')}</p>
        </div>
      )}

      <header className="dash-welcome relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-brand via-brand to-brand-dark p-6 text-white sm:p-8">
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-accent/20 blur-2xl"
          aria-hidden
        />
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent">{t('nav.vendorBadge')}</p>
        <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">
          {session?.vendorName ?? session?.fullName ?? t('vendor.portalTitle')}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-white/80">{t('dashboard.vendor.subtitle')}</p>
      </header>

      <div>
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-3">{t('dashboard.kpiTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!isFieldOnly && (
            <KpiCard
              label={t('dashboard.kpi.openTenders')}
              value={data.openTenders}
              icon={<ClipboardList className={ICON_SIZE_KPI} strokeWidth={2} />}
              tone="brand"
              loading={data.isLoading}
            />
          )}
          <KpiCard
            label={t('dashboard.kpi.activeJobs')}
            value={data.activeJobs}
            icon={<MapPin className={ICON_SIZE_KPI} strokeWidth={2} />}
            tone="success"
            loading={data.isLoading}
          />
          <KpiCard
            label={t('dashboard.kpi.unreadAlerts')}
            value={data.unread}
            icon={<Bell className={ICON_SIZE_KPI} strokeWidth={2} />}
            tone="accent"
            loading={data.isLoading}
          />
          {!isFieldOnly && (
            <KpiCard
              label={t('dashboard.kpi.heldPayments')}
              value={formatInr(data.heldPaise)}
              hint={
                data.releasedPaise > 0
                  ? t('dashboard.kpi.releasedHint', { amount: formatInr(data.releasedPaise) })
                  : undefined
              }
              icon={<IndianRupee className={ICON_SIZE_KPI} strokeWidth={2} />}
              tone="warning"
              loading={data.isLoading}
            />
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-3">{t('dashboard.modulesTitle')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => (
            <ModuleCard
              key={m.to}
              title={m.title}
              description={m.desc}
              to={m.to}
              tone={m.tone}
              badge={m.badge}
            />
          ))}
        </div>
      </div>

      {data.recentNotifications.length > 0 && (
        <div className="gov-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-semibold text-ink">{t('dashboard.recentActivity')}</h2>
            <Link to="/vendor/notifications" className="text-sm font-semibold text-brand hover:underline">
              {t('dashboard.viewAll')} →
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {data.recentNotifications.map((n) => (
              <li key={n.id} className="px-5 py-3.5">
                <p className={`text-sm ${n.readAt ? 'text-slate' : 'font-medium text-ink'}`}>
                  {t(`event.${n.eventType}.title`)}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">{relativeTime(n.createdAt, i18n.language)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLabOwner && (
        <div className="gov-card border-l-4 border-l-warning p-4 text-sm text-slate">
          <p className="font-semibold text-ink">{t('dashboard.vendor.accreditationTitle')}</p>
          <p className="mt-1">{t('dashboard.vendor.accreditationBody')}</p>
        </div>
      )}
    </section>
  );
}
