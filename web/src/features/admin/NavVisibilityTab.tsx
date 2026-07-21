import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/auth/permissions';
import { useSession } from '@/auth/useSession';
import { FeedSkeleton } from '@/components/Skeleton';
import { GOV_NAV_TAB_KEYS } from '@/lib/navConfig';
import { useAdminSettings, useSetAdminSetting } from './useAdmin';

export function NavVisibilityTab() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const isHeadAdmin = usePermission('catalog.manage');
  const { data: settings, isPending } = useAdminSettings();
  const setSetting = useSetAdminSetting();
  const [roleCode, setRoleCode] = useState('SITE_ENGINEER');

  const globalMatrix = useMemo(() => {
    const row = settings?.find((s) => s.key === 'nav_visibility');
    return (row?.value ?? {}) as Record<string, string[]>;
  }, [settings]);

  const roleTabs = globalMatrix[roleCode] ?? [];

  if (isPending) return <FeedSkeleton />;

  async function toggleTab(tabKey: string) {
    const current = new Set(globalMatrix[roleCode] ?? []);
    if (current.has(tabKey)) current.delete(tabKey);
    else current.add(tabKey);
    const next = { ...globalMatrix, [roleCode]: [...current].sort() };
    await setSetting.mutateAsync({ key: 'nav_visibility', value: next });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate">
        {isHeadAdmin ? t('admin.navGlobalHelp') : t('admin.navDistrictHelp')}
      </p>
      <label className="block max-w-xs text-sm">
        <span className="font-medium text-ink">{t('admin.role')}</span>
        <select
          value={roleCode}
          onChange={(e) => setRoleCode(e.target.value)}
          className="gov-input mt-1 w-full"
        >
          {Object.keys(globalMatrix).sort().map((code) => (
            <option key={code} value={code}>
              {code.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>
      <div className="gov-card grid gap-2 p-4 sm:grid-cols-2">
        {GOV_NAV_TAB_KEYS.map(({ key, labelKey }) => {
          const checked = roleTabs.includes(key);
          const locked = !isHeadAdmin && !checked;
          return (
            <label
              key={key}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                locked ? 'opacity-50' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!isHeadAdmin || setSetting.isPending}
                onChange={() => void toggleTab(key)}
              />
              <span>{t(labelKey)}</span>
            </label>
          );
        })}
      </div>
      {!isHeadAdmin && session?.roles?.[0]?.orgName && (
        <p className="text-xs text-ink-3">
          {t('admin.navDistrictScope', { district: session.roles[0].orgName })}
        </p>
      )}
    </div>
  );
}
