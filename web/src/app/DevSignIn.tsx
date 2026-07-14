import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDevLogin } from '@/auth/useSession';
import { TnEmblem } from '@/components/TnEmblem';
import { PhoneSignIn } from '@/features/auth/PhoneSignIn';
import { LANGUAGES } from '@/i18n';
import { Building2, Moon, ShieldCheck, Sun, TestTube2 } from '@/lib/navIcons';
import { DEV_VENDOR_USERS, DEV_CONTRACTOR_USERS, devUserById, govUsersByOrgLevel } from './devUsers';
import { portalHomePathForSession, resolvePortal } from '@/types/domain';

function UserGroup({
  title,
  accent,
  users,
  onPick,
  disabled,
  showScope,
}: {
  title: string;
  accent: 'vendor' | 'gov' | 'contractor';
  users: typeof DEV_VENDOR_USERS;
  onPick: (userId: string) => void;
  disabled: boolean;
  showScope?: boolean;
}) {
  const dot = accent === 'gov' ? 'bg-brand' : accent === 'contractor' ? 'bg-accent' : 'bg-success';

  return (
    <div className="overflow-hidden rounded-2xl border border-line/80 bg-surface-2/40">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
        <h2 className="text-sm font-bold text-ink">{title}</h2>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {users.map((v) => (
          <button
            key={v.userId}
            type="button"
            disabled={disabled}
            onClick={() => onPick(v.userId)}
            className="sign-in-persona group"
          >
            <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-brand text-xs font-bold text-white transition-transform group-hover:scale-105">
              {v.label.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{v.label}</span>
                {showScope && v.scopeLabel && (
                  <span className="rounded-md bg-brand-tint px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                    {v.scopeLabel}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-slate">{v.sub}</span>
            </span>
            <span className="text-brand opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function orgLevelLabel(level: string, t: (k: string) => string): string {
  const key = `signIn.orgLevel.${level.toLowerCase()}`;
  const translated = t(key);
  return translated !== key ? translated : level.replace(/_/g, ' ');
}

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
  const login = useDevLogin();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'phone' | 'dev'>('phone');

  function pick(userId: string) {
    login.mutate(userId, {
      onSuccess: (session) => {
        const portal = resolvePortal(session) ?? devUserById(session.userId)?.portal;
        if (portal) navigate(portalHomePathForSession(session));
      },
    });
  }

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
            <h2 className="mt-2 font-display text-2xl font-bold text-ink">
              {tab === 'phone' ? t('auth.phoneTitle') : t('auth.tabDev')}
            </h2>
            <p className="mt-2 text-sm text-slate">
              {tab === 'phone' ? t('auth.phoneHelp') : t('signIn.devHelp')}
            </p>

            {import.meta.env.DEV && (
              <div className="mt-6 flex rounded-2xl bg-surface-2 p-1.5">
                <button
                  type="button"
                  onClick={() => setTab('phone')}
                  className={`sign-in-tab ${tab === 'phone' ? 'sign-in-tab-active' : 'sign-in-tab-idle'}`}
                >
                  {t('auth.tabPhone')}
                </button>
                <button
                  type="button"
                  onClick={() => setTab('dev')}
                  className={`sign-in-tab ${tab === 'dev' ? 'sign-in-tab-active' : 'sign-in-tab-idle'}`}
                >
                  {t('auth.tabDev')}
                </button>
              </div>
            )}

            <div className="mt-6">
              {tab === 'phone' ? (
                <PhoneSignIn disabled={login.isPending} variant="panel" />
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-xs text-slate">{t('signIn.govHierarchyHelp')}</p>
                  {govUsersByOrgLevel().map(({ level, users }) => (
                    <UserGroup
                      key={level}
                      title={orgLevelLabel(level, t)}
                      accent="gov"
                      users={users}
                      onPick={pick}
                      disabled={login.isPending}
                      showScope
                    />
                  ))}
                  <UserGroup
                    title={t('dev.vendorPortal')}
                    accent="vendor"
                    users={DEV_VENDOR_USERS}
                    onPick={pick}
                    disabled={login.isPending}
                    showScope
                  />
                  <UserGroup
                    title={t('dev.contractorPortal')}
                    accent="contractor"
                    users={DEV_CONTRACTOR_USERS}
                    onPick={pick}
                    disabled={login.isPending}
                    showScope
                  />
                </div>
              )}
            </div>

            <p className="mt-8 text-center text-xs text-ink-3">{t('signIn.rightFooter')}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
