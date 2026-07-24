import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  FileUp,
  Filter,
  Plus,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { StatusPill } from '@/components/StatusPill';
import { Pagination } from '@/components/Pagination';
import { pageWindow } from '@/lib/pagination';
import { KycDocumentPreview } from '@/features/kyc/KycDocumentPreview';
import type { GovVendorDetail, GovVendorSummary } from '@/types/domain';
import { formatDate } from '@/lib/time';
import {
  KYC_REQUIRED_DOC_COUNT,
  categoryLabels,
  contactEmail,
  filterVendors,
  kycScore,
  registryStats,
  uiStatus,
  vendorCode,
  vendorDistricts,
  vendorInitials,
  vendorTypeLabel,
  verifiedDocCount,
  type VendorKycFilter,
} from './vendorKycModel';
import { RegisterVendorPanel, type RegisterVendorFormData } from './RegisterVendorPanel';

function docLabelKey(docType: string) {
  return `kyc.doc.${docType}`;
}

function statusTone(status: ReturnType<typeof uiStatus>) {
  if (status === 'approved') return 'good' as const;
  if (status === 'rejected') return 'danger' as const;
  if (status === 'under_review') return 'accent' as const;
  return 'warn' as const;
}

function KpiCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: ReactNode;
  accent: string;
}) {
  return (
    <article className="rfq-kpi gov-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="rfq-kpi-label">{label}</p>
          <p className="rfq-kpi-value">{value}</p>
          {hint && <p className="rfq-kpi-hint">{hint}</p>}
        </div>
        <span className={`rfq-kpi-icon ${accent}`}>{icon}</span>
      </div>
    </article>
  );
}

function VendorKycDetailPanel({
  detail,
  onClose,
  onApprove,
  onReject,
  onRequestInfo,
  onDocApprove,
  reviewPending,
  docReviewPending,
  rejectDoc,
  rejectReason,
  onRejectDocStart,
  onRejectReasonChange,
  onRejectDocConfirm,
  onRejectDocCancel,
}: {
  detail: GovVendorDetail;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRequestInfo: (note: string) => void;
  onDocApprove: (docType: string) => void;
  reviewPending: boolean;
  docReviewPending: boolean;
  rejectDoc: string | null;
  rejectReason: string;
  onRejectDocStart: (docType: string) => void;
  onRejectReasonChange: (v: string) => void;
  onRejectDocConfirm: (docType: string) => void;
  onRejectDocCancel: () => void;
}) {
  const { t } = useTranslation();
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoNote, setInfoNote] = useState('');
  const score = kycScore(detail);
  const verified = verifiedDocCount(detail);
  const categories = categoryLabels(detail, detail.capabilities);
  const displayStatus = uiStatus(detail);
  const canReview = detail.status === 'SUBMITTED';

  return (
    <article className="gov-card overflow-hidden xl:sticky xl:top-4 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold text-brand">{vendorCode(detail)}</p>
          <h3 className="mt-1 font-display text-lg font-bold text-ink">{detail.legalName}</h3>
          <p className="mt-0.5 text-sm text-slate">
            {vendorTypeLabel(detail)} · {detail.districtName}, Tamil Nadu
          </p>
        </div>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line hover:bg-surface-2"
          aria-label={t('govVendors.clearSelection')}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate">{t('govVendors.kycComplianceScore')}</p>
            <p className="text-xs text-ink-3">
              {t('govVendors.docsVerifiedCount', { verified, total: KYC_REQUIRED_DOC_COUNT })}
            </p>
          </div>
          <span className="font-display text-3xl font-bold tabular-nums text-brand">{score}</span>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div>
          <h4 className="text-sm font-semibold text-ink">{t('govVendors.contactInfo')}</h4>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {[
              [t('govVendors.email'), contactEmail(detail)],
              [t('govVendors.phone'), detail.contactPhone ? `+91 ${detail.contactPhone}` : '—'],
              [t('kyc.gstin'), detail.gstin],
              [t('kyc.pan'), detail.pan ?? '—'],
              [t('govVendors.contactPerson'), detail.contactName ?? '—'],
              [t('govVendors.city'), `${detail.districtName}, TN`],
            ].map(([label, val]) => (
              <div key={String(label)} className="rfq-meta-cell">
                <dt>{label}</dt>
                <dd>{val}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-ink">{t('govVendors.workCategories')}</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {categories.map((c) => (
              <span key={c} className="rfq-chip rfq-chip-neutral">
                {c}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">{t('govVendors.docVerification')}</h4>
            <span className="text-xs text-slate">
              {t('govVendors.docsVerifiedCount', { verified, total: KYC_REQUIRED_DOC_COUNT })}
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {detail.documents.map((doc) => (
              <li
                key={doc.docType}
                className="rounded-xl border border-line bg-surface-2/40 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    {doc.status === 'APPROVED' && (
                      <CheckCircle2 className="h-4 w-4 text-success" strokeWidth={2} />
                    )}
                    {t(docLabelKey(doc.docType))}
                  </span>
                  <span className="text-xs text-slate">
                    {doc.uploadedAt ? formatDate(doc.uploadedAt) : '—'}
                  </span>
                </div>
                {doc.storagePath && (
                  <div className="mt-2">
                    <KycDocumentPreview
                      vendorId={detail.id}
                      docType={doc.docType}
                      mimeType={doc.mimeType}
                      label={t(docLabelKey(doc.docType))}
                    />
                  </div>
                )}
                {doc.status === 'PENDING' && canReview && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="gov-btn-primary text-xs"
                      disabled={docReviewPending}
                      onClick={() => onDocApprove(doc.docType)}
                    >
                      {t('govVendors.approveDoc')}
                    </button>
                    <button
                      type="button"
                      className="gov-btn-secondary text-xs"
                      disabled={docReviewPending}
                      onClick={() => onRejectDocStart(doc.docType)}
                    >
                      {t('govVendors.rejectDoc')}
                    </button>
                  </div>
                )}
                {rejectDoc === doc.docType && (
                  <div className="mt-2 space-y-2">
                    <input
                      className="gov-input text-sm"
                      placeholder={t('govVendors.rejectReasonPlaceholder')}
                      value={rejectReason}
                      onChange={(e) => onRejectReasonChange(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="gov-btn-secondary text-xs"
                        disabled={!rejectReason.trim() || docReviewPending}
                        onClick={() => onRejectDocConfirm(doc.docType)}
                      >
                        {t('govVendors.confirmRejectDoc')}
                      </button>
                      <button type="button" className="text-xs text-slate" onClick={onRejectDocCancel}>
                        {t('govVendors.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {canReview && (
        <div className="border-t border-line px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="gov-btn-primary text-sm" disabled={reviewPending} onClick={onApprove}>
              {t('govVendors.approveKyc')}
            </button>
            <button type="button" className="gov-btn-secondary text-sm" disabled={reviewPending} onClick={onReject}>
              {t('govVendors.reject')}
            </button>
            <button
              type="button"
              className={`gov-btn-secondary text-sm ${infoOpen ? 'border-brand text-brand' : ''}`}
              aria-expanded={infoOpen}
              onClick={() => setInfoOpen((open) => !open)}
            >
              {t('govVendors.requestInfo')}
            </button>
            <button type="button" className="gov-btn-secondary text-sm">
              <Download className="mr-1.5 inline h-4 w-4" />
              {t('govVendors.downloadReport')}
            </button>
          </div>

          {infoOpen && (
            <div className="mt-3 space-y-2 rounded-xl border border-line bg-surface-2/40 p-3">
              <label className="block text-sm font-semibold text-ink" htmlFor="vendor-request-info">
                {t('govVendors.requestInfoTitle')}
              </label>
              <textarea
                id="vendor-request-info"
                className="gov-input text-sm"
                rows={3}
                placeholder={t('govVendors.requestInfoPlaceholder')}
                value={infoNote}
                onChange={(e) => setInfoNote(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="gov-btn-primary text-xs"
                  disabled={!infoNote.trim()}
                  onClick={() => {
                    onRequestInfo(infoNote.trim());
                    setInfoOpen(false);
                    setInfoNote('');
                  }}
                >
                  {t('govVendors.sendRequest')}
                </button>
                <button
                  type="button"
                  className="text-xs text-slate"
                  onClick={() => {
                    setInfoOpen(false);
                    setInfoNote('');
                  }}
                >
                  {t('govVendors.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {!canReview && (
        <div className="border-t border-line px-5 py-4">
          <StatusPill tone={statusTone(displayStatus)}>{t(`govVendors.status.${displayStatus}`)}</StatusPill>
        </div>
      )}
    </article>
  );
}

export function VendorKycView({
  vendors,
  detail,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  message,
  reviewPending,
  docReviewPending,
  onApprove,
  onReject,
  onRequestInfo,
  onDocApprove,
  rejectDoc,
  rejectReason,
  onRejectDocStart,
  onRejectReasonChange,
  onRejectDocConfirm,
  onRejectDocCancel,
  showRegister,
  onOpenRegister,
  onCloseRegister,
  onRegisterSubmit,
  registerPending,
}: {
  vendors: GovVendorSummary[];
  detail: GovVendorDetail | undefined;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  filter: VendorKycFilter;
  onFilterChange: (f: VendorKycFilter) => void;
  message: { tone: 'good' | 'danger'; text: string } | null;
  reviewPending: boolean;
  docReviewPending: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRequestInfo: (note: string) => void;
  onDocApprove: (docType: string) => void;
  rejectDoc: string | null;
  rejectReason: string;
  onRejectDocStart: (docType: string) => void;
  onRejectReasonChange: (v: string) => void;
  onRejectDocConfirm: (docType: string) => void;
  onRejectDocCancel: () => void;
  showRegister: boolean;
  onOpenRegister: () => void;
  onCloseRegister: () => void;
  onRegisterSubmit: (data: RegisterVendorFormData) => void;
  registerPending: boolean;
}) {
  const { t } = useTranslation();
  const stats = useMemo(() => registryStats(vendors), [vendors]);
  const districts = useMemo(() => vendorDistricts(vendors), [vendors]);

  // District filter and paging are local view state over the vendors already
  // loaded — they narrow and slice the list without another fetch.
  const [districtFilter, setDistrictFilter] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const filtered = useMemo(() => {
    const byStatus = filterVendors(vendors, filter);
    return districtFilter ? byStatus.filter((v) => v.districtName === districtFilter) : byStatus;
  }, [vendors, filter, districtFilter]);

  const win = pageWindow({ total: filtered.length, page, pageSize: PAGE_SIZE });
  const visible = filtered.slice((win.page - 1) * PAGE_SIZE, win.page * PAGE_SIZE);

  const tabs: { id: VendorKycFilter; label: string; count: number }[] = [
    { id: 'all', label: t('govVendors.filterAll'), count: stats.total },
    { id: 'pending', label: t('govVendors.filterPending'), count: stats.pending },
    { id: 'under_review', label: t('govVendors.filterUnderReview'), count: stats.underReview },
    { id: 'approved', label: t('govVendors.filterApproved'), count: stats.approved },
    { id: 'rejected', label: t('govVendors.filterRejected'), count: stats.rejected },
  ];

  return (
    <section className="vendor-kyc space-y-6">
      <nav className="rfq-breadcrumb" aria-label="Breadcrumb">
        <Link to="/gov">{t('app.brand')}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link to="/gov">{t('gov.navHome')}</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span aria-current="page">{t('govVendors.nav')}</span>
      </nav>

      <header className="rfq-header gov-card px-5 py-5 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-accent">
          {t('govVendors.registeredOnPortal')}
        </p>
        <h1 className="mt-1 font-display text-xl font-bold text-ink sm:text-2xl">{t('govVendors.pageTitle')}</h1>
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

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label={t('govVendors.kpiTotal')}
          value={stats.total}
          icon={<Building2 className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-brand"
        />
        <KpiCard
          label={t('govVendors.kpiApproved')}
          value={stats.approved}
          icon={<ShieldCheck className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-success"
        />
        <KpiCard
          label={t('govVendors.kpiEligible')}
          value={stats.eligible}
          hint={t('govVendors.kpiEligibleHint')}
          icon={<UserPlus className="h-5 w-5" strokeWidth={2} />}
          accent="rfq-kpi-icon-accent"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start">
      <article className="gov-card min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-base font-bold text-ink">{t('govVendors.registryTitle')}</h2>
            <p className="mt-0.5 text-xs text-slate">
              {t('govVendors.registryHint', { count: stats.total })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="gov-btn-secondary text-xs">
              <Filter className="mr-1 h-3.5 w-3.5" />
              {t('govVendors.filter')}
            </button>
            <button type="button" className="gov-btn-secondary text-xs">
              <Download className="mr-1 h-3.5 w-3.5" />
              {t('govVendors.exportList')}
            </button>
            <button type="button" className="gov-btn-secondary text-xs">
              <FileUp className="mr-1 h-3.5 w-3.5" />
              {t('govVendors.bulkImport')}
            </button>
            <button type="button" className="gov-btn-primary text-xs" onClick={onOpenRegister}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('govVendors.registerVendor')}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  onFilterChange(tab.id);
                  setPage(1);
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  filter === tab.id
                    ? 'bg-brand text-white'
                    : 'bg-surface-2 text-slate hover:bg-surface-3'
                }`}
              >
                {tab.label} · {tab.count}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate">
            <span className="whitespace-nowrap font-semibold">{t('govVendors.filterDistrict')}</span>
            <select
              className="gov-input py-1.5 text-xs"
              value={districtFilter}
              onChange={(e) => {
                setDistrictFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t('govVendors.allDistricts')}</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="rfq-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>{t('govVendors.colVendor')}</th>
                <th>{t('govVendors.colGstin')}</th>
                <th>{t('govVendors.colCategory')}</th>
                <th>{t('govVendors.colSubmitted')}</th>
                <th>{t('govVendors.colKycScore')}</th>
                <th>{t('govVendors.colStatus')}</th>
                <th className="text-right">{t('govVendors.colReview')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((v) => {
                const displayStatus = uiStatus(v);
                const cats = categoryLabels(v);
                const selected = selectedId === v.id;
                return (
                  <tr
                    key={v.id}
                    className={`cursor-pointer ${selected ? 'bg-brand-tint/30' : ''}`}
                    onClick={() => {
                      onCloseRegister();
                      onSelect(selected ? null : v.id);
                    }}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-tint text-xs font-bold text-brand">
                          {vendorInitials(v.legalName)}
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{v.legalName}</p>
                          <p className="text-xs text-slate">
                            {vendorTypeLabel(v)} · {v.districtName}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{v.gstin}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {cats.slice(0, 2).map((c) => (
                          <span key={c} className="rfq-chip rfq-chip-neutral text-[9px]">
                            {c}
                          </span>
                        ))}
                        {cats.length > 2 && (
                          <span className="rfq-chip rfq-chip-neutral text-[9px]">+1</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-slate">{formatDate(v.createdAt)}</td>
                    <td className="font-display font-bold tabular-nums text-brand">{kycScore(v)}</td>
                    <td>
                      <StatusPill tone={statusTone(displayStatus)}>
                        {t(`govVendors.status.${displayStatus}`)}
                      </StatusPill>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="text-xs font-semibold text-brand hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseRegister();
                          onSelect(v.id);
                        }}
                      >
                        {t('govVendors.review')} →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-5 py-3">
          <Pagination
            total={filtered.length}
            page={win.page}
            pageSize={PAGE_SIZE}
            onPage={setPage}
          />
        </div>

        <div className="flex flex-wrap justify-center gap-4 border-t border-line px-5 py-3 text-[11px] text-slate">
          <span>{t('govVendors.legendAwaiting')}</span>
          <span>{t('govVendors.legendPending')}</span>
          <span>{t('govVendors.legendRejected')}</span>
        </div>
      </article>

      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        {showRegister ? (
          <RegisterVendorPanel
            onClose={onCloseRegister}
            onSubmit={onRegisterSubmit}
            pending={registerPending}
          />
        ) : selectedId && detail ? (
          <VendorKycDetailPanel
            key={detail.id}
            detail={detail}
            onClose={() => onSelect(null)}
            onApprove={onApprove}
            onReject={onReject}
            onRequestInfo={onRequestInfo}
            onDocApprove={onDocApprove}
            reviewPending={reviewPending}
            docReviewPending={docReviewPending}
            rejectDoc={rejectDoc}
            rejectReason={rejectReason}
            onRejectDocStart={onRejectDocStart}
            onRejectReasonChange={onRejectReasonChange}
            onRejectDocConfirm={onRejectDocConfirm}
            onRejectDocCancel={onRejectDocCancel}
          />
        ) : (
          <div className="gov-card hidden p-6 text-center lg:block">
            <UserPlus className="mx-auto h-8 w-8 text-ink-3" strokeWidth={1.5} />
            <p className="mt-3 text-sm font-medium text-ink">{t('govVendors.sidePanelHint')}</p>
            <p className="mt-1 text-xs text-slate">{t('govVendors.sidePanelSubhint')}</p>
            <button type="button" className="gov-btn-primary mt-4 text-xs" onClick={onOpenRegister}>
              {t('govVendors.registerVendor')}
            </button>
          </div>
        )}
      </aside>
      </div>

      {filtered.length === 0 && (
        <div className="gov-card p-8 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-ink-3" strokeWidth={1.5} />
          <p className="mt-3 font-semibold text-ink">{t('govVendors.emptyFilterTitle')}</p>
          <p className="mt-1 text-sm text-slate">{t('govVendors.emptyFilterBody')}</p>
        </div>
      )}
    </section>
  );
}
