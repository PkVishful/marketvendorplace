import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { VendorRateRow } from '@/types/domain';
import { formatDate } from '@/lib/time';
import { formatPaise } from './api';
import { usePriceHistory } from './usePricing';

/** Read-only window list — "what did I charge in March". Newest first. */
export function PriceHistorySheet({ row, onClose }: { row: VendorRateRow; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: windows, isPending } = usePriceHistory(row.testId);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <button
        type="button"
        aria-label={t('pricing.close')}
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-history-title"
        className="relative w-full rounded-t-2xl bg-surface p-5 shadow-xl sm:max-w-md sm:rounded-2xl"
      >
        <h3 id="price-history-title" className="font-display text-lg font-bold text-ink">
          {t('pricing.historyTitle', { test: row.testName })}
        </h3>

        {isPending ? (
          <p className="mt-4 text-sm text-ink-2">…</p>
        ) : !windows || windows.length === 0 ? (
          <p className="mt-4 text-sm text-ink-2">{t('pricing.historyEmpty')}</p>
        ) : (
          <ul className="mt-4 divide-y divide-hair">
            {windows.map((w) => (
              <li key={`${w.effectiveFrom}-${w.pricePaise}`} className="flex items-baseline justify-between gap-3 py-2">
                <span className="text-sm text-ink-2">
                  {formatDate(w.effectiveFrom)}
                  {' → '}
                  {w.effectiveTo ? formatDate(w.effectiveTo) : t('pricing.openEnded')}
                </span>
                <span className="text-sm font-semibold tabular-nums text-ink">{formatPaise(w.pricePaise)}</span>
              </li>
            ))}
          </ul>
        )}

        <button type="button" onClick={onClose} className="gov-btn-secondary mt-4 w-full">
          {t('pricing.close')}
        </button>
      </div>
    </div>
  );
}
