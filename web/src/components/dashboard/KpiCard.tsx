import type { ReactNode } from 'react';

type KpiTone = 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const toneStyles: Record<KpiTone, { border: string; icon: string }> = {
  brand: { border: 'border-l-brand', icon: 'bg-brand-tint text-brand' },
  accent: { border: 'border-l-accent', icon: 'bg-saffron-soft text-accent-dark' },
  success: { border: 'border-l-success', icon: 'bg-success-bg text-success' },
  warning: { border: 'border-l-warning', icon: 'bg-warning-bg text-warning' },
  danger: { border: 'border-l-danger', icon: 'bg-danger-bg text-danger' },
  info: { border: 'border-l-info', icon: 'bg-info-bg text-info' },
};

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: KpiTone;
  loading?: boolean;
}) {
  const styles = toneStyles[tone];

  return (
    <article
      className={`dash-kpi gov-card border-l-4 ${styles.border} p-4 sm:p-5`}
      aria-busy={loading}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">{label}</p>
          {loading ? (
            <div className="mt-2 h-8 w-16 animate-pulse rounded-lg bg-surface-2" />
          ) : (
            <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{value}</p>
          )}
          {hint && !loading && <p className="mt-1 text-xs text-slate">{hint}</p>}
        </div>
        {icon && (
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${styles.icon}`}
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>
    </article>
  );
}
