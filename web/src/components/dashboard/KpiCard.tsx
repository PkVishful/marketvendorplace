import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

type KpiTone = 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const toneStyles: Record<KpiTone, { icon: string; trend: string }> = {
  brand: { icon: 'bg-brand-tint text-brand', trend: 'text-brand' },
  accent: { icon: 'bg-saffron-soft text-accent-dark', trend: 'text-accent-dark' },
  success: { icon: 'bg-success-bg text-success', trend: 'text-success' },
  warning: { icon: 'bg-warning-bg text-warning', trend: 'text-warning' },
  danger: { icon: 'bg-danger-bg text-danger', trend: 'text-danger' },
  info: { icon: 'bg-info-bg text-info', trend: 'text-info' },
};

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  loading,
  trend,
  trendDirection = 'up',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: KpiTone;
  loading?: boolean;
  trend?: string;
  trendDirection?: 'up' | 'down' | 'neutral';
}) {
  const styles = toneStyles[tone];
  const TrendIcon = trendDirection === 'down' ? TrendingDown : TrendingUp;

  return (
    <article className="dash-kpi gov-card p-4 sm:p-5" aria-busy={loading}>
      <div className="flex items-start justify-between gap-2">
        {trend && !loading && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              trendDirection === 'down'
                ? 'bg-danger-bg text-danger'
                : trendDirection === 'neutral'
                  ? 'bg-surface-2 text-slate'
                  : 'bg-success-bg text-success'
            }`}
          >
            {trendDirection !== 'neutral' && <TrendIcon className="h-3 w-3" strokeWidth={2.5} />}
            {trend}
          </span>
        )}
        {icon && (
          <span
            className={`ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-lg ${styles.icon}`}
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>
      <div className="mt-3 min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</p>
        {loading ? (
          <div className="mt-2 h-8 w-20 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <p className="mt-1 font-display text-2xl font-bold tabular-nums tracking-tight text-ink">{value}</p>
        )}
        {hint && !loading && <p className="mt-1 text-xs text-slate">{hint}</p>}
      </div>
    </article>
  );
}
