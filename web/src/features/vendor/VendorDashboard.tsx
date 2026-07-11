import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/auth/useSession';
import { useKycOnboarding } from '@/features/kyc/useKyc';

export function VendorDashboard() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const { data: kyc } = useKycOnboarding();
  const isLabOwner = session?.roles?.some((r) => r.code === 'LAB_VENDOR');
  const vendorStatus = kyc?.vendor?.status;
  const needsKyc =
    isLabOwner &&
    (!kyc?.vendor || vendorStatus === 'DRAFT' || vendorStatus === 'REJECTED');

  const cards = [
    {
      title: t('nav.orders'),
      desc: t('dashboard.vendor.ordersDesc'),
      to: '/vendor/orders',
      stat: t('dashboard.vendor.liveTenders'),
      tone: 'border-l-brand',
    },
    {
      title: t('nav.jobs'),
      desc: t('dashboard.vendor.jobsDesc'),
      to: '/vendor/jobs',
      stat: t('dashboard.vendor.fieldWork'),
      tone: 'border-l-success',
    },
    {
      title: t('nav.notifications'),
      desc: t('dashboard.vendor.alertsDesc'),
      to: '/vendor/notifications',
      stat: t('dashboard.vendor.alerts'),
      tone: 'border-l-accent',
    },
    {
      title: t('nav.earnings'),
      desc: t('dashboard.vendor.earningsDesc'),
      to: '/vendor/earnings',
      stat: t('dashboard.vendor.payments'),
      tone: 'border-l-warning',
    },
  ];

  return (
    <section className="space-y-6">
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

      <header className="gov-card overflow-hidden">
        <div className="border-b border-line bg-brand-tint px-5 py-4 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-wider text-brand">
            {t('nav.vendorBadge')}
          </p>
          <h2 className="mt-1 font-display text-xl font-bold text-ink">
            {session?.vendorName ?? session?.fullName ?? t('vendor.portalTitle')}
          </h2>
          <p className="mt-2 text-sm text-slate">{t('dashboard.vendor.subtitle')}</p>
        </div>
        <div className="grid gap-px bg-line sm:grid-cols-2">
          {cards.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className={`block bg-surface p-5 transition hover:bg-surface-2 ${c.tone} border-l-4`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-3">{c.stat}</p>
              <h3 className="mt-1 font-semibold text-ink">{c.title}</h3>
              <p className="mt-2 text-sm text-slate">{c.desc}</p>
            </Link>
          ))}
        </div>
      </header>

      <div className="gov-card border-l-4 border-l-warning p-4 text-sm text-slate">
        <p className="font-semibold text-ink">{t('dashboard.vendor.accreditationTitle')}</p>
        <p className="mt-1">{t('dashboard.vendor.accreditationBody')}</p>
      </div>
    </section>
  );
}
