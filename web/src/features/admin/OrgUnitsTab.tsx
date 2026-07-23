import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Pagination } from '@/components/Pagination';
import { pageWindow } from '@/lib/pagination';
import { useAdminOrgUnits } from './useAdmin';

const PAGE_SIZE = 15;

/** Depth from the ltree path: TN.COIMBATORE.CBEDIV1 -> 2. */
function depthOf(path: string) {
  return Math.max(0, path.split('.').length - 1);
}

export function OrgUnitsTab() {
  const { t } = useTranslation();
  const { data: units, isPending, isError } = useAdminOrgUnits();
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);

  const levels = useMemo(
    () => [...new Set((units ?? []).map((u) => u.level))],
    [units],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (units ?? []).filter((u) => {
      if (level && u.level !== level) return false;
      if (!q) return true;
      // Path is searchable too: an admin who knows the code can paste it.
      return u.name.toLowerCase().includes(q) || u.path.toLowerCase().includes(q);
    });
  }, [units, query, level]);

  const win = pageWindow({ total: filtered.length, page, pageSize: PAGE_SIZE });
  const visible = filtered.slice((win.page - 1) * PAGE_SIZE, win.page * PAGE_SIZE);

  if (isPending) return <p className="text-sm text-slate" role="status">{t('orgUnits.loading')}</p>;
  if (isError) return <p className="text-sm text-danger">{t('orgUnits.loadFailed')}</p>;

  return (
    <div>
      <h2 className="font-display text-lg font-bold text-ink">{t('orgUnits.title')}</h2>
      <p className="mt-1 text-sm text-ink-2">
        {t('orgUnits.subtitle', { count: units?.length ?? 0 })}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder={t('orgUnits.searchPlaceholder')}
            aria-label={t('orgUnits.searchLabel')}
            className="w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
          />
        </div>

        <select
          value={level}
          onChange={(e) => { setLevel(e.target.value); setPage(1); }}
          aria-label={t('orgUnits.levelFilter')}
          className="gov-input w-auto py-2 text-sm"
        >
          <option value="">{t('orgUnits.allLevels')}</option>
          {levels.map((l) => (
            <option key={l} value={l}>{t(`area.level.${l}`)}</option>
          ))}
        </select>

        <p className="ml-auto text-[11px] text-ink-3" aria-live="polite">
          {t('orgUnits.showing', { shown: filtered.length, total: units?.length ?? 0 })}
        </p>
      </div>

      <div className="mt-3 gov-card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-ink-3">
            <tr>
              <th className="px-4 py-3">{t('orgUnits.colName')}</th>
              <th className="px-4 py-3">{t('orgUnits.colLevel')}</th>
              <th className="px-4 py-3">{t('orgUnits.colPath')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((u) => (
              <tr key={u.id} className="hover:bg-surface-2">
                <td className="px-4 py-2.5">
                  {/* Indent by tree depth so the hierarchy is readable in a
                      flat table without building a collapsible tree. */}
                  <span style={{ paddingLeft: `${depthOf(u.path) * 12}px` }}>
                    <Link to={`/gov/area/${u.id}`} className="font-medium text-brand hover:underline">
                      {u.name}
                    </Link>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink-2">{t(`area.level.${u.level}`)}</td>
                <td className="px-4 py-2.5 font-mono text-[11px] text-ink-3">{u.path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        <Pagination total={filtered.length} page={win.page} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
    </div>
  );
}
