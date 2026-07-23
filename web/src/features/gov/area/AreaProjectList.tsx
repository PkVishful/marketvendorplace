import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AreaProject } from './api';

export function AreaProjectList({ projects }: { projects: AreaProject[] }) {
  const { t } = useTranslation();

  return (
    <ul className="space-y-3">
      {projects.map((p) => {
        const pct = p.requiredTests > 0
          ? Math.round((100 * p.certifiedTests) / p.requiredTests)
          : null;
        return (
          <li key={p.id}>
            <Link
              to={`/gov/projects/${p.id}/checklist`}
              className="block rounded-xl border border-line bg-surface p-4 transition hover:border-brand/40 hover:bg-surface-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-base font-bold text-ink">{p.name}</h3>
                <span className="text-xs text-ink-3">
                  {t('area.openOrdersCount', { count: p.openOrders })}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate">
                {t('area.testsCertified', {
                  certified: p.certifiedTests,
                  required: p.requiredTests,
                })}
              </p>
              {pct != null && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand to-brand/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
