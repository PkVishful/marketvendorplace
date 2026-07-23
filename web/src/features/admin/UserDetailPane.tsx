import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, X } from 'lucide-react';
import type { AdminUserRow } from '@/types/domain';
import { useUserActivities, useUpdateAdminUser } from './useAdmin';

type Tab = 'details' | 'activities';

function initialsOf(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();
}

/** Turns `admin.user_update` into `Admin user update` for display. */
function humaniseAction(action: string) {
  const words = action.replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function UserDetailPane({
  user, onClose,
}: {
  user: AdminUserRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('details');
  // Editing happens here rather than in the list row: once a user is selected
  // the list collapses to a narrow column, and the inline inputs were clipped
  // by it. The detail pane is the only place with room for a form.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', isActive: true });
  const update = useUpdateAdminUser();

  // Re-seed whenever a different user is selected, or the form would keep
  // showing the previous person's values.
  useEffect(() => {
    setForm({
      fullName: user.fullName ?? '',
      phone: user.phone ?? '',
      email: user.email ?? '',
      isActive: user.isActive !== false,
    });
    setEditing(false);
  }, [user]);
  // Only fetched once the tab is opened — most of the time an admin is looking
  // at details, and the audit query is the expensive half.
  const activities = useUserActivities(tab === 'activities' ? user.userId : null);

  const active = user.isActive !== false;

  return (
    <div className="min-w-0 flex-1">
      <header className="flex flex-wrap items-start gap-4 border-b border-line pb-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand text-lg font-bold text-white">
          {initialsOf(user.fullName || '?')}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold text-ink">{user.fullName}</h2>
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                active ? 'bg-success-bg text-success' : 'bg-surface-2 text-ink-3'
              }`}
            >
              {active ? t('admin.active') : t('admin.inactive')}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-ink-2">{user.email || user.phone}</p>

          <ul className="mt-2 flex flex-wrap gap-1.5">
            {user.roles.map((r) => (
              <li
                key={`${r.roleCode}-${r.orgUnitId}`}
                className="rounded bg-saffron-soft px-2 py-0.5 text-[11px] font-medium text-accent-dark"
              >
                {r.roleName} · {r.orgName}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!editing && (
            <button
              type="button"
              onClick={() => { setTab('details'); setEditing(true); }}
              className="gov-btn-primary flex items-center gap-1.5 text-sm"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden /> {t('admin.edit')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('admin.closeDetail')}
            className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-3 hover:bg-surface-2"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      <div role="tablist" aria-label={t('admin.userTabs')} className="flex gap-4 border-b border-line">
        {(['details', 'activities'] as Tab[]).map((id) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-1 py-2.5 text-sm transition ${
              tab === id
                ? 'border-brand font-semibold text-brand'
                : 'border-transparent text-ink-2 hover:text-ink'
            }`}
          >
            {id === 'details' ? t('admin.moreDetails') : t('admin.recentActivities')}
          </button>
        ))}
      </div>

      {tab === 'details' ? (
        editing ? (
          <form
            className="mt-4"
            onSubmit={async (e) => {
              e.preventDefault();
              await update.mutateAsync({ userId: user.userId, ...form });
              setEditing(false);
            }}
          >
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
                  {t('admin.fullName')}
                </span>
                <input
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                  required
                  className="gov-input mt-1 w-full"
                />
              </label>
              <label className="block text-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
                  {t('admin.email')}
                </span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="gov-input mt-1 w-full"
                />
              </label>
              <label className="block text-sm">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
                  {t('admin.mobile')}
                </span>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  inputMode="numeric"
                  className="gov-input mt-1 w-full tabular-nums"
                />
              </label>
              <label className="flex items-center gap-2 self-end text-sm text-ink">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="h-4 w-4 accent-brand"
                />
                {t('admin.active')}
              </label>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button type="submit" className="gov-btn-primary text-sm" disabled={update.isPending || !form.fullName.trim()}>
                {update.isPending ? t('admin.saving') : t('admin.save')}
              </button>
              <button type="button" className="gov-btn-secondary text-sm" onClick={() => setEditing(false)}>
                {t('pricing.cancel')}
              </button>
              {update.isError && (
                <span className="text-sm text-danger" role="alert">{t('admin.editFailed')}</span>
              )}
            </div>
          </form>
        ) : (
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {[
            { label: t('admin.fullName'), value: user.fullName },
            { label: t('admin.email'), value: user.email || '—' },
            { label: t('admin.mobile'), value: user.phone },
            { label: t('admin.status'), value: active ? t('admin.active') : t('admin.inactive') },
            { label: t('admin.rolesCol'), value: user.roles.length ? `${user.roles.length}` : '0' },
          ].map((row) => (
            <div key={row.label}>
              <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-3">{row.label}</dt>
              <dd className="mt-0.5 text-sm text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
        )
      ) : (
        <div className="mt-4">
          {activities.isPending && (
            <p className="text-sm text-slate" role="status">{t('admin.loadingActivities')}</p>
          )}
          {activities.isError && (
            <p className="text-sm text-danger">{t('admin.activitiesFailed')}</p>
          )}
          {activities.data?.length === 0 && (
            <p className="text-sm text-slate">{t('admin.noActivities')}</p>
          )}

          {/* Timeline: a rail with a dot per entry, timestamp on the left. */}
          <ol className="relative space-y-3 border-l border-line pl-6">
            {(activities.data ?? []).map((a) => (
              <li key={a.seq} className="relative">
                <span
                  className="absolute -left-[1.6rem] top-3 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-surface"
                  aria-hidden
                />
                <div className="rounded-lg border border-line bg-surface px-3 py-2">
                  <p className="text-sm text-ink">{humaniseAction(a.action)}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {new Date(a.occurredAt).toLocaleString()} · {a.entityType}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
