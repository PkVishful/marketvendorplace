import { useTranslation } from 'react-i18next';
import { usePermission } from '@/auth/permissions';
import { FeedSkeleton } from '@/components/Skeleton';
import { useAdminRoles } from './useAdmin';

export function RolesTab() {
  const { t } = useTranslation();
  const canEdit = usePermission('catalog.manage');
  const { data, isPending, isError, refetch } = useAdminRoles();

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
    <div className="space-y-4">
      {!canEdit && (
        <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-slate">
          {t('admin.rolesReadOnly')}
        </p>
      )}
      <div className="gov-card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
            <tr>
              <th className="px-4 py-3">{t('admin.roleCode')}</th>
              <th className="px-4 py-3">{t('admin.roleName')}</th>
              <th className="px-4 py-3">{t('admin.permissions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(data?.roles ?? []).map((r) => (
              <tr key={r.code}>
                <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                <td className="px-4 py-3">{r.name}</td>
                <td className="px-4 py-3 text-xs text-slate">{r.permissions.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
