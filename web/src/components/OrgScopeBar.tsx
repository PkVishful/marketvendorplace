import { useTranslation } from 'react-i18next';

export function OrgScopeBar({ scope, roleLabel }: { scope: string; roleLabel?: string }) {
  const { t } = useTranslation();
  const parts = scope.split(' › ');

  return (
    <nav
      aria-label={t('shell.orgScope')}
      className="border-b border-line/60 bg-brand-tint/40 px-4 py-2 text-xs sm:px-6"
    >
      <div className="mx-auto flex max-w-portal flex-wrap items-center gap-x-2 gap-y-1 text-slate">
        <span className="font-semibold text-brand">{t('shell.state')}</span>
        {parts.map((part, i) => (
          <span key={`${part}-${i}`} className="flex items-center gap-2">
            <span aria-hidden="true" className="text-ink-3">
              ›
            </span>
            <span className={i === parts.length - 1 ? 'font-semibold text-ink' : ''}>{part}</span>
          </span>
        ))}
        {roleLabel && (
          <>
            <span className="mx-1 hidden text-ink-3 sm:inline">·</span>
            <span className="rounded-md bg-surface px-2 py-0.5 font-semibold uppercase tracking-wide text-brand">
              {roleLabel}
            </span>
          </>
        )}
      </div>
    </nav>
  );
}
