import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import type { AreaCrumb } from './api';

/**
 * A crumb above the caller's own anchor renders as plain text, never a link:
 * the API would 403 it anyway, and offering the link invites a dead end.
 */
export function AreaBreadcrumbs({ crumbs }: { crumbs: AreaCrumb[] }) {
  const { t } = useTranslation();

  return (
    <nav aria-label={t('area.breadcrumbLabel')} className="mb-4">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={crumb.id} className="flex items-center gap-1">
              {i > 0 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
              )}
              {isLast ? (
                <span className="font-semibold text-ink" aria-current="page">
                  {crumb.name}
                </span>
              ) : crumb.inScope ? (
                <Link to={`/gov/area/${crumb.id}`} className="text-brand hover:underline">
                  {crumb.name}
                </Link>
              ) : (
                <span className="text-ink-3" title={t('area.crumbOutsideScope')}>
                  {crumb.name}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
