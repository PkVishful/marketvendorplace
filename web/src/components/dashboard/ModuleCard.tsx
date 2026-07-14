import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

export function ModuleCard({
  title,
  description,
  to,
  tone = 'brand',
  badge,
  icon,
  stat,
  subStats,
}: {
  title: string;
  description?: string;
  to: string;
  tone?: 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  badge?: string;
  icon?: ReactNode;
  stat?: string;
  subStats?: { label: string; value: string }[];
}) {
  const { t } = useTranslation();
  const iconBg = {
    brand: 'bg-brand-tint text-brand',
    accent: 'bg-saffron-soft text-accent-dark',
    success: 'bg-success-bg text-success',
    warning: 'bg-warning-bg text-warning',
    danger: 'bg-danger-bg text-danger',
    info: 'bg-info-bg text-info',
  }[tone];

  return (
    <Link
      to={to}
      className="dash-module gov-card group block p-5 transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${iconBg}`}
            aria-hidden
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-ink group-hover:text-brand">{title}</h3>
            {badge && (
              <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-brand-dark">
                {badge}
              </span>
            )}
          </div>
          {stat && <p className="mt-2 font-display text-lg font-bold text-ink">{stat}</p>}
          {subStats && subStats.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate">
              {subStats.map((s) => (
                <span key={s.label}>
                  {s.label}: <span className="font-semibold text-ink">{s.value}</span>
                </span>
              ))}
            </div>
          )}
          {description && !stat && (
            <p className="mt-2 text-sm leading-relaxed text-slate">{description}</p>
          )}
        </div>
      </div>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">
        {t('gov.openModule')}
        <span aria-hidden className="transition group-hover:translate-x-0.5">
          →
        </span>
      </span>
    </Link>
  );
}
