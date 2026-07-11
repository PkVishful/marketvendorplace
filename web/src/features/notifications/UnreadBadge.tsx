import { useTranslation } from 'react-i18next';

export function UnreadBadge({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white ring-2 ring-brand"
      aria-label={t('feed.unread', { count })}
    >
      {count}
    </span>
  );
}
