import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { usePermission } from '@/auth/permissions';
import { useAdminRoles, useSetRolePermissions } from './useAdmin';

/**
 * One role, with its permissions as an editable matrix.
 *
 * The list screen can only show permissions as text; granting and revoking
 * needs a place where the full catalogue is visible, including the permissions
 * the role does *not* have — those are the interesting ones.
 */
export function RoleDetailPage() {
  const { code = '' } = useParams<{ code: string }>();
  const { t } = useTranslation();
  const editable = usePermission('catalog.manage');
  const rolesQuery = useAdminRoles();
  const setPermissions = useSetRolePermissions();

  const role = rolesQuery.data?.roles.find((r) => r.code === code);
  const catalogue = useMemo(() => rolesQuery.data?.permissions ?? [], [rolesQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (role) { setSelected(new Set(role.permissions)); setDirty(false); }
  }, [role]);


  function toggle(permission: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission); else next.add(permission);
      return next;
    });
    setDirty(true);
  }

  if (rolesQuery.isPending) {
    return <p className="text-sm text-slate" role="status">{t('roleDetail.loading')}</p>;
  }
  if (rolesQuery.isError) {
    return <p className="text-sm text-danger">{t('roleDetail.loadFailed')}</p>;
  }
  if (!role) {
    return (
      <div>
        <p className="text-sm text-danger">{t('roleDetail.notFound', { code })}</p>
        <Link to="../roles" className="mt-3 inline-block text-sm text-brand hover:underline">
          {t('roleDetail.back')}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link to="../roles" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
        <ChevronLeft className="h-4 w-4" aria-hidden /> {t('roleDetail.back')}
      </Link>

      <header className="mt-3">
        <h2 className="font-display text-lg font-bold text-ink">{role.name || role.code}</h2>
        <p className="text-xs uppercase tracking-wide text-ink-3">{role.code}</p>
      </header>

      {!editable && (
        <p className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
          {t('roleDetail.readOnly')}
        </p>
      )}

      <p className="mt-5 text-sm font-medium text-ink">
        {t('roleDetail.permissionsCount', { granted: selected.size, total: catalogue.length })}
      </p>

      <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
        {catalogue.map((permission) => {
          const on = selected.has(permission.code);
          return (
            <li key={permission.code} className="flex items-start gap-3 px-4 py-3">
              <input
                id={`perm-${permission.code}`}
                type="checkbox"
                checked={on}
                disabled={!editable}
                onChange={() => toggle(permission.code)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
              />
              <label htmlFor={`perm-${permission.code}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block font-mono text-xs text-ink">{permission.code}</span>
                <span className="block text-xs text-ink-3">{permission.description}</span>
              </label>
            </li>
          );
        })}
      </ul>

      {editable && (
        <div className="sticky bottom-0 mt-5 flex items-center gap-3 border-t border-line bg-surface py-3">
          <button
            type="button"
            className="gov-btn-primary"
            disabled={!dirty || setPermissions.isPending}
            onClick={() => setPermissions.mutate(
              { code: role.code, permissions: [...selected] },
              { onSuccess: () => setDirty(false) },
            )}
          >
            {setPermissions.isPending ? t('roleDetail.saving') : t('roleDetail.save')}
          </button>
          <button
            type="button"
            className="gov-btn-secondary"
            disabled={!dirty}
            onClick={() => { setSelected(new Set(role.permissions)); setDirty(false); }}
          >
            {t('roleDetail.reset')}
          </button>
          {setPermissions.isError && (
            <span className="text-sm text-danger" role="alert">{t('roleDetail.saveFailed')}</span>
          )}
        </div>
      )}
    </div>
  );
}
