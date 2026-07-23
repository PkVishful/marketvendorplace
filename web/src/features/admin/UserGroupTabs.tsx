import { useTranslation } from 'react-i18next';

/** '' means every user; anything else is an exact eworks role_code. */
export type UserGroup = '';

const GROUPS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'admin.groupAll' },
  { value: 'DISTRICT_OFFICER', labelKey: 'admin.groupDistrictOfficers' },
  { value: 'SITE_ENGINEER', labelKey: 'admin.groupSiteEngineers' },
  { value: 'EXECUTIVE_ENGINEER', labelKey: 'admin.groupExecutiveEngineers' },
  { value: 'LAB_VENDOR', labelKey: 'admin.groupVendors' },
  { value: 'FIELD_TECHNICIAN', labelKey: 'admin.groupFieldTechs' },
  { value: 'CONTRACTOR', labelKey: 'admin.groupContractors' },
  { value: 'AUDITOR', labelKey: 'admin.groupAuditors' },
];

/**
 * Splits the single 208-row list into the groups people actually look for.
 *
 * Filtering happens on the server, so switching a tab fetches that group's
 * first page rather than hiding rows the browser already downloaded.
 */
export function UserGroupTabs({
  value, onChange,
}: {
  value: string;
  onChange: (group: UserGroup) => void;
}) {
  const { t } = useTranslation();

  return (
    <div role="tablist" aria-label={t('admin.groupTabsLabel')} className="flex flex-wrap gap-2">
      {GROUPS.map((g) => {
        const active = g.value === value;
        return (
          <button
            key={g.value || 'all'}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(g.value as UserGroup)}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              active
                ? 'border-brand bg-brand text-white font-medium'
                : 'border-line bg-surface text-ink-2 hover:bg-surface-2'
            }`}
          >
            {t(g.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
