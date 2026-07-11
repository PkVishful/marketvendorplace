import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '@/i18n';
import { TnEmblem } from './TnEmblem';
import { UserMenu } from './UserMenu';
import { UnreadBadge } from '@/features/notifications/UnreadBadge';

interface GovHeaderProps {
  portal?: 'vendor' | 'gov' | null;
  userName?: string;
  roleLabel?: string;
  orgScope?: string;
  notificationHref?: string;
  notificationCount?: number;
  onSignOut?: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  lang: string;
  onLangChange: (code: string) => void;
}

export function GovHeader({
  portal,
  userName,
  roleLabel,
  notificationHref,
  notificationCount = 0,
  onSignOut,
  theme,
  onToggleTheme,
  lang,
  onLangChange,
}: GovHeaderProps) {
  const { t, i18n } = useTranslation();
  const isTa = i18n.language === 'ta';

  return (
    <header className="sticky top-0 z-30 shadow-header">
      <a href="#main-content" className="gov-skip-link">
        {t('shell.skipToContent')}
      </a>
      <div className="gov-stripe" aria-hidden="true" />
      <div className="bg-brand text-white">
        <div className="mx-auto flex max-w-portal items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6 sm:py-3">
          <Link
            to={portal === 'gov' ? '/gov' : portal === 'vendor' ? '/vendor' : '/'}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:ring-accent"
          >
            <TnEmblem />
            <span className="min-w-0">
              <span className="block truncate font-display text-base font-bold leading-tight sm:text-lg">
                {t('app.brand')}
              </span>
              <span className="block truncate text-[10px] font-medium leading-snug text-white/75 sm:text-[11px]">
                {isTa ? t('shell.deptNameTa') : t('shell.deptName')}
              </span>
            </span>
          </Link>

          {portal && (
            <span className="hidden shrink-0 rounded-lg border border-white/25 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider lg:inline">
              {portal === 'vendor' ? t('nav.vendorBadge') : t('nav.govBadge')}
            </span>
          )}

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {notificationHref && (
              <Link
                to={notificationHref}
                aria-label={t('shell.notifications')}
                className="relative grid min-h-[44px] min-w-[44px] place-items-center rounded-xl border border-white/20 bg-white/10 hover:bg-white/15"
              >
                <span aria-hidden="true" className="text-lg">
                  🔔
                </span>
                {notificationCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5">
                    <UnreadBadge count={notificationCount} />
                  </span>
                )}
              </Link>
            )}

            <select
              aria-label={t('dev.language')}
              value={lang}
              onChange={(e) => onLangChange(e.target.value)}
              className="hidden min-h-[44px] rounded-xl border border-white/20 bg-white/10 px-2 text-xs font-medium text-white sm:block"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} className="text-ink">
                  {l.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={t('shell.toggleTheme')}
              className="grid min-h-[44px] min-w-[44px] place-items-center rounded-xl border border-white/20 bg-white/10 text-sm hover:bg-white/15"
            >
              {theme === 'dark' ? '☾' : '☀'}
            </button>

            {onSignOut && userName ? (
              <UserMenu name={userName} roleLabel={roleLabel} onSignOut={onSignOut} />
            ) : (
              <Link
                to="/sign-in"
                className="gov-btn-accent hidden min-h-[44px] px-4 sm:inline-flex"
              >
                {t('dev.signInTitle')}
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

export function PageHero({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-portal flex-col gap-4 px-4 py-6 sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:py-8">
        <div>
          {eyebrow && (
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
          )}
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink sm:text-[28px]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate sm:text-base">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `relative whitespace-nowrap px-4 py-3.5 text-sm font-semibold transition min-h-[44px] inline-flex items-center ${
    isActive
      ? 'text-brand after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-accent'
      : 'text-slate hover:text-ink'
  }`;

export function PortalNav({
  items,
  ariaLabel,
}: {
  items: { to: string; label: string; end?: boolean }[];
  ariaLabel: string;
}) {
  return (
    <nav
      className="hidden border-b border-line bg-surface md:block"
      aria-label={ariaLabel}
    >
      <div className="mx-auto flex max-w-portal gap-1 overflow-x-auto px-4 sm:px-6">
        {items.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end} className={navLinkClass}>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export function PortalBody({ children, paddedBottom }: { children: ReactNode; paddedBottom?: boolean }) {
  return (
    <div
      className={`mx-auto max-w-portal px-4 py-6 sm:px-6 sm:py-8 ${paddedBottom ? 'pb-24 md:pb-8' : ''}`}
    >
      {children}
    </div>
  );
}
