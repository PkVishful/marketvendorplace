import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { usePermission } from '@/auth/permissions';

interface SettingsLink {
  to: string;
  labelKey: string;
  /** Omitted means every admin who can reach Settings at all sees it. */
  requiresPermission?: string;
}

interface SettingsGroup {
  id: string;
  labelKey: string;
  links: SettingsLink[];
}

const ORGANIZATION_GROUPS: SettingsGroup[] = [
  {
    id: 'organization',
    labelKey: 'settingsShell.groupOrganization',
    links: [
      { to: 'organization/profile', labelKey: 'settingsShell.profile', requiresPermission: 'catalog.manage' },
      { to: 'organization/hierarchy', labelKey: 'settingsShell.hierarchy', requiresPermission: 'user.manage' },
      { to: 'organization/units', labelKey: 'settingsShell.orgUnits', requiresPermission: 'user.manage' },
    ],
  },
  {
    id: 'usersRoles',
    labelKey: 'settingsShell.groupUsersRoles',
    links: [
      { to: 'users', labelKey: 'settingsShell.users', requiresPermission: 'user.manage' },
      { to: 'roles', labelKey: 'settingsShell.roles', requiresPermission: 'user.manage' },
      { to: 'nav-visibility', labelKey: 'settingsShell.navVisibility', requiresPermission: 'user.manage' },
    ],
  },
];

function Group({ group, granted }: { group: SettingsGroup; granted: Set<string> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  // Permissions are resolved once by the shell and passed in: usePermission is
  // a hook, so it cannot be called inside this filter.
  const visible = group.links.filter((l) => !l.requiresPermission || granted.has(l.requiresPermission));
  // A group whose every child is gated away would otherwise render as an empty
  // expander that does nothing when clicked.
  if (visible.length === 0) return null;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm font-semibold text-ink hover:bg-surface-2"
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />}
        {t(group.labelKey)}
      </button>
      {open && (
        <ul className="mb-1 ml-4 space-y-0.5 border-l border-line pl-3">
          {visible.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                className={({ isActive }) =>
                  `block rounded-lg px-3 py-1.5 text-sm transition ${
                    isActive
                      ? 'bg-brand text-white font-medium'
                      : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                {t(link.labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Full-page settings area: grouped left rail, routed detail pane.
 *
 * Deliberately a layout only — every screen it hosts keeps its own data
 * fetching, so moving the existing Users/Roles/Nav tabs in here changed their
 * markup and nothing about how they work.
 */
export function SettingsShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canManageUsers = usePermission('user.manage');
  const canManageCatalog = usePermission('catalog.manage');

  const granted = new Set<string>();
  if (canManageUsers) granted.add('user.manage');
  if (canManageCatalog) granted.add('catalog.manage');

  return (
    <div className="flex min-h-[70vh] flex-col">
      <header className="mb-4 flex items-center justify-between gap-4 border-b border-line pb-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">{t('settingsShell.title')}</h1>
          <p className="text-xs text-ink-3">{t('settingsShell.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/gov')}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
        >
          {t('settingsShell.close')}
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-6 lg:flex-row">
        <nav aria-label={t('settingsShell.navLabel')} className="lg:w-64 lg:shrink-0">
          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-3">
            {t('settingsShell.orgSettings')}
          </p>
          <ul className="space-y-0.5">
            {ORGANIZATION_GROUPS.map((g) => <Group key={g.id} group={g} granted={granted} />)}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
