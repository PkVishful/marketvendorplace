import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatInr } from '@/lib/time';
import { useRecordSanction } from './useGovTender';
import type { GovTenderView } from '@/types/domain';

export function SanctionStep({ contractId, sanction }: { contractId: string; sanction: GovTenderView['sanction'] }) {
  const { t } = useTranslation();
  const recordSanction = useRecordSanction(contractId);
  const [amount, setAmount] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError(t('tender.sanction.invalidAmount'));
      return;
    }
    if (!orderNo.trim()) {
      setError(t('tender.sanction.orderNoRequired'));
      return;
    }
    try {
      await recordSanction.mutateAsync({ amountPaise: Math.round(rupees * 100), orderNo: orderNo.trim() });
      setAmount('');
      setOrderNo('');
    } catch (e) {
      setError((e as Error).message || t('tender.sanction.saveFailed'));
    }
  }

  return (
    <div className="gov-card space-y-4">
      <div>
        <h2 className="font-semibold text-ink">{t('tender.sanction.title')}</h2>
        <p className="mt-1 text-sm text-slate">{t('tender.sanction.subtitle')}</p>
      </div>

      {sanction && (
        <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink">
          {t('tender.sanction.existing', {
            amount: formatInr(sanction.amountPaise),
            orderNo: sanction.orderNo,
            date: formatDate(sanction.sanctionedAt),
          })}
        </p>
      )}

      {error && <p className="text-sm font-semibold text-danger">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="gov-label">{t('tender.sanction.amount')}</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            className="gov-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="gov-label">{t('tender.sanction.orderNo')}</span>
          <input className="gov-input" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
        </label>
      </div>

      <button type="button" className="gov-btn-primary" onClick={() => void onSave()} disabled={recordSanction.isPending}>
        {recordSanction.isPending ? t('tender.sanction.saving') : t('tender.sanction.save')}
      </button>
    </div>
  );
}
