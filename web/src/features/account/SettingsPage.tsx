import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSession, useSignOut } from '@/auth/useSession';
import { LANGUAGES } from '@/i18n';
import { useTheme } from '@/hooks/useTheme';
import { primaryOrgScope } from '@/lib/navConfig';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { data: session } = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();

  function handleLangChange(code: string) {
    void i18n.changeLanguage(code);
    localStorage.setItem('eworks-lang', code);
  }

  function handleSignOut() {
    signOut.mutate(undefined, { onSuccess: () => navigate('/sign-in') });
  }

  const orgLabel = session?.authenticated ? primaryOrgScope(session) : '—';

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header>
        <h2 className="font-display text-xl font-bold text-ink">{t('settings.title')}</h2>
        <p className="mt-1 text-sm text-slate">{t('settings.subtitle')}</p>
      </header>

      <div className="gov-card divide-y divide-line overflow-hidden">
        <div className="p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3">
            {t('settings.profileTitle')}
          </h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
              <dt className="text-slate">{t('settings.fullName')}</dt>
              <dd className="font-semibold text-ink">{session?.fullName ?? '—'}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
              <dt className="text-slate">{t('settings.mobile')}</dt>
              <dd className="font-semibold tabular-nums text-ink">{session?.phone ?? '—'}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
              <dt className="text-slate">{t('settings.orgScope')}</dt>
              <dd className="font-semibold text-ink">{orgLabel}</dd>
            </div>
          </dl>
        </div>

        <div className="p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3">
            {t('settings.appearanceTitle')}
          </h3>
          <p className="mt-1 text-sm text-slate">{t('settings.appearanceDesc')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {(['light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  if (theme !== mode) toggleTheme();
                }}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  theme === mode
                    ? 'bg-brand text-white'
                    : 'border border-line bg-surface text-ink hover:bg-surface-2'
                }`}
              >
                {t(`settings.theme.${mode}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3">
            {t('settings.languageTitle')}
          </h3>
          <p className="mt-1 text-sm text-slate">{t('settings.languageDesc')}</p>
          <label className="mt-4 block max-w-xs">
            <span className="sr-only">{t('settings.languageTitle')}</span>
            <select
              value={i18n.language}
              onChange={(e) => handleLangChange(e.target.value)}
              className="gov-input w-full"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3">
            {t('settings.sessionTitle')}
          </h3>
          <p className="mt-1 text-sm text-slate">{t('settings.sessionDesc')}</p>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signOut.isPending}
            className="gov-btn-secondary mt-4 border-danger/30 text-danger hover:bg-danger-bg"
          >
            {t('dev.signOut')}
          </button>
        </div>
      </div>
    </section>
  );
}
