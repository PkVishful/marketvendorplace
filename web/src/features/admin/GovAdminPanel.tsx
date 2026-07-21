import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/auth/permissions';
import { NavVisibilityTab } from './NavVisibilityTab';
import { RolesTab } from './RolesTab';
import { UsersTab } from './UsersTab';

type TabId = 'users' | 'roles' | 'nav';

/** District / state admin — only tools with no dedicated sidebar page. */
export function GovAdminPanel() {
  const { t } = useTranslation();
  const canManageUsers = usePermission('user.manage');
  const isHeadAdmin = usePermission('catalog.manage');

  const tabs = useMemo(() => {
    const list: { id: TabId; label: string }[] = [];
    if (canManageUsers) {
      list.push({ id: 'users', label: t('admin.tabUsers') });
      list.push({ id: 'roles', label: t('admin.tabRoles') });
      list.push({ id: 'nav', label: t('admin.tabNav') });
    }
    return list;
  }, [canManageUsers, t]);

  const [active, setActive] = useState<TabId>(() => tabs[0]?.id ?? 'users');

  if (tabs.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">{t('admin.title')}</h3>
        <p className="mt-1 text-sm text-slate">
          {isHeadAdmin ? t('admin.subtitleHead') : t('admin.subtitleDistrict')}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-line pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
              active === tab.id ? 'bg-brand text-white' : 'text-ink hover:bg-surface-2'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'users' && <UsersTab />}
      {active === 'roles' && <RolesTab />}
      {active === 'nav' && <NavVisibilityTab />}
    </div>
  );
}
