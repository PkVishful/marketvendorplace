import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TnEmblem } from '@/components/TnEmblem';
import { EmailSignIn } from '@/features/auth/EmailSignIn';
import { LANGUAGES } from '@/i18n';
import { Building2, Moon, ShieldCheck, Sun, TestTube2 } from '@/lib/navIcons';

function InfoFeature({
  icon,
  title,
  desc,
  delay,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  delay?: string;
}) {
  return (
    <li className={`sign-in-feature sign-in-fade-up ${delay ?? ''}`}>
      <span className="sign-in-feature-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-white/75">{desc}</p>
      </div>
    </li>
  );
}

export function DevSignIn({
  theme,
  onToggleTheme,
  lang,
  onLangChange,
}: {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  lang: string;
  onLangChange: (code: string) => void;
}) {
  const { t } = useTranslation();

  const features = [
    {
      icon: <TestTube2 className="h-5 w-5" strokeWidth={2} />,
      title: t('signIn.forLabsTitle'),
      desc: t('signIn.forLabsDesc'),
      delay: 'sign-in-fade-up-d1',
    },
    {
      icon: <Building2 className="h-5 w-5" strokeWidth={2} />,
      title: t('signIn.forOfficersTitle'),
      desc: t('signIn.forOfficersDesc'),
      delay: 'sign-in-fade-up-d2',
    },
    {
      icon: <ShieldCheck className="h-5 w-5" strokeWidth={2} />,
      title: t('signIn.forPublicTitle'),
      desc: t('signIn.forPublicDesc'),
      delay: 'sign-in-fade-up-d3',
    },
  ];

  return (
    <div className="sign-in-root">
      <section className="sign-in-hero" aria-label={t('dev.signInTitle')}>
        <div className="sign-in-orb sign-in-orb-a" aria-hidden="true" />
        <div className="sign-in-orb sign-in-orb-b" aria-hidden="true" />

        <div className="relative z-10 mx-auto w-full max-w-lg">
          <div className="sign-in-fade-up">
            <div className="gov-stripe mb-6 max-w-[120px] rounded-full" aria-hidden="true" />
            <div className="flex items-center gap-4">
              <TnEmblem tone="onDark" className="h-16 w-auto sm:h-[4.5rem]" />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">
                  {t('app.subtitle')}
                </p>
                <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
                  {t('app.brand')}
                </h1>
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-8 sign-in-fade-up sign-in-fade-up-d1">
            <h2 className="font-display text-2xl font-bold leading-tight sm:text-3xl">
              {t('signIn.heroTitle')}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-white/80 sm:text-base">
              {t('signIn.heroDesc')}
            </p>
          </div>

          <ul className="relative z-10 mt-8 space-y-3">
            {features.map((f) => (
              <InfoFeature key={f.title} icon={f.icon} title={f.title} desc={f.desc} delay={f.delay} />
            ))}
          </ul>

          <p className="relative z-10 mt-10 text-xs text-white/55">{t('signIn.footer')}</p>
        </div>
      </section>

      <section className="sign-in-panel">
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-end gap-2 border-b border-line/60 bg-white/95 px-5 py-4 backdrop-blur-sm sm:px-8">
          <select
            aria-label={t('dev.language')}
            value={lang}
            onChange={(e) => onLangChange(e.target.value)}
            className="sign-in-input max-w-[120px] !min-h-[40px] !py-2 text-xs font-medium"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={t('shell.toggleTheme')}
            className="grid min-h-[40px] min-w-[40px] place-items-center rounded-xl border border-line text-sm transition hover:bg-surface-2"
          >
            {theme === 'dark' ? (
              <Sun className="h-5 w-5" strokeWidth={2} />
            ) : (
              <Moon className="h-5 w-5" strokeWidth={2} />
            )}
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-5 py-8 sm:px-10 sm:py-10 lg:justify-start lg:px-12">
          <div className="sign-in-slide-in mx-auto w-full max-w-md">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent">
              {t('dev.signInTitle')}
            </p>
            {/* Title and helper copy live in EmailSignIn so the heading matches
                the step being shown (credentials vs second factor). */}
            <div className="mt-4">
              <EmailSignIn />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
