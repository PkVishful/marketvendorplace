import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { TnEmblem } from '@/components/TnEmblem';

export function DashboardFooter() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className="dash-footer shrink-0 text-white">
      <div className="gov-stripe" aria-hidden />
      <div className="px-6 py-8 sm:px-8 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[1.2fr_2fr_auto] lg:items-start">
          <div>
            <div className="flex items-center gap-3">
              <TnEmblem tone="onDark" className="h-9 w-auto opacity-95" />
              <div>
                <p className="font-display text-sm font-bold">{t('app.brand')}</p>
                <p className="text-[11px] text-white/70">{t('shell.deptName')}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(['secure', 'transparent', 'trusted'] as const).map((key) => (
                <span
                  key={key}
                  className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                >
                  {t(`dashboard.footer.${key}`)}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">
                {t('dashboard.footer.access')}
              </p>
              <ul className="mt-3 space-y-2 text-xs text-white/80">
                <li>
                  <Link to="/verify" className="hover:text-white hover:underline">
                    {t('verify.title')}
                  </Link>
                </li>
                <li>
                  <a href="mailto:support@eworks.tn.gov.in" className="hover:text-white hover:underline">
                    {t('dashboard.footer.support')}
                  </a>
                </li>
                <li>{t('shell.gigw')}</li>
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">
                {t('dashboard.footer.portal')}
              </p>
              <ul className="mt-3 space-y-2 text-xs text-white/80">
                <li>{t('dashboard.footer.testingMarketplace')}</li>
                <li>{t('shell.authBullet2')}</li>
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/55">
                {t('dashboard.footer.build')}
              </p>
              <ul className="mt-3 space-y-2 text-xs text-white/80">
                <li>{t('dashboard.footer.version')}</li>
                <li>{t('shell.lastUpdated', { year })}</li>
              </ul>
            </div>
          </div>

          <div className="hidden justify-end lg:flex">
            <TnEmblem tone="onDark" className="h-16 w-auto opacity-90" />
          </div>
        </div>
      </div>
    </footer>
  );
}
