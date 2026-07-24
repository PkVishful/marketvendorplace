import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/time';
import { useIssueTenderCorrigendum } from './useGovTender';
import type { GovTenderView } from '@/types/domain';

function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function CorrigendumDialog({
  contractId,
  notice,
  corrigenda,
  onClose,
}: {
  contractId: string;
  notice: NonNullable<GovTenderView['notice']>;
  corrigenda: GovTenderView['corrigenda'];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const issueCorrigendum = useIssueTenderCorrigendum(contractId);
  const [summary, setSummary] = useState('');
  const [submissionCloseAt, setSubmissionCloseAt] = useState('');
  const [technicalOpeningAt, setTechnicalOpeningAt] = useState('');
  const [scopeSummary, setScopeSummary] = useState(notice.scopeSummary);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (!summary.trim()) {
      setError(t('tender.corrigendum.summaryRequired'));
      return;
    }
    const changes: Record<string, unknown> = {};
    const newClose = fromLocalInput(submissionCloseAt);
    const newOpening = fromLocalInput(technicalOpeningAt);
    if (newClose) changes.submissionCloseAt = newClose;
    if (newOpening) changes.technicalOpeningAt = newOpening;
    if (scopeSummary.trim() && scopeSummary.trim() !== notice.scopeSummary) changes.scopeSummary = scopeSummary.trim();
    try {
      await issueCorrigendum.mutateAsync({ summary: summary.trim(), changes });
      onClose();
    } catch (e) {
      setError((e as Error).message || t('tender.corrigendum.submitFailed'));
    }
  }

  return (
    <div className="gov-card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold text-ink">{t('tender.corrigendum.title')}</h2>
        <button type="button" className="gov-btn-secondary text-xs" onClick={onClose}>
          {t('tender.corrigendum.cancel')}
        </button>
      </div>

      {error && <p className="text-sm font-semibold text-danger">{error}</p>}

      <label className="block">
        <span className="gov-label">{t('tender.corrigendum.summary')}</span>
        <textarea className="gov-input" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="gov-label">{t('tender.notice.submissionClose')}</span>
          <input
            type="datetime-local"
            className="gov-input"
            value={submissionCloseAt}
            onChange={(e) => setSubmissionCloseAt(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="gov-label">{t('tender.notice.technicalOpening')}</span>
          <input
            type="datetime-local"
            className="gov-input"
            value={technicalOpeningAt}
            onChange={(e) => setTechnicalOpeningAt(e.target.value)}
          />
        </label>
      </div>

      <label className="block">
        <span className="gov-label">{t('tender.notice.scopeSummary')}</span>
        <textarea className="gov-input" rows={2} value={scopeSummary} onChange={(e) => setScopeSummary(e.target.value)} />
      </label>

      <button type="button" className="gov-btn-primary" onClick={() => void onSubmit()} disabled={issueCorrigendum.isPending}>
        {issueCorrigendum.isPending ? t('tender.corrigendum.submitting') : t('tender.corrigendum.submit')}
      </button>

      <div className="border-t border-line pt-3">
        <p className="gov-label">{t('tender.corrigendum.history')}</p>
        {corrigenda.length === 0 ? (
          <p className="mt-2 text-sm text-slate">{t('tender.corrigendum.empty')}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {corrigenda.map((c) => (
              <li key={c.corrigendumNo}>
                {t('tender.corrigendum.entry', { no: c.corrigendumNo, date: formatDate(c.issuedAt) })} — {c.summary}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
