import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Award,
  ChevronRight,
  ClipboardList,
  FileEdit,
  FlaskConical,
  Radio,
} from 'lucide-react';
import { OrderStatusPill } from '@/features/orders/OrderStatusPill';
import type { GovOrderSummary } from '@/types/domain';
import { formatDate, formatDeadline } from '@/lib/time';
import { rfqCodeFromSummary } from './rfqDetailModel';

function formatStage(code: string): string {
  return code
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

function PipelineKpi({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  accent: string;
}) {
  return (
    <article className="rfq-kpi gov-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="rfq-kpi-label">{label}</p>
          <p className="rfq-kpi-value">{value}</p>
        </div>
        <span className={`rfq-kpi-icon ${accent}`}>{icon}</span>
      </div>
    </article>
  );
}

export function RfqPipelineView({
  orders,
  projects,
  projectFilter,
  onProjectFilterChange,
  message,
  floatPending,
  onFloat,
}: {
  orders: GovOrderSummary[];
  projects: { id: string; name: string }[];
  projectFilter: string;
  onProjectFilterChange: (id: string) => void;
  message: { tone: 'good' | 'danger'; text: string } | null;
  floatPending: boolean;
  onFloat: (orderId: string) => void;
}) {
  const { t } = useTranslation();

  const stats = {
    total: orders.length,
    active: orders.filter((o) => o.status === 'FLOATED' || o.status === 'REVEALING').length,
    draft: orders.filter((o) => o.status === 'DRAFT').length,
    awarded: orders.filter((o) => o.status === 'AWARDED').length,
  };

  return (
    <section className="rfq-pipeline space-y-6">
      <nav className="rfq-breadcrumb" aria-label="Breadcrumb">
        <Link to="/gov">E-Works</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link to="/gov">{t('gov.navHome')}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span aria-current="page">{t('govOrders.nav')}</span>
      </nav>

      <header className="rfq-header gov-card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">
              {t('govOrders.kpiEyebrow')}
            </p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink sm:text-2xl">
              {t('govOrders.title')}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate">{t('govOrders.subtitle')}</p>
          </div>
          <label className="block min-w-[14rem] shrink-0">
            <span className="rfq-kpi-label">{t('govOrders.filterProject')}</span>
            <select
              className="gov-input mt-1.5 w-full"
              value={projectFilter}
              onChange={(e) => onProjectFilterChange(e.target.value)}
            >
              <option value="">{t('govOrders.allProjects')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {message && (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.tone === 'good'
              ? 'border-success/30 bg-success-bg text-success'
              : 'border-danger/30 bg-danger-bg text-danger'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PipelineKpi
          label={t('govOrders.kpiTotal')}
          value={stats.total}
          icon={<ClipboardList className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-brand"
        />
        <PipelineKpi
          label={t('govOrders.kpiActive')}
          value={stats.active}
          icon={<Radio className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-accent"
        />
        <PipelineKpi
          label={t('govOrders.kpiDraft')}
          value={stats.draft}
          icon={<FileEdit className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-warn"
        />
        <PipelineKpi
          label={t('govOrders.kpiAwarded')}
          value={stats.awarded}
          icon={<Award className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-success"
        />
      </div>

      {orders.length === 0 ? (
        <div className="gov-card p-10 text-center">
          <FlaskConical className="mx-auto h-10 w-10 text-ink-3" strokeWidth={1.5} />
          <p className="mt-4 font-semibold text-ink">{t('govOrders.emptyTitle')}</p>
          <p className="mt-2 text-sm text-slate">{t('govOrders.emptyBody')}</p>
          <Link to="/gov/planner" className="gov-btn-primary mt-5 inline-flex">
            {t('govOrders.goPlanner')}
          </Link>
        </div>
      ) : (
        <div className="gov-card overflow-hidden">
          <div className="border-b border-line px-5 py-4 sm:px-6">
            <h2 className="font-display text-base font-bold text-ink">{t('govOrders.listTitle')}</h2>
            <p className="mt-0.5 text-xs text-slate">{t('govOrders.listHint')}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="rfq-table w-full text-left text-sm">
              <thead>
                <tr>
                  <th>{t('govOrders.colRfq')}</th>
                  <th>{t('govOrders.colMilestone')}</th>
                  <th>{t('govOrders.colStage')}</th>
                  <th>{t('govOrders.colStatus')}</th>
                  <th>{t('govOrders.colItems')}</th>
                  <th>{t('govOrders.colDue')}</th>
                  <th className="text-right">{t('govOrders.colAction')}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const code = rfqCodeFromSummary(o);
                  const canFloat = o.status === 'DRAFT' && o.itemCount > 0;
                  const canOpen = o.status !== 'DRAFT';

                  return (
                    <tr key={o.id} className="group">
                      <td className="font-mono text-xs font-semibold text-brand">{code}</td>
                      <td>
                        {canOpen ? (
                          <Link
                            to={`/gov/orders/${o.id}`}
                            className="block font-medium text-ink group-hover:text-brand"
                          >
                            {o.milestone}
                            <span className="mt-0.5 block text-xs font-normal text-slate">
                              {o.orgName}
                            </span>
                          </Link>
                        ) : (
                          <>
                            <span className="font-medium text-ink">{o.milestone}</span>
                            <span className="mt-0.5 block text-xs text-slate">{o.orgName}</span>
                          </>
                        )}
                      </td>
                      <td>
                        <span className="rfq-chip rfq-chip-neutral">{formatStage(o.stageCode)}</span>
                      </td>
                      <td>
                        <OrderStatusPill status={o.status} />
                        {o.bidCloseAt && o.status === 'FLOATED' && (
                          <span className="mt-1 block text-[10px] text-slate">
                            {t('govOrders.bidCloses', { when: formatDeadline(o.bidCloseAt) })}
                          </span>
                        )}
                      </td>
                      <td className="font-mono tabular-nums">{o.itemCount}</td>
                      <td className="whitespace-nowrap">{formatDate(o.requiredBy)}</td>
                      <td className="text-right">
                        {canFloat ? (
                          <button
                            type="button"
                            className="gov-btn-primary text-xs"
                            disabled={floatPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              onFloat(o.id);
                            }}
                          >
                            {floatPending ? t('govOrders.floating') : t('govOrders.float')}
                          </button>
                        ) : canOpen ? (
                          <Link
                            to={`/gov/orders/${o.id}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                          >
                            {t('govOrders.viewBids')}
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-3">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
