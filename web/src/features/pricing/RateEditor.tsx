import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VendorRateRow } from '@/types/domain';
import { formatDate } from '@/lib/time';
import { dayBefore, formatPaise, rupeesToPaiseExact, todayIsoDate } from './api';
import { useSetPrice } from './usePricing';

/**
 * Bottom sheet on mobile, centered card on larger screens. Money never touches
 * a float: the rupee string is parsed digit-wise into integer paise.
 */
export function RateEditor({ row, onClose }: { row: VendorRateRow; onClose: () => void }) {
  const { t } = useTranslation();
  const setPrice = useSetPrice(row.testId);
  const [amount, setAmount] = useState(
    row.currentPricePaise != null ? (row.currentPricePaise / 100).toFixed(2) : '',
  );
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const today = todayIsoDate();
  const paise = rupeesToPaiseExact(amount);
  const startsLater = effectiveFrom !== '' && effectiveFrom > today;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (paise == null) {
      setError(t('pricing.invalidAmount'));
      return;
    }
    setPrice.mutate(
      { pricePaise: paise, ...(effectiveFrom ? { effectiveFrom } : {}) },
      {
        onSuccess: onClose,
        // The 409 body names the conflicting window — surface it verbatim.
        onError: (err) => setError(err instanceof Error ? err.message : t('pricing.saveFailed')),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <button
        type="button"
        aria-label={t('pricing.cancel')}
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <form
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rate-editor-title"
        className="relative w-full rounded-t-2xl bg-surface p-5 shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        <h3 id="rate-editor-title" className="font-display text-lg font-bold text-ink">
          {t('pricing.editorTitle', { test: row.testName })}
        </h3>

        <label className="mt-4 block">
          <span className="gov-label">{t('pricing.rupeeLabel')}</span>
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            className="gov-input mt-1 tabular-nums"
            placeholder="1250.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={setPrice.isPending}
          />
        </label>

        <label className="mt-3 block">
          <span className="gov-label">{t('pricing.effectiveLabel')}</span>
          <input
            type="date"
            className="gov-input mt-1"
            min={today}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            disabled={setPrice.isPending}
          />
          <span className="mt-1 block text-xs text-ink-3">{t('pricing.effectiveHelp')}</span>
        </label>

        {paise != null && (
          <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">
            {t('pricing.preview', {
              price: formatPaise(paise),
              date: formatDate(effectiveFrom || today),
            })}
            {startsLater && row.currentPricePaise != null && (
              <>
                {' '}
                {t('pricing.previewCurrent', {
                  price: formatPaise(row.currentPricePaise),
                  date: formatDate(dayBefore(effectiveFrom)),
                })}
              </>
            )}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={onClose} disabled={setPrice.isPending} className="gov-btn-secondary flex-1">
            {t('pricing.cancel')}
          </button>
          <button type="submit" disabled={setPrice.isPending} className="gov-btn-primary flex-1">
            {setPrice.isPending ? t('pricing.saving') : t('pricing.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
