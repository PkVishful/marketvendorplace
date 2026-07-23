import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AdminUserRow } from '@/types/domain';
import { useUpdateAdminUser } from './useAdmin';

/**
 * Inline edit for one user, rendered in place of its table row.
 *
 * Inline rather than a modal: the surrounding rows stay visible, so an admin
 * correcting a name can still see the neighbouring entries they are matching
 * it against.
 */
export function EditUserRow({ user, onDone }: { user: AdminUserRow; onDone: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateAdminUser();

  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [isActive, setIsActive] = useState(user.isActive !== false);

  async function save() {
    await update.mutateAsync({ userId: user.userId, fullName, phone, email, isActive });
    onDone();
  }

  return (
    <tr className="bg-surface-2/60">
      <td className="px-4 py-3">
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          aria-label={t('admin.fullName')}
          className="gov-input w-full"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('admin.email')}
          aria-label={t('admin.email')}
          className="gov-input mt-1 w-full text-xs"
        />
      </td>
      <td className="px-4 py-3">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="numeric"
          aria-label={t('admin.mobile')}
          className="gov-input w-full tabular-nums"
        />
      </td>
      <td className="px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          {t('admin.active')}
        </label>
        {update.isError && (
          <p className="mt-1 text-xs text-danger" role="alert">{t('admin.editFailed')}</p>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={update.isPending || !fullName.trim()}
            className="text-xs font-semibold text-brand hover:underline disabled:opacity-50"
          >
            {update.isPending ? t('admin.saving') : t('admin.save')}
          </button>
          <button type="button" onClick={onDone} className="text-xs text-ink-3 hover:underline">
            {t('pricing.cancel')}
          </button>
        </div>
      </td>
    </tr>
  );
}
