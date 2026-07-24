import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { Pagination } from '@/components/Pagination';
import { pageWindow } from '@/lib/pagination';
import { formatDate, formatTime } from '@/lib/time';
import { useAuditChain, useAuditLogInfinite } from './useGov';
import type { AuditLogRow } from '@/types/domain';

function payloadPreview(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) return '—';
  const first = keys.slice(0, 3).map((k) => `${k}: ${String(payload[k])}`);
  return first.join(' · ');
}

// Rows arrive newest-first, so entries for one day are already contiguous —
// walk them and start a fresh group whenever the calendar date changes.
function groupByDate(rows: AuditLogRow[]): { date: string; rows: AuditLogRow[] }[] {
  const groups: { date: string; rows: AuditLogRow[] }[] = [];
  for (const row of rows) {
    const date = formatDate(row.occurredAt);
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.rows.push(row);
    else groups.push({ date, rows: [row] });
  }
  return groups;
}

// Local calendar date, to compare against a native <input type="date"> value.
function localYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(2000, i, 1)),
}));

// 'LAB_VENDOR' -> 'Lab Vendor'
function formatRole(code: string): string {
  return code
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export function AuditLogPage() {
  const { t } = useTranslation();
  const { data: chain, isPending: chainPending } = useAuditChain();
  const canRead = chain?.allowed === true;
  const {
    data,
    isPending,
    isError,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
  } = useAuditLogInfinite(canRead);

  const rows = data?.pages.flat() ?? [];

  // Numbered pagination and date grouping both need the whole set in hand, so
  // drain the cursor pages as they arrive. The log is append-only and modest
  // here; if it grows large this should move to a server-side paged+grouped
  // endpoint rather than loading everything.
  useEffect(() => {
    if (hasNextPage && !isFetching) void fetchNextPage();
  }, [hasNextPage, isFetching, fetchNextPage]);

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // Optional, independent filters (all AND-combined) over the loaded rows.
  const [yearF, setYearF] = useState('');
  const [monthF, setMonthF] = useState('');
  const [dateF, setDateF] = useState('');
  const [districtF, setDistrictF] = useState('');
  const [roleF, setRoleF] = useState('');

  // Dropdown options, derived from everything loaded.
  const years = [...new Set(rows.map((r) => new Date(r.occurredAt).getFullYear()))].sort(
    (a, b) => b - a,
  );
  const districts = [
    ...new Set(rows.map((r) => r.district).filter((d): d is string => Boolean(d))),
  ].sort();
  const roles = [
    ...new Set(rows.flatMap((r) => (r.role ?? '').split(',').filter(Boolean))),
  ].sort();

  const anyFilter = Boolean(yearF || monthF || dateF || districtF || roleF);

  function onFilter(setter: (v: string) => void, value: string) {
    setter(value);
    setPage(1);
  }
  function clearFilters() {
    setYearF('');
    setMonthF('');
    setDateF('');
    setDistrictF('');
    setRoleF('');
    setPage(1);
  }

  const filtered = rows.filter((r) => {
    const d = new Date(r.occurredAt);
    if (yearF && d.getFullYear() !== Number(yearF)) return false;
    if (monthF && d.getMonth() !== Number(monthF)) return false;
    if (dateF && localYmd(d) !== dateF) return false;
    if (districtF && (r.district ?? '') !== districtF) return false;
    if (roleF && !(r.role ?? '').split(',').includes(roleF)) return false;
    return true;
  });

  const win = pageWindow({ total: filtered.length, page, pageSize: PAGE_SIZE });
  const visible = filtered.slice((win.page - 1) * PAGE_SIZE, win.page * PAGE_SIZE);
  const groups = groupByDate(visible);

  if (chainPending || (isPending && rows.length === 0)) return <FeedSkeleton />;

  if (chain && !chain.allowed) {
    return (
      <div className="gov-card p-10 text-center">
        <p className="font-semibold text-ink">{t('audit.noAccessTitle')}</p>
        <p className="mt-2 text-sm text-ink-2">{t('audit.noAccessBody')}</p>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header>
        <h2 className="font-display text-xl font-bold">{t('audit.title')}</h2>
        <p className="mt-1 text-sm text-ink-2">{t('audit.subtitle')}</p>
      </header>

      {chain?.allowed && (
        <div
          className={`gov-card border-l-4 p-5 ${
            chain.intact ? 'border-l-green' : 'border-l-danger'
          }`}
        >
          <p className="gov-label">{t('audit.chainTitle')}</p>
          <p className={`mt-1 text-sm font-semibold ${chain.intact ? 'text-good' : 'text-danger'}`}>
            {chain.intact ? t('audit.chainIntact') : t('audit.chainBroken', { seq: chain.brokenAtSeq })}
          </p>
          {chain.headSeq != null && chain.headHash && (
            <p className="mt-2 font-mono text-[10px] text-ink-3 break-all">
              #{chain.headSeq} · {chain.headHash.slice(0, 16)}…
            </p>
          )}
        </div>
      )}

      {isError ? (
        <div className="gov-card border-l-4 border-l-danger p-6 text-center">
          <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
          <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
            {t('states.retry')}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="gov-card p-10 text-center">
          <p className="font-semibold text-ink">{t('audit.emptyTitle')}</p>
          <p className="mt-2 text-sm text-ink-2">{t('audit.emptyBody')}</p>
        </div>
      ) : (
        <>
          <div className="gov-card flex flex-wrap items-end gap-3 p-4">
            <label className="block">
              <span className="gov-label">{t('audit.filterYear')}</span>
              <select
                className="gov-input mt-1 min-w-[7rem]"
                value={yearF}
                onChange={(e) => onFilter(setYearF, e.target.value)}
              >
                <option value="">{t('audit.allYears')}</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="gov-label">{t('audit.filterMonth')}</span>
              <select
                className="gov-input mt-1 min-w-[8rem]"
                value={monthF}
                onChange={(e) => onFilter(setMonthF, e.target.value)}
              >
                <option value="">{t('audit.allMonths')}</option>
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="gov-label">{t('audit.filterDate')}</span>
              <input
                type="date"
                className="gov-input mt-1"
                value={dateF}
                onChange={(e) => onFilter(setDateF, e.target.value)}
              />
            </label>
            <label className="block">
              <span className="gov-label">{t('audit.filterDistrict')}</span>
              <select
                className="gov-input mt-1 min-w-[9rem]"
                value={districtF}
                onChange={(e) => onFilter(setDistrictF, e.target.value)}
              >
                <option value="">{t('audit.allDistricts')}</option>
                {districts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="gov-label">{t('audit.filterRole')}</span>
              <select
                className="gov-input mt-1 min-w-[9rem]"
                value={roleF}
                onChange={(e) => onFilter(setRoleF, e.target.value)}
              >
                <option value="">{t('audit.allRoles')}</option>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {formatRole(r)}
                  </option>
                ))}
              </select>
            </label>
            {anyFilter && (
              <button type="button" className="gov-btn-secondary" onClick={clearFilters}>
                {t('audit.clearFilters')}
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="gov-card p-10 text-center">
              <p className="font-semibold text-ink">{t('audit.filterEmptyTitle')}</p>
              <p className="mt-2 text-sm text-ink-2">{t('audit.filterEmptyBody')}</p>
            </div>
          ) : (
          <div className="gov-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                  <tr>
                    <th className="px-6 py-3 font-semibold">#</th>
                    <th className="px-6 py-3 font-semibold">{t('audit.colWhen')}</th>
                    <th className="px-6 py-3 font-semibold">{t('audit.colAction')}</th>
                    <th className="px-6 py-3 font-semibold">{t('audit.colActor')}</th>
                    <th className="px-6 py-3 font-semibold">{t('audit.colEntity')}</th>
                    <th className="px-6 py-3 font-semibold">{t('audit.colDetail')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hair">
                  {groups.map((group) => (
                    <Fragment key={group.rows[0].seq}>
                      <tr className="bg-surface-2/60">
                        <td
                          colSpan={6}
                          className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-ink-3"
                        >
                          {group.date}
                        </td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.seq}>
                          <td className="px-6 py-3 font-mono text-xs text-ink-3">{row.seq}</td>
                          <td className="px-6 py-3 whitespace-nowrap text-ink-2">
                            {formatTime(row.occurredAt)}
                          </td>
                          <td className="px-6 py-3 font-mono text-xs font-semibold text-navy">
                            {row.action}
                          </td>
                          <td className="px-6 py-3 text-ink-2">{row.actorName ?? t('audit.system')}</td>
                          <td className="px-6 py-3">
                            <span className="text-xs text-ink-3">{row.entityType}</span>
                            {row.entityId && (
                              <span className="mt-0.5 block font-mono text-[10px] text-ink-3">
                                {row.entityId.slice(0, 8)}
                              </span>
                            )}
                          </td>
                          <td className="max-w-xs px-6 py-3 truncate text-xs text-ink-3">
                            {payloadPreview(row.payload)}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4">
              <Pagination
                total={filtered.length}
                page={win.page}
                pageSize={PAGE_SIZE}
                onPage={setPage}
              />
            </div>
          </div>
          )}

          {hasNextPage && isFetching && (
            <p className="text-center text-xs text-ink-3">{t('states.loading')}</p>
          )}
        </>
      )}
    </section>
  );
}
