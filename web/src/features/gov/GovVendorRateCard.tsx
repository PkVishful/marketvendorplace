import { useTranslation } from 'react-i18next';
import { formatPaise } from '@/features/pricing/api';
import { useGovVendorPricing } from '@/features/pricing/usePricing';

/**
 * Read-only rate card on the gov vendor detail. Officers see the CURRENT
 * effective price per capability (via the security-definer helpers the bid
 * gate uses) — never the window history, and there is no edit path.
 */
export function GovVendorRateCard({ vendorId }: { vendorId: string }) {
  const { t } = useTranslation();
  const { data: rows, isPending, isError, refetch } = useGovVendorPricing(vendorId);

  if (isPending) return <p className="text-sm text-ink-2">…</p>;

  if (isError) {
    return (
      <div className="rounded-xl border border-danger/30 p-3 text-sm">
        <p className="text-ink-2">{t('govVendors.rateCardFailed')}</p>
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-2 text-xs">
          {t('states.retry')}
        </button>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return <p className="text-sm text-ink-2">{t('govVendors.rateCardEmpty')}</p>;
  }

  return (
    <div>
      <p className="text-xs text-ink-3">{t('govVendors.rateCardNote')}</p>
      <ul className="mt-2 divide-y divide-hair text-sm">
        {rows.map((r) => (
          <li key={r.testId} className="flex items-baseline justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="text-ink">{r.testName}</span>{' '}
              <span className="font-mono text-xs text-ink-3">{r.testCode}</span>
              {r.requiresNabl && (
                <span className="ml-2 rounded-full border border-navy/30 bg-surface-2 px-2 py-0.5 text-xs font-semibold text-navy">
                  NABL
                </span>
              )}
            </span>
            {r.currentPricePaise != null ? (
              <span className="font-semibold tabular-nums text-ink">{formatPaise(r.currentPricePaise)}</span>
            ) : (
              <span className="rounded-full border border-warning/40 bg-warning-bg px-2 py-0.5 text-xs font-semibold text-ink">
                {t('govVendors.rateCardUnpriced')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
