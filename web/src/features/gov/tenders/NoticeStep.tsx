import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSaveTenderNotice } from './useGovTender';
import type { TenderNoticeCriterionInput } from './api';
import type { GovTenderView, TenderEligibilityCriterion } from '@/types/domain';

interface NoticeForm {
  noticeNo: string;
  scopeSummary: string;
  estimatedValue: string; // rupees, as typed
  completionPeriodDays: string;
  emdAmount: string; // rupees, as typed
  publishAt: string;
  queryDeadlineAt: string;
  submissionCloseAt: string;
  technicalOpeningAt: string;
  financialOpeningAt: string;
}

const EMPTY_FORM: NoticeForm = {
  noticeNo: '',
  scopeSummary: '',
  estimatedValue: '',
  completionPeriodDays: '',
  emdAmount: '',
  publishAt: '',
  queryDeadlineAt: '',
  submissionCloseAt: '',
  technicalOpeningAt: '',
  financialOpeningAt: '',
};

// <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time, with no
// timezone suffix; the server stores/returns full ISO instants.
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function NoticeStep({
  contractId,
  notice,
  criteria,
}: {
  contractId: string;
  notice: GovTenderView['notice'];
  criteria: TenderEligibilityCriterion[];
}) {
  const { t } = useTranslation();
  const saveNotice = useSaveTenderNotice(contractId);
  const [form, setForm] = useState<NoticeForm>(EMPTY_FORM);
  const [rows, setRows] = useState<TenderNoticeCriterionInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  useEffect(() => {
    if (notice) {
      setForm({
        noticeNo: notice.noticeNo,
        scopeSummary: notice.scopeSummary,
        estimatedValue: String(Math.round(notice.estimatedValuePaise / 100)),
        completionPeriodDays: String(notice.completionPeriodDays),
        emdAmount: String(Math.round(notice.emdAmountPaise / 100)),
        publishAt: toLocalInput(notice.publishAt),
        queryDeadlineAt: toLocalInput(notice.queryDeadlineAt),
        submissionCloseAt: toLocalInput(notice.submissionCloseAt),
        technicalOpeningAt: toLocalInput(notice.technicalOpeningAt),
        financialOpeningAt: toLocalInput(notice.financialOpeningAt),
      });
    }
    setRows(criteria.length > 0 ? criteria.map((c) => ({ label: c.label, description: c.description, kind: c.kind })) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?.id]);

  const locked = notice != null && notice.status !== 'DRAFT';

  function set<K extends keyof NoticeForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function addRow() {
    setRows((r) => [...r, { label: '', description: '', kind: 'general' }]);
  }

  function removeRow(index: number) {
    setRows((r) => r.filter((_, i) => i !== index));
  }

  function setRow(index: number, patch: Partial<TenderNoticeCriterionInput>) {
    setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function onSave() {
    setError(null);
    setSavedOk(false);
    const estimatedValuePaise = Math.round(Number(form.estimatedValue) * 100);
    const completionPeriodDays = Number(form.completionPeriodDays);
    const emdAmountPaise = Math.round(Number(form.emdAmount || '0') * 100);
    if (!form.noticeNo.trim() || !form.scopeSummary.trim() || !Number.isFinite(estimatedValuePaise) || estimatedValuePaise <= 0 || !Number.isFinite(completionPeriodDays) || completionPeriodDays <= 0) {
      setError(t('tender.notice.saveFailed'));
      return;
    }
    try {
      await saveNotice.mutateAsync({
        noticeNo: form.noticeNo.trim(),
        scopeSummary: form.scopeSummary.trim(),
        estimatedValuePaise,
        completionPeriodDays,
        emdAmountPaise,
        publishAt: fromLocalInput(form.publishAt),
        queryDeadlineAt: fromLocalInput(form.queryDeadlineAt),
        submissionCloseAt: fromLocalInput(form.submissionCloseAt),
        technicalOpeningAt: fromLocalInput(form.technicalOpeningAt),
        financialOpeningAt: fromLocalInput(form.financialOpeningAt),
        criteria: rows.filter((r) => r.label.trim().length > 0),
      });
      setSavedOk(true);
    } catch (e) {
      setError((e as Error).message || t('tender.notice.saveFailed'));
    }
  }

  return (
    <div className="gov-card space-y-4">
      <div>
        <h2 className="font-semibold text-ink">{t('tender.notice.title')}</h2>
        <p className="mt-1 text-sm text-slate">{t('tender.notice.subtitle')}</p>
        {locked && <p className="mt-2 text-xs font-semibold text-accent-ink">{t('tender.notice.readOnlyHint')}</p>}
      </div>

      {error && <p className="text-sm font-semibold text-danger">{error}</p>}
      {savedOk && !error && <p className="text-sm font-semibold text-success">{t('tender.notice.saveOk')}</p>}

      <fieldset disabled={locked} className="space-y-4 disabled:opacity-60">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="gov-label">{t('tender.notice.noticeNo')}</span>
            <input className="gov-input" value={form.noticeNo} onChange={(e) => set('noticeNo', e.target.value)} />
          </label>
          <label className="block">
            <span className="gov-label">{t('tender.notice.completionPeriod')}</span>
            <input
              type="number"
              min={1}
              className="gov-input"
              value={form.completionPeriodDays}
              onChange={(e) => set('completionPeriodDays', e.target.value)}
            />
          </label>
        </div>

        <label className="block">
          <span className="gov-label">{t('tender.notice.scopeSummary')}</span>
          <textarea className="gov-input" rows={2} value={form.scopeSummary} onChange={(e) => set('scopeSummary', e.target.value)} />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="gov-label">{t('tender.notice.estimatedValue')}</span>
            <input
              type="number"
              min={1}
              className="gov-input"
              value={form.estimatedValue}
              onChange={(e) => set('estimatedValue', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="gov-label">{t('tender.notice.emdAmount')}</span>
            <input
              type="number"
              min={0}
              className="gov-input"
              value={form.emdAmount}
              onChange={(e) => set('emdAmount', e.target.value)}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="gov-label">{t('tender.notice.publishAt')}</span>
            <input type="datetime-local" className="gov-input" value={form.publishAt} onChange={(e) => set('publishAt', e.target.value)} />
          </label>
          <label className="block">
            <span className="gov-label">{t('tender.notice.queryDeadline')}</span>
            <input
              type="datetime-local"
              className="gov-input"
              value={form.queryDeadlineAt}
              onChange={(e) => set('queryDeadlineAt', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="gov-label">{t('tender.notice.submissionClose')}</span>
            <input
              type="datetime-local"
              className="gov-input"
              value={form.submissionCloseAt}
              onChange={(e) => set('submissionCloseAt', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="gov-label">{t('tender.notice.technicalOpening')}</span>
            <input
              type="datetime-local"
              className="gov-input"
              value={form.technicalOpeningAt}
              onChange={(e) => set('technicalOpeningAt', e.target.value)}
            />
          </label>
          <label className="block">
            <span className="gov-label">{t('tender.notice.financialOpening')}</span>
            <input
              type="datetime-local"
              className="gov-input"
              value={form.financialOpeningAt}
              onChange={(e) => set('financialOpeningAt', e.target.value)}
            />
          </label>
        </div>

        <div>
          <p className="gov-label">{t('tender.notice.criteria')}</p>
          <div className="mt-2 space-y-3">
            {rows.map((row, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_2fr_1fr_auto]">
                <input
                  className="gov-input"
                  placeholder={t('tender.notice.criteriaLabel')}
                  value={row.label}
                  onChange={(e) => setRow(i, { label: e.target.value })}
                />
                <input
                  className="gov-input"
                  placeholder={t('tender.notice.criteriaDescription')}
                  value={row.description ?? ''}
                  onChange={(e) => setRow(i, { description: e.target.value })}
                />
                <input
                  className="gov-input"
                  placeholder={t('tender.notice.criteriaKind')}
                  value={row.kind ?? ''}
                  onChange={(e) => setRow(i, { kind: e.target.value })}
                />
                <button type="button" className="gov-btn-secondary text-xs" onClick={() => removeRow(i)}>
                  {t('tender.notice.removeCriterion')}
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="gov-btn-secondary mt-3 text-xs" onClick={addRow}>
            {t('tender.notice.addCriterion')}
          </button>
        </div>

        <button type="button" className="gov-btn-primary" onClick={() => void onSave()} disabled={saveNotice.isPending}>
          {saveNotice.isPending ? t('tender.notice.saving') : t('tender.notice.save')}
        </button>
      </fieldset>
    </div>
  );
}
