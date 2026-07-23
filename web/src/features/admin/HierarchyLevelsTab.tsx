import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminOrgUnits } from './useAdmin';

/**
 * The eworks.org_level enum, in order, with how many units sit at each level.
 *
 * Read-only on purpose: the levels are a Postgres enum and a trigger enforces
 * that a child's level is exactly its parent's + 1. Editing them from a
 * settings screen would need a migration and would invalidate every existing
 * ltree path, so this screen documents the hierarchy rather than pretending it
 * is configurable.
 */
const LEVELS = [
  'STATE', 'DISTRICT', 'DIVISION', 'CIRCLE',
  'SUBDIVISION', 'SECTION', 'FIELD_UNIT', 'PROJECT',
] as const;

export function HierarchyLevelsTab() {
  const { t } = useTranslation();
  const { data: units, isPending, isError } = useAdminOrgUnits();

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of units ?? []) map.set(u.level, (map.get(u.level) ?? 0) + 1);
    return map;
  }, [units]);

  if (isPending) return <p className="text-sm text-slate" role="status">{t('hierarchy.loading')}</p>;
  if (isError) return <p className="text-sm text-danger">{t('hierarchy.loadFailed')}</p>;

  return (
    <div className="max-w-3xl">
      <h2 className="font-display text-lg font-bold text-ink">{t('hierarchy.title')}</h2>
      <p className="mt-1 text-sm text-ink-2">{t('hierarchy.subtitle')}</p>

      <ol className="mt-5 space-y-2">
        {LEVELS.map((level, i) => {
          const count = counts.get(level) ?? 0;
          return (
            <li
              key={level}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
              style={{ marginLeft: `${i * 14}px` }}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-tint text-xs font-bold text-brand">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">
                  {t(`area.level.${level}`)}
                </span>
                <span className="block font-mono text-[11px] text-ink-3">{level}</span>
              </span>
              <span className="shrink-0 text-sm tabular-nums text-ink-2">
                {t('hierarchy.unitCount', { count })}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-5 rounded-lg border border-line bg-surface-2/60 px-4 py-3 text-xs text-ink-2">
        {t('hierarchy.fixedNote')}
      </p>
    </div>
  );
}
