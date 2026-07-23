import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HelpCircle, Search, Settings } from 'lucide-react';
import { LANGUAGES } from '@/i18n';
import { TnEmblem } from '@/components/TnEmblem';
import { UnreadBadge } from '@/features/notifications/UnreadBadge';
import { NavIcon, Bell, Building2, Menu, Moon, Sun, X } from '@/lib/navIcons';

export interface DashboardNavItem {
  to: string;
  label: string;
  end?: boolean;
}

interface DashboardShellProps {
  portal: 'gov' | 'vendor' | 'contractor';
  homePath: string;
  navItems: DashboardNavItem[];
  userName?: string;
  roleLabel?: string;
  orgScope?: string;
  districtId?: string;
  notificationHref?: string;
  notificationCount?: number;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  lang: string;
  onLangChange: (code: string) => void;
  onSignOut: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

function breadcrumbLabel(pathname: string, homePath: string, navItems: DashboardNavItem[]): string {
  if (pathname === homePath || pathname === `${homePath}/`) return 'Dashboard';
  const match = navItems.find((n) => pathname.startsWith(n.to) && n.to !== homePath);
  return match?.label ?? 'Dashboard';
}

function DashboardUserMenu({
  name,
  roleLabel,
  onSignOut,
  compact,
}: {
  name?: string;
  roleLabel?: string;
  onSignOut: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const initials = (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((p) => !p)}
        className="flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface px-2 py-1.5 hover:bg-surface-2 sm:px-3"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-bold text-brand-dark">
          {initials}
        </span>
        {!compact && (
          <span className="hidden min-w-0 text-left md:block">
            <span className="block max-w-[140px] truncate text-xs font-semibold text-ink">{name}</span>
            {roleLabel && (
              <span className="block max-w-[140px] truncate text-[10px] text-slate">{roleLabel}</span>
            )}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 min-w-[12rem] rounded-xl border border-line bg-surface py-1 shadow-card"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{name}</p>
            {roleLabel && <p className="mt-0.5 text-xs text-slate">{roleLabel}</p>}
          </div>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-3 text-left text-sm font-semibold text-danger hover:bg-danger-bg"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            {t('dev.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}

export function DashboardShell({
  portal,
  homePath,
  navItems,
  userName,
  roleLabel,
  orgScope,
  districtId,
  notificationHref,
  notificationCount = 0,
  theme,
  onToggleTheme,
  lang,
  onLangChange,
  onSignOut,
  footer,
  children,
}: DashboardShellProps) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isTa = i18n.language === 'ta';
  const settingsPath = `${homePath}/settings`;
  const helpPath = `${homePath}/help`;
  const pageLabel = (() => {
    if (location.pathname === settingsPath) return t('settings.title');
    if (location.pathname === helpPath) return t('help.title');
    return breadcrumbLabel(location.pathname, homePath, navItems);
  })();

  const initials = (userName ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="dash-shell flex h-screen overflow-hidden bg-ground">
      <a href="#main-content" className="gov-skip-link">
        {t('shell.skipToContent')}
      </a>
      {sidebarOpen && (
        <button
          type="button"
          aria-label={t('dashboard.closeMenu')}
          className="fixed inset-0 z-40 bg-brand-dark/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`dash-sidebar fixed inset-y-0 left-0 z-50 flex h-screen w-[5.5rem] flex-col text-white transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="gov-stripe shrink-0" aria-hidden />
        <div className="flex shrink-0 flex-col items-center gap-2 border-b border-white/10 px-2 py-3">
          <Link
            to={homePath}
            className="grid place-items-center rounded-lg focus-visible:ring-2 focus-visible:ring-accent"
            title={t('app.brand')}
          >
            <TnEmblem tone="onDark" className="h-8 w-auto" />
          </Link>
          <button
            type="button"
            className="grid min-h-[36px] min-w-[36px] place-items-center rounded-lg text-white/80 hover:bg-white/10 lg:hidden"
            aria-label={t('dashboard.closeMenu')}
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <nav
          className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2"
          aria-label={portal === 'gov' ? t('nav.gov') : portal === 'contractor' ? t('nav.contractor') : t('nav.vendor')}
        >
          {/* Icon over label in a narrow rail: the label still reads, so the
              nav stays learnable, but the content pane gets ~12rem back. */}
          <ul className="space-y-0.5">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  title={item.label}
                  className={({ isActive }) =>
                    `dash-nav-link flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-center transition ${
                      isActive
                        ? 'bg-white/15 text-white'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  <NavIcon path={item.to} className="h-[20px] w-[20px] text-current" />
                  <span className="dash-rail-label text-[10px] font-medium leading-tight">
                    {item.label}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="shrink-0 space-y-0.5 border-t border-white/10 px-1.5 py-2">
          {notificationHref && (
            <Link
              to={notificationHref}
              className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/75 hover:bg-white/10 hover:text-white"
            >
              <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-white/10">
                <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
                {notificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold">
                    {notificationCount > 99 ? '99+' : notificationCount}
                  </span>
                )}
              </span>
              {t('nav.notifications')}
            </Link>
          )}
          <NavLink
            to={settingsPath}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-center transition ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`
            }
            title={t('dashboard.settings')}
          >
            <Settings className="h-[20px] w-[20px]" strokeWidth={2} />
            <span className="dash-rail-label text-[10px] font-medium leading-tight">
              {t('dashboard.settings')}
            </span>
          </NavLink>
          <NavLink
            to={helpPath}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-center transition ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`
            }
            title={t('dashboard.helpSupport')}
          >
            <HelpCircle className="h-[20px] w-[20px]" strokeWidth={2} />
            <span className="dash-rail-label text-[10px] font-medium leading-tight">
              {t('dashboard.helpSupport')}
            </span>
          </NavLink>
        </div>

      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:ml-[5.5rem]">
        <header className="dash-topbar z-30 shrink-0 text-white">
          <div className="flex min-h-[3.75rem] flex-wrap items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
            <button
              type="button"
              className="grid min-h-[40px] min-w-[40px] place-items-center rounded-lg text-white/80 hover:bg-white/10 lg:hidden"
              aria-label={t('dashboard.openMenu')}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" strokeWidth={2} />
            </button>

            <Link
              to={homePath}
              className="hidden shrink-0 items-center gap-2 rounded-lg text-white sm:flex"
            >
              <span className="font-display text-base font-bold leading-none">{t('app.brand')}</span>
              <span className="text-xs text-white/60">/ {pageLabel}</span>
            </Link>

            <div className="order-last w-full min-w-0 flex-1 sm:order-none sm:mx-4 sm:max-w-xl lg:mx-8">
              <label className="sr-only" htmlFor="dash-search">
                {t('dashboard.searchPlaceholder')}
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50"
                  strokeWidth={2}
                  aria-hidden
                />
                <input
                  id="dash-search"
                  type="search"
                  placeholder={t('dashboard.searchPlaceholderFull')}
                  className="dash-topbar-search w-full rounded-full py-2 pl-10 pr-4 text-sm"
                />
              </div>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <span className="hidden items-center gap-1.5 text-xs text-white/75 lg:inline-flex" title={orgScope}>
                <Building2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                {districtId ?? orgScope}
              </span>

              <select
                aria-label={t('dev.language')}
                value={lang}
                onChange={(e) => onLangChange(e.target.value)}
                className="dash-topbar-select hidden w-auto min-w-[5rem] rounded-lg py-1.5 text-sm sm:block"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                aria-label={t('shell.toggleTheme')}
                onClick={onToggleTheme}
                className="grid min-h-[40px] min-w-[40px] place-items-center rounded-lg text-white/80 hover:bg-white/10"
              >
                {theme === 'dark' ? (
                  <Sun className="h-5 w-5" strokeWidth={2} />
                ) : (
                  <Moon className="h-5 w-5" strokeWidth={2} />
                )}
              </button>

              {notificationHref && (
                <Link
                  to={notificationHref}
                  aria-label={t('shell.notifications')}
                  className="relative grid min-h-[40px] min-w-[40px] place-items-center rounded-lg text-white/80 hover:bg-white/10"
                >
                  <Bell className="h-5 w-5" strokeWidth={2} />
                  {notificationCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5">
                      <UnreadBadge count={notificationCount} />
                    </span>
                  )}
                </Link>
              )}

              <NavLink
                to={helpPath}
                aria-label={t('dashboard.helpSupport')}
                className={({ isActive }) =>
                  `hidden min-h-[40px] min-w-[40px] place-items-center rounded-lg sm:grid ${
                    isActive ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
                  }`
                }
              >
                <HelpCircle className="h-5 w-5" strokeWidth={2} />
              </NavLink>

              <span
                className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-brand-dark sm:grid"
                aria-hidden
              >
                {initials}
              </span>

              <DashboardUserMenu
                name={userName}
                roleLabel={roleLabel}
                onSignOut={onSignOut}
                compact={isTa}
              />
            </div>
          </div>
        </header>

        <div id="main-content" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="px-4 py-6 sm:px-6 lg:px-8">{children}</div>
          </div>
          {footer}
        </div>
      </div>
    </div>
  );
}
