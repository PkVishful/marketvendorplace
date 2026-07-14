import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/auth/permissions';
import { FeedSkeleton } from '@/components/Skeleton';
import { formatDate } from '@/lib/time';
import { useGovOfficers } from './useGov';

const ROLE_FILTERS = [
  'ALL',
  'HEAD_ADMIN',
  'DISTRICT_OFFICER',
  'EXECUTIVE_ENGINEER',
  'SITE_ENGINEER',
  'AUDITOR',
] as const;

export function OfficersPage() {
  const { t } = useTranslation();
  const canRead = usePermission('user.read');
  const { data, isPending, isError, refetch } = useGovOfficers(canRead);
  const [roleFilter, setRoleFilter] = useState<(typeof ROLE_FILTERS)[number]>('ALL');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const list = data ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter((r) => {
      if (roleFilter !== 'ALL' && r.roleCode !== roleFilter) return false;
      if (!needle) return true;
      return (
        r.fullName.toLowerCase().includes(needle) ||
        r.phone.includes(needle) ||
        r.orgName.toLowerCase().includes(needle) ||
        r.orgPath.toLowerCase().includes(needle) ||
        r.roleCode.toLowerCase().includes(needle)
      );
    });
  }, [data, roleFilter, q]);

  if (!canRead) {
    return (
      <div className="gov-card border-l-4 border-l-warning p-6">
        <h2 className="font-display text-lg font-bold text-ink">{t('officers.noAccessTitle')}</h2>
        <p className="mt-2 text-sm text-slate">{t('officers.noAccessBody')}</p>
      </div>
    );
  }

  if (isPending) return <FeedSkeleton />;

  if (isError) {
    return (
      <div className="gov-card border-l-4 border-l-danger p-6 text-center">
        <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
          {t('states.retry')}
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header>
        <h2 className="font-display text-xl font-bold text-ink">{t('officers.title')}</h2>
        <p className="mt-1 text-sm text-slate">{t('officers.subtitle')}</p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="sr-only" htmlFor="officer-search">
          {t('officers.search')}
        </label>
        <input
          id="officer-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('officers.searchPlaceholder')}
          className="gov-input max-w-md"
        />
        <div className="flex flex-wrap gap-2">
          {ROLE_FILTERS.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setRoleFilter(code)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                roleFilter === code
                  ? 'bg-brand text-white'
                  : 'border border-line bg-surface text-ink hover:bg-surface-2'
              }`}
            >
              {code === 'ALL' ? t('officers.filterAll') : t(`officers.role.${code}`, { defaultValue: code.replace(/_/g, ' ') })}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-ink-3">
        {t('officers.count', { shown: rows.length, total: data?.length ?? 0 })}
      </p>

      {rows.length === 0 ? (
        <div className="gov-card p-8 text-center">
          <p className="font-semibold text-ink">{t('officers.emptyTitle')}</p>
          <p className="mt-1 text-sm text-slate">{t('officers.emptyBody')}</p>
        </div>
      ) : (
        <div className="gov-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t('officers.colName')}</th>
                  <th className="px-4 py-3 font-semibold">{t('officers.colPhone')}</th>
                  <th className="px-4 py-3 font-semibold">{t('officers.colRole')}</th>
                  <th className="px-4 py-3 font-semibold">{t('officers.colOrg')}</th>
                  <th className="px-4 py-3 font-semibold">{t('officers.colLevel')}</th>
                  <th className="px-4 py-3 font-semibold">{t('officers.colGranted')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={`${r.userId}-${r.roleCode}-${r.orgUnitId}`} className="hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{r.fullName}</p>
                      <p className="text-[11px] text-ink-3">{r.orgPath}</p>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink">{r.phone}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-brand-tint px-2 py-0.5 text-[11px] font-bold text-brand">
                        {r.roleName ?? r.roleCode.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink">{r.orgName}</td>
                    <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate">
                      {r.orgLevel}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate">{formatDate(r.grantedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
