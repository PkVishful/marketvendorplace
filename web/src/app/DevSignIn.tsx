import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDevLogin } from '@/auth/useSession';
import { GovHeader } from '@/components/GovChrome';
import { TnEmblem } from '@/components/TnEmblem';
import { PhoneSignIn } from '@/features/auth/PhoneSignIn';
import { DEV_GOV_USERS, DEV_VENDOR_USERS, devUserById } from './devUsers';
import { portalHomePathForSession, resolvePortal } from '@/types/domain';

function UserGroup({
  title,
  accent,
  users,
  onPick,
  disabled,
}: {
  title: string;
  accent: 'vendor' | 'gov';
  users: typeof DEV_VENDOR_USERS;
  onPick: (userId: string) => void;
  disabled: boolean;
}) {
  const border = accent === 'gov' ? 'border-l-brand' : 'border-l-success';

  return (
    <div className={`gov-card overflow-hidden border-l-4 ${border}`}>
      <div className="border-b border-line bg-surface-2 px-5 py-3">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
      </div>
      <div className="flex flex-col divide-y divide-line">
        {users.map((v) => (
          <button
            key={v.userId}
            type="button"
            disabled={disabled}
            onClick={() => onPick(v.userId)}
            className="flex min-h-[52px] items-center gap-4 px-5 py-4 text-left transition hover:bg-brand-tint/50 focus-visible:bg-brand-tint disabled:opacity-60"
          >
            <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-brand text-xs font-bold text-white">
              {v.label.slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">{v.label}</span>
              <span className="mt-0.5 block text-xs text-slate">{v.sub}</span>
            </span>
            <span className="text-slate" aria-hidden="true">
              →
            </span>
          </button>
        ))}
      </div>
    </div>
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
  const { t, i18n } = useTranslation();
  const login = useDevLogin();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'phone' | 'dev'>('phone');
  const isTa = i18n.language === 'ta';

  function pick(userId: string) {
    login.mutate(userId, {
      onSuccess: (session) => {
        const portal = resolvePortal(session) ?? devUserById(session.userId)?.portal;
        if (portal) navigate(portalHomePathForSession(session));
      },
    });
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h))] bg-ground">
      <GovHeader
        theme={theme}
        onToggleTheme={onToggleTheme}
        lang={lang}
        onLangChange={onLangChange}
      />

      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-2 lg:px-6 lg:py-14">
        <section className="flex flex-col justify-center">
          <div className="flex items-center gap-4">
            <TnEmblem className="h-16 w-16" />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent">
                {t('app.subtitle')}
              </p>
              <h1 className="font-display text-3xl font-bold tracking-tight text-ink lg:text-4xl">
                {t('dev.signInTitle')}
              </h1>
            </div>
          </div>
          <p className="mt-6 max-w-md text-sm leading-relaxed text-slate sm:text-base">
            {t('dev.signInHelp')}
          </p>
          <ul className="mt-6 space-y-2 text-sm text-slate">
            <li className="flex gap-2">
              <span className="text-success" aria-hidden="true">
                ✓
              </span>
              {t('shell.authBullet1')}
            </li>
            <li className="flex gap-2">
              <span className="text-success" aria-hidden="true">
                ✓
              </span>
              {t('shell.authBullet2')}
            </li>
            <li className="flex gap-2">
              <span className="text-success" aria-hidden="true">
                ✓
              </span>
              {isTa ? t('shell.deptNameTa') : t('shell.deptName')}
            </li>
          </ul>
        </section>

        <section>
          {import.meta.env.DEV && (
            <div className="mb-4 flex rounded-xl border border-line bg-surface-2 p-1">
              <button
                type="button"
                onClick={() => setTab('phone')}
                className={`flex-1 min-h-[44px] rounded-lg px-3 text-sm font-semibold transition ${
                  tab === 'phone' ? 'bg-surface text-ink shadow-sm' : 'text-slate'
                }`}
              >
                {t('auth.tabPhone')}
              </button>
              <button
                type="button"
                onClick={() => setTab('dev')}
                className={`flex-1 min-h-[44px] rounded-lg px-3 text-sm font-semibold transition ${
                  tab === 'dev' ? 'bg-surface text-ink shadow-sm' : 'text-slate'
                }`}
              >
                {t('auth.tabDev')}
              </button>
            </div>
          )}

          {tab === 'phone' ? (
            <PhoneSignIn disabled={login.isPending} />
          ) : (
            <div className="flex flex-col gap-4">
              <UserGroup
                title={t('dev.govPortal')}
                accent="gov"
                users={DEV_GOV_USERS}
                onPick={pick}
                disabled={login.isPending}
              />
              <UserGroup
                title={t('dev.vendorPortal')}
                accent="vendor"
                users={DEV_VENDOR_USERS}
                onPick={pick}
                disabled={login.isPending}
              />
            </div>
          )}

          <p className="mt-6 text-center text-xs text-ink-3">{t('dev.secureNote')}</p>
        </section>
      </div>
    </div>
  );
}
