import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
} from 'recharts';
import {
  AlertTriangle,
  Bell,
  Building2,
  Calendar,
  ChevronRight,
  Download,
  FileText,
  FlaskConical,
  MessageSquare,
  MoreHorizontal,
  Radio,
  Sparkles,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { OrderStatusPill } from '@/features/orders/OrderStatusPill';
import type { GovOrderDetail } from '@/types/domain';
import type { RfqActivityItem, RfqDetailViewModel, RfqLabTestRow } from './rfqDetailModel';
const CHART_COLORS = ['#1a3a6b', '#1e8e5a', '#e0a02d', '#c0392b'];

const ACTIVITY_META: Record<
  RfqActivityItem['type'],
  { Icon: LucideIcon; tone: string; labelKey: string }
> = {
  system: { Icon: Radio, tone: 'rfq-activity-system', labelKey: 'rfqDetail.typeSystem' },
  document: { Icon: FileText, tone: 'rfq-activity-document', labelKey: 'rfqDetail.typeDocument' },
  reminder: { Icon: Bell, tone: 'rfq-activity-reminder', labelKey: 'rfqDetail.typeReminder' },
  invitation: { Icon: UserPlus, tone: 'rfq-activity-invitation', labelKey: 'rfqDetail.typeInvitation' },
  lab: { Icon: FlaskConical, tone: 'rfq-activity-lab', labelKey: 'rfqDetail.typeLab' },
  comment: { Icon: MessageSquare, tone: 'rfq-activity-comment', labelKey: 'rfqDetail.typeComment' },
};

function ActivityTypeBadge({ type }: { type: RfqActivityItem['type'] }) {
  const { t } = useTranslation();
  const chipTone: Record<RfqActivityItem['type'], string> = {
    system: 'rfq-chip-info',
    document: 'rfq-chip-neutral',
    reminder: 'rfq-chip-warn',
    invitation: 'rfq-chip-good',
    lab: 'rfq-chip-info',
    comment: 'rfq-chip-neutral',
  };
  return <span className={`rfq-chip ${chipTone[type]}`}>{t(ACTIVITY_META[type].labelKey)}</span>;
}

function ActivityFeedTable({ items }: { items: RfqActivityItem[] }) {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto">
      <table className="rfq-table rfq-activity-table w-full text-left text-sm">
        <thead>
          <tr>
            <th className="w-[45%]">{t('rfqDetail.colActivityEvent')}</th>
            <th>{t('rfqDetail.colActivityActor')}</th>
            <th>{t('rfqDetail.colActivityTime')}</th>
            <th>{t('rfqDetail.colActivityType')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => {
            const { Icon, tone } = ACTIVITY_META[a.type];
            return (
              <tr key={a.id} className="rfq-activity-row">
                <td>
                  <div className="flex items-start gap-3">
                    <span className={`rfq-activity-icon ${tone}`} aria-hidden>
                      <Icon className="h-4 w-4 text-brand" strokeWidth={2} />
                    </span>
                    <span className="font-medium text-ink">{a.title}</span>
                  </div>
                </td>
                <td className="text-slate">{a.subtitle}</td>
                <td className="whitespace-nowrap tabular-nums text-slate">{a.when}</td>
                <td>
                  <ActivityTypeBadge type={a.type} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function PriorityBadge({ priority }: { priority: RfqLabTestRow['priority'] }) {
  const cls = {
    CRITICAL: 'rfq-priority-critical',
    HIGH: 'rfq-priority-high',
    MEDIUM: 'rfq-priority-medium',
    LOW: 'rfq-priority-low',
  }[priority];
  return <span className={`rfq-priority ${cls}`}>{priority}</span>;
}

function StatusChip({ value }: { value: string }) {
  const tone =
    value === 'Verified' || value === 'Completed'
      ? 'rfq-chip-good'
      : value === 'Lab Assigned'
        ? 'rfq-chip-info'
        : value === 'Pending'
          ? 'rfq-chip-warn'
          : 'rfq-chip-neutral';
  return <span className={`rfq-chip ${tone}`}>{value}</span>;
}

function KpiCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  accent?: string;
}) {
  return (
    <article className="rfq-kpi gov-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="rfq-kpi-label">{label}</p>
          <p className="rfq-kpi-value">{value}</p>
          {hint && <p className="rfq-kpi-hint">{hint}</p>}
        </div>
        <span className={`rfq-kpi-icon ${accent ?? ''}`}>{icon}</span>
      </div>
    </article>
  );
}

export function RfqDetailView({
  order,
  vm,
  onCloseBidding,
  closePending,
  onAward,
  awardPending,
  canAward,
  canCloseBidding,
  message,
}: {
  order: GovOrderDetail;
  vm: RfqDetailViewModel;
  onCloseBidding?: () => void;
  closePending?: boolean;
  onAward?: () => void;
  awardPending?: boolean;
  canAward?: boolean;
  canCloseBidding?: boolean;
  message?: { tone: 'good' | 'danger'; text: string } | null;
}) {
  const { t } = useTranslation();
  const participationData = [
    { name: 'Responded', value: vm.participation.accepted },
    { name: 'Pending', value: vm.participation.invPending },
    { name: 'Declined', value: vm.participation.invDeclined },
    { name: 'Submitted', value: vm.participation.submitted },
  ].filter((d) => d.value > 0);

  const verifiedDocs = vm.documents.filter((d) => d.status === 'verified').length;

  return (
    <section className="rfq-detail space-y-6">
      <nav className="rfq-breadcrumb" aria-label="Breadcrumb">
        <Link to="/gov">{t('app.brand')}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link to="/gov">{t('gov.navHome')}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link to="/gov/orders">{t('govOrders.nav')}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span aria-current="page">{vm.rfqCode}</span>
      </nav>

      <header className="rfq-header gov-card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">
              {vm.rfqCode} · {order.stageCode.replace(/_/g, ' ')}
            </p>
            <h1 className="mt-1 font-display text-xl font-bold text-ink sm:text-2xl">{vm.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <OrderStatusPill status={order.status} />
              <span className="text-sm text-slate">{vm.closeHint}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="gov-btn-secondary text-sm">
              <Download className="mr-1.5 h-4 w-4" />
              {t('rfqDetail.download')}
            </button>
            <button type="button" className="gov-btn-secondary px-3" aria-label={t('rfqDetail.more')}>
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {canCloseBidding && onCloseBidding && (
              <button
                type="button"
                className="gov-btn-primary text-sm"
                disabled={closePending}
                onClick={onCloseBidding}
              >
                {closePending ? t('govAward.closeBidding') + '…' : t('rfqDetail.closeBidding')}
              </button>
            )}
            {canAward && onAward && (
              <button type="button" className="gov-btn-primary text-sm" disabled={awardPending} onClick={onAward}>
                {awardPending ? t('govAward.awarding') : t('govAward.awardL1')}
              </button>
            )}
          </div>
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
        <KpiCard
          label={t('rfqDetail.estimatedBudget')}
          value={vm.estimatedBudgetCr}
          hint={vm.budgetDelta}
          icon={<Building2 className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-brand"
        />
        <KpiCard
          label={t('rfqDetail.invitedVendors')}
          value={String(vm.invitedVendors)}
          hint={`▲ ${vm.vendorResponsePct}% ${t('rfqDetail.responded')}`}
          icon={<Users className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-accent"
        />
        <KpiCard
          label={t('rfqDetail.labTestsRequired')}
          value={String(vm.labTestsCount)}
          hint={`▼ ${vm.labTestsDone} of ${vm.labTestsCount} ${t('rfqDetail.done')}`}
          icon={<FlaskConical className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-success"
        />
        <KpiCard
          label={t('rfqDetail.daysToClose')}
          value={vm.daysToClose != null ? String(vm.daysToClose) : '—'}
          hint={order.bidCloseAt ? t('rfqDetail.closing', { date: new Date(order.bidCloseAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }) : undefined}
          icon={<Calendar className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-warn"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_minmax(18rem,22rem)]">
        <div className="space-y-6">
          <article className="gov-card overflow-hidden">
            <div className="border-b border-line px-5 py-4 sm:px-6">
              <h2 className="font-display text-lg font-bold text-ink">{t('rfqDetail.rfqDetails')}</h2>
              <p className="mt-0.5 text-sm text-slate">{t('rfqDetail.rfqDetailsDesc')}</p>
            </div>
            <div className="px-5 py-4 sm:px-6">
              <p className="text-sm leading-relaxed text-slate">{vm.description}</p>
              <dl className="rfq-meta-grid mt-5">
                {[
                  [t('rfqDetail.concreteGrade'), vm.meta.concreteGrade],
                  [t('rfqDetail.estimatedQty'), vm.meta.quantity],
                  [t('rfqDetail.projectLength'), vm.meta.projectLength],
                  [t('rfqDetail.location'), vm.meta.location],
                  [t('rfqDetail.duration'), vm.meta.duration],
                  [t('rfqDetail.safetyClass'), vm.meta.safetyClass],
                  [t('rfqDetail.workType'), vm.meta.workType],
                  [t('rfqDetail.priority'), vm.meta.priority],
                ].map(([label, val]) => (
                  <div key={label} className="rfq-meta-cell">
                    <dt>{label}</dt>
                    <dd>{val}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </article>

          <article className="gov-card border-l-4 border-l-brand p-5">
            <h2 className="font-semibold text-ink">{t('rfqDetail.scopeTitle')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate">{vm.scopeText}</p>
          </article>

          <article className="gov-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4 sm:px-6">
              <div>
                <h2 className="font-display text-lg font-bold text-ink">{t('rfqDetail.requiredDocs')}</h2>
                <p className="mt-0.5 text-sm text-slate">
                  {verifiedDocs} {t('rfqDetail.verified')} · {vm.documents.length - verifiedDocs}{' '}
                  {t('rfqDetail.pendingSig')}
                </p>
              </div>
              <button type="button" className="text-sm font-semibold text-brand hover:underline">
                {t('rfqDetail.uploadVersion')}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="rfq-table w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>{t('rfqDetail.colDocument')}</th>
                    <th>{t('rfqDetail.colVersion')}</th>
                    <th>{t('rfqDetail.colSize')}</th>
                    <th>{t('rfqDetail.colUploadedBy')}</th>
                    <th>{t('rfqDetail.colDate')}</th>
                    <th>{t('rfqDetail.colDigitalSig')}</th>
                    <th>{t('rfqDetail.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {vm.documents.map((doc) => (
                    <tr key={doc.id}>
                      <td className="font-medium text-ink">
                        <span className="inline-flex items-center gap-2">
                          <FileText className="h-4 w-4 text-brand" />
                          {doc.name}
                        </span>
                      </td>
                      <td>{doc.version}</td>
                      <td className="tabular-nums">{doc.size}</td>
                      <td>{doc.uploadedBy}</td>
                      <td>{doc.uploadedAt}</td>
                      <td>
                        <StatusChip value={doc.signature === 'signed' ? 'Signed' : 'Pending'} />
                      </td>
                      <td>
                        <StatusChip value={doc.status === 'verified' ? 'Verified' : 'Pending'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="gov-card overflow-hidden">
            <div className="border-b border-line px-5 py-4 sm:px-6">
              <h2 className="font-display text-lg font-bold text-ink">{t('rfqDetail.labTests')}</h2>
              <p className="mt-0.5 text-sm text-slate">{t('rfqDetail.labTestsDesc')}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="rfq-table w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>{t('rfqDetail.colTestName')}</th>
                    <th>{t('rfqDetail.colPriority')}</th>
                    <th>{t('rfqDetail.colRequiredQty')}</th>
                    <th>{t('rfqDetail.colAssignedLab')}</th>
                    <th>{t('rfqDetail.colDeadline')}</th>
                    <th>{t('rfqDetail.colEngineer')}</th>
                    <th>{t('rfqDetail.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {vm.labTests.map((row) => (
                    <tr key={row.id}>
                      <td className="font-medium text-ink">{row.testName}</td>
                      <td>
                        <PriorityBadge priority={row.priority} />
                      </td>
                      <td>{row.requiredQty}</td>
                      <td>{row.assignedLab}</td>
                      <td>{row.deadline}</td>
                      <td>{row.engineer}</td>
                      <td>
                        <StatusChip
                          value={
                            row.status === 'completed'
                              ? 'Completed'
                              : row.status === 'lab_assigned'
                                ? 'Lab Assigned'
                                : 'Pending'
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <aside className="space-y-6">
          <article className="gov-card p-5">
            <h2 className="font-display text-base font-bold text-ink">{t('rfqDetail.participation')}</h2>
            <p className="mt-0.5 text-xs text-slate">
              {vm.participation.invited} {t('rfqDetail.invited')} · {t('rfqDetail.sealedNote')}
            </p>
            <div className="relative mx-auto mt-4 h-36 w-36">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={participationData}
                    dataKey="value"
                    innerRadius={42}
                    outerRadius={58}
                    paddingAngle={2}
                  >
                    {participationData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-xl font-bold text-brand">{vm.participation.responsePct}%</span>
                <span className="text-[10px] text-slate">{t('rfqDetail.responseRate')}</span>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-xs">
              {[
                [t('rfqDetail.statInvited'), vm.participation.invited, '100%'],
                [t('rfqDetail.statAccepted'), vm.participation.accepted, `${Math.round((vm.participation.accepted / vm.participation.invited) * 100)}%`],
                [t('rfqDetail.statSubmitted'), vm.participation.submitted, `${Math.round((vm.participation.submitted / vm.participation.invited) * 100)}%`],
                [t('rfqDetail.statInvPending'), vm.participation.invPending, `${Math.round((vm.participation.invPending / vm.participation.invited) * 100)}%`],
                [t('rfqDetail.statDeclined'), vm.participation.invDeclined, `${Math.round((vm.participation.invDeclined / vm.participation.invited) * 100)}%`],
              ].map(([label, val, pct]) => (
                <li key={String(label)} className="flex justify-between gap-2 border-b border-line/60 pb-2">
                  <span className="text-slate">{label}</span>
                  <span className="font-semibold tabular-nums text-ink">
                    {val} ({pct})
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex gap-2 rounded-lg bg-warning-bg px-3 py-2 text-[11px] text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t('rfqDetail.encryptedBids')}
            </p>
          </article>

          <article className="gov-card p-5">
            <h2 className="font-display text-base font-bold text-ink">{t('rfqDetail.timeline')}</h2>
            <p className="mt-0.5 text-xs text-slate">{t('rfqDetail.timelineDesc')}</p>
            <ol className="rfq-timeline mt-4 space-y-0">
              {vm.timeline.map((step, i) => (
                <li key={step.id} className={`rfq-timeline-step ${step.active ? 'rfq-timeline-active' : ''} ${step.done ? 'rfq-timeline-done' : ''}`}>
                  <div className="rfq-timeline-dot" aria-hidden />
                  {i < vm.timeline.length - 1 && <div className="rfq-timeline-line" aria-hidden />}
                  <div className="pb-5 pl-6">
                    <p className="text-sm font-semibold text-ink">{step.label}</p>
                    <p className="text-xs text-slate">{step.date}</p>
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      {step.actor} · {step.role}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </article>
        </aside>
      </div>

      <article className="gov-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4 sm:px-6">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">{t('rfqDetail.activity')}</h2>
            <p className="mt-0.5 text-sm text-slate">{t('rfqDetail.activityDesc')}</p>
          </div>
          <Link to="/gov/audit" className="text-sm font-semibold text-brand hover:underline">
            {t('rfqDetail.viewAll')} →
          </Link>
        </div>
        <ActivityFeedTable items={vm.activity} />
        <div className="border-t border-line px-5 py-4 sm:px-6">
          <button type="button" className="gov-btn-accent flex w-full items-center justify-center gap-2 sm:w-auto sm:min-w-[16rem]">
            <Sparkles className="h-4 w-4" />
            {t('rfqDetail.aiSummary')}
          </button>
        </div>
      </article>
    </section>
  );
}
