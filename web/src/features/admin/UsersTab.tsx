import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { Pagination } from '@/components/Pagination';
import { UserGroupTabs, type UserGroup } from './UserGroupTabs';
import { UserDetailPane } from './UserDetailPane';
import {
  useAdminOrgUnits,
  useAdminUsers,
  useCreateAdminUser,
  useGrantableRoles,
  useRevokeAdminRole,
} from './useAdmin';

export function UsersTab() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<UserGroup>('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [orgUnitId, setOrgUnitId] = useState('');
  const [roleCode, setRoleCode] = useState('');

  const { data: usersPage, isPending, isError, refetch } = useAdminUsers(q, group, page);
  const users = usersPage?.rows;
  const selected = users?.find((u) => u.userId === selectedId) ?? null;
  const { data: orgUnits } = useAdminOrgUnits();
  const { data: grantable } = useGrantableRoles(orgUnitId);
  const createUser = useCreateAdminUser();
  const revokeRole = useRevokeAdminRole();

  const orgOptions = useMemo(() => orgUnits ?? [], [orgUnits]);

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await createUser.mutateAsync({ fullName, phone, orgUnitId, roleCode });
    setShowForm(false);
    setFullName('');
    setPhone('');
    setOrgUnitId('');
    setRoleCode('');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder={t('admin.usersSearch')}
          className="gov-input max-w-md"
        />
        <button type="button" onClick={() => setShowForm((p) => !p)} className="gov-btn-primary">
          {t('admin.addOfficer')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={(e) => void handleCreate(e)} className="gov-card space-y-4 p-5">
          <h3 className="font-semibold text-ink">{t('admin.addOfficer')}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-ink">{t('admin.fullName')}</span>
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="gov-input mt-1 w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-ink">{t('admin.mobile')}</span>
              <input
                required
                pattern="[6-9][0-9]{9}"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="gov-input mt-1 w-full"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-ink">{t('admin.orgUnit')}</span>
              <select
                required
                value={orgUnitId}
                onChange={(e) => {
                  setOrgUnitId(e.target.value);
                  setRoleCode('');
                }}
                className="gov-input mt-1 w-full"
              >
                <option value="">{t('admin.pickOrg')}</option>
                {orgOptions.map((ou) => (
                  <option key={ou.id} value={ou.id}>
                    {ou.name} ({ou.level})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-ink">{t('admin.role')}</span>
              <select
                required
                value={roleCode}
                disabled={!orgUnitId}
                onChange={(e) => setRoleCode(e.target.value)}
                className="gov-input mt-1 w-full"
              >
                <option value="">{t('admin.pickRole')}</option>
                {(grantable ?? []).map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={createUser.isPending} className="gov-btn-primary">
              {t('admin.createUser')}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="gov-btn-secondary">
              {t('pricing.cancel')}
            </button>
          </div>
        </form>
      )}

      <UserGroupTabs
        value={group}
        onChange={(g) => { setGroup(g); setPage(1); }}
      />

      <div className={`flex gap-5 ${selected ? 'flex-col xl:flex-row' : ''}`}>
      <div className={`gov-card overflow-hidden ${selected ? 'xl:w-[22rem] xl:shrink-0' : 'flex-1'}`}>
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
            <tr>
              <th className="px-4 py-3">{t('admin.fullName')}</th>
              {!selected && <th className="px-4 py-3">{t('admin.mobile')}</th>}
              {!selected && <th className="px-4 py-3">{t('admin.rolesCol')}</th>}
              <th className="px-4 py-3 text-right">{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(users ?? []).map((u) => (
              <tr
                key={u.userId}
                onClick={() => setSelectedId(u.userId)}
                className={`cursor-pointer ${u.userId === selectedId ? 'bg-brand-tint/40' : 'hover:bg-surface-2'}`}
              >
                <td className="px-4 py-3 font-semibold text-ink">
                  {u.fullName}
                  {u.isActive === false && (
                    <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase text-ink-3">
                      {t('admin.inactive')}
                    </span>
                  )}
                  <span className="block text-xs font-normal text-ink-3">{u.email || '—'}</span>
                </td>
                {!selected && <td className="px-4 py-3 tabular-nums">{u.phone}</td>}
                {!selected && (
                <td className="px-4 py-3">
                  <ul className="space-y-1">
                    {u.roles.map((r) => (
                      <li key={`${r.roleCode}-${r.orgUnitId}`} className="flex flex-wrap items-center gap-2">
                        <span className="text-ink">
                          {r.roleName} · {r.orgName}
                        </span>
                        <button
                          type="button"
                          disabled={revokeRole.isPending}
                          onClick={() =>
                            void revokeRole.mutateAsync({
                              userId: u.userId,
                              roleCode: r.roleCode,
                              orgUnitId: r.orgUnitId,
                            })
                          }
                          className="text-xs font-semibold text-danger hover:underline"
                        >
                          {t('admin.revoke')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </td>
                )}
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setSelectedId(u.userId)}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    {t('admin.view')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="gov-card min-w-0 flex-1 p-5">
          <UserDetailPane user={selected} onClose={() => setSelectedId(null)} />
        </div>
      )}
      </div>

      <Pagination
        total={usersPage?.total ?? 0}
        page={usersPage?.page ?? 1}
        pageSize={usersPage?.pageSize ?? 25}
        onPage={setPage}
      />
    </div>
  );
}
