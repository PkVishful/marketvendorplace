import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/auth/useSession';

import type { Session } from '@/types/domain';

function roleCodes(session: Session | undefined) {
  return session?.roles?.map((r) => r.code) ?? [];
}

export function RoleDashboard() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const codes = roleCodes(session);

  const isEngineer = codes.some((c) => c === 'SITE_ENGINEER');
  const isOfficer = codes.some((c) =>
    ['DISTRICT_OFFICER', 'SUPERINTENDING_ENGINEER', 'EXECUTIVE_ENGINEER'].includes(c),
  );
  const isAuditor = codes.includes('AUDITOR');
  const isAdmin = codes.includes('HEAD_ADMIN');

  const widgets = [
    {
      show: isEngineer || isAdmin,
      title: t('dashboard.engineer.planner'),
      desc: t('dashboard.engineer.plannerDesc'),
      to: '/gov/planner',
      tone: 'border-l-brand',
    },
    {
      show: isEngineer || isOfficer || isAdmin,
      title: t('dashboard.engineer.orders'),
      desc: t('dashboard.engineer.ordersDesc'),
      to: '/gov/orders',
      tone: 'border-l-accent',
    },
    {
      show: isOfficer || isAdmin,
      title: t('dashboard.officer.vendors'),
      desc: t('dashboard.officer.vendorsDesc'),
      to: '/gov/vendors',
      tone: 'border-l-warning',
    },
    {
      show: isEngineer || isOfficer || isAdmin,
      title: t('quality.nav'),
      desc: t('dashboard.qualityDesc'),
      to: '/gov/quality',
      tone: 'border-l-success',
    },
    {
      show: isOfficer || isAdmin,
      title: t('analytics.nav'),
      desc: t('dashboard.analyticsDesc'),
      to: '/gov/analytics',
      tone: 'border-l-info',
    },
    {
      show: isAuditor || isOfficer || isAdmin,
      title: t('audit.nav'),
      desc: t('dashboard.auditDesc'),
      to: '/gov/audit',
      tone: 'border-l-danger',
    },
  ].filter((w) => w.show);

  return (
    <section className="space-y-6">
      <header className="gov-card border-l-4 border-l-accent p-6">
        <p className="text-xs font-bold uppercase tracking-wider text-accent">
          {t('dashboard.welcome')}
        </p>
        <h2 className="mt-1 font-display text-xl font-bold text-ink">
          {session?.fullName ?? t('gov.title')}
        </h2>
        <p className="mt-2 text-sm text-slate">{t('dashboard.govSubtitle')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {widgets.map((w) => (
          <Link
            key={w.to}
            to={w.to}
            className={`gov-card border-l-4 ${w.tone} block p-5 transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent`}
          >
            <h3 className="font-semibold text-ink">{w.title}</h3>
            <p className="mt-2 text-sm text-slate">{w.desc}</p>
            <span className="mt-4 inline-block text-sm font-semibold text-brand">
              {t('gov.openModule')} →
            </span>
          </Link>
        ))}
      </div>

      <p className="text-center text-xs text-ink-3">{t('dashboard.rlsNote')}</p>
    </section>
  );
}
