import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function GovFooter() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="gov-stripe" aria-hidden="true" />
      <div className="mx-auto max-w-portal px-4 py-8 sm:px-6">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="font-display text-sm font-bold text-brand">{t('shell.deptName')}</p>
            <p className="mt-1 text-xs text-slate">{t('shell.deptNameTa')}</p>
          </div>
          <div className="text-xs text-slate">
            <p>{t('shell.gigw')}</p>
            <p className="mt-2">
              <Link to="/verify" className="font-semibold text-brand hover:underline">
                {t('verify.title')}
              </Link>
            </p>
          </div>
          <div className="text-xs text-slate sm:text-right">
            <p>{t('shell.contact')}</p>
            <p className="mt-1 tabular-nums text-ink-3">
              {t('shell.lastUpdated', { year })}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
