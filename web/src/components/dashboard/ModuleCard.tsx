import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function ModuleCard({
  title,
  description,
  to,
  tone = 'brand',
  badge,
}: {
  title: string;
  description: string;
  to: string;
  tone?: 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  badge?: string;
}) {
  const { t } = useTranslation();
  const border = {
    brand: 'border-l-brand',
    accent: 'border-l-accent',
    success: 'border-l-success',
    warning: 'border-l-warning',
    danger: 'border-l-danger',
    info: 'border-l-info',
  }[tone];

  return (
    <Link
      to={to}
      className={`dash-module gov-card group block border-l-4 ${border} p-5 transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-accent`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-ink group-hover:text-brand">{title}</h3>
        {badge && (
          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-brand-dark">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate">{description}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">
        {t('gov.openModule')}
        <span aria-hidden className="transition group-hover:translate-x-0.5">
          →
        </span>
      </span>
    </Link>
  );
}
