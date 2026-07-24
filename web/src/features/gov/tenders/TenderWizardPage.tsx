import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { FeedSkeleton } from '@/components/Skeleton';
import { formatDate, formatInr } from '@/lib/time';
import { useGovTender, usePublishTenderNotice } from './useGovTender';
import { SanctionStep } from './SanctionStep';
import { NoticeStep } from './NoticeStep';
import { CorrigendumDialog } from './CorrigendumDialog';

export function TenderWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { contractId } = useParams<{ contractId?: string }>();
  const [contractIdInput, setContractIdInput] = useState('');
  const [showCorrigendum, setShowCorrigendum] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const { data: view, isPending, isError } = useGovTender(contractId ?? '');
  const publish = usePublishTenderNotice(contractId ?? '');

  if (!contractId) {
    return (
      <div className="py-2">
        <header className="mb-5">
          <h1 className="font-display text-2xl font-bold text-ink">{t('tender.wizard.title')}</h1>
          <p className="mt-1 text-sm text-slate">{t('tender.wizard.subtitle')}</p>
        </header>
        <div className="gov-card max-w-xl space-y-3">
          <h2 className="font-semibold text-ink">{t('tender.wizard.pickContract')}</h2>
          <p className="text-sm text-slate">{t('tender.wizard.pickContractHint')}</p>
          <label className="block">
            <span className="gov-label">{t('tender.wizard.contractIdLabel')}</span>
            <input className="gov-input" value={contractIdInput} onChange={(e) => setContractIdInput(e.target.value)} />
          </label>
          <button
            type="button"
            className="gov-btn-primary"
            disabled={!contractIdInput.trim()}
            onClick={() => navigate(`/gov/tenders/${contractIdInput.trim()}`)}
          >
            {t('tender.wizard.openContract')}
          </button>
        </div>
      </div>
    );
  }

  if (isPending) return <FeedSkeleton />;

  if (isError || !view) {
    return (
      <div className="py-2">
        <div className="gov-card border-danger max-w-xl text-sm font-semibold text-danger">{t('tender.wizard.notFound')}</div>
      </div>
    );
  }

  const canPublish = view.sanction != null && view.notice != null && view.notice.status === 'DRAFT';
  const published = view.notice?.status === 'PUBLISHED';

  async function onPublish() {
    setPublishError(null);
    try {
      await publish.mutateAsync();
    } catch (e) {
      setPublishError((e as Error).message || t('tender.publish.publishFailed'));
    }
  }

  return (
    <div className="space-y-5 py-2">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">{t('tender.wizard.title')}</h1>
        <p className="mt-1 text-sm text-slate">{t('tender.wizard.subtitle')}</p>
      </header>

      <div className="gov-card">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate">{view.contract.code}</p>
        <h2 className="mt-0.5 font-semibold text-ink">{view.contract.title}</h2>
        <p className="mt-1 text-sm text-slate">
          {t('tender.contract.value')}: {formatInr(view.contract.valuePaise)} · {t('tender.contract.status')}: {view.contract.status}
        </p>
      </div>

      <SanctionStep contractId={contractId} sanction={view.sanction} />
      <NoticeStep contractId={contractId} notice={view.notice} criteria={view.criteria} />

      <div className="gov-card space-y-3">
        <h2 className="font-semibold text-ink">{t('tender.publish.action')}</h2>
        {!view.sanction && <p className="text-sm font-semibold text-danger">{t('tender.publish.sanctionRequired')}</p>}
        {view.sanction && !view.notice && <p className="text-sm font-semibold text-danger">{t('tender.publish.noticeRequired')}</p>}
        {publishError && <p className="text-sm font-semibold text-danger">{publishError}</p>}
        {published && view.notice?.publishedAt && (
          <p className="text-sm font-semibold text-success">{t('tender.publish.publishedOn', { date: formatDate(view.notice.publishedAt) })}</p>
        )}
        {!published && (
          <button type="button" className="gov-btn-primary" disabled={!canPublish || publish.isPending} onClick={() => void onPublish()}>
            {publish.isPending ? t('tender.publish.publishing') : t('tender.publish.action')}
          </button>
        )}
      </div>

      {published && view.notice && (
        <div className="space-y-3">
          {!showCorrigendum && (
            <button type="button" className="gov-btn-secondary" onClick={() => setShowCorrigendum(true)}>
              {t('tender.corrigendum.action')}
            </button>
          )}
          {showCorrigendum && (
            <CorrigendumDialog
              contractId={contractId}
              notice={view.notice}
              corrigenda={view.corrigenda}
              onClose={() => setShowCorrigendum(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
