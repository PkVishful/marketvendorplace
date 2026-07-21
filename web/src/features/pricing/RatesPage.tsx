import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FeedSkeleton } from '@/components/Skeleton';
import type { VendorRateRow } from '@/types/domain';
import { formatDate } from '@/lib/time';
import { formatPaise } from './api';
import { PriceHistorySheet } from './PriceHistorySheet';
import { RateEditor } from './RateEditor';
import { useStopOffering, useVendorPricing } from './usePricing';

function RateRowItem({
  row,
  onEdit,
  onHistory,
}: {
  row: VendorRateRow;
  onEdit: () => void;
  onHistory: () => void;
}) {
  const { t } = useTranslation();
  const stop = useStopOffering(row.testId);

  function onStop() {
    if (window.confirm(t('pricing.stopConfirm', { test: row.testName }))) {
      stop.mutate();
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{row.testName}</span>
          {row.requiresNabl && (
            <span className="rounded-full border border-navy/30 bg-surface-2 px-2 py-0.5 text-xs font-semibold text-navy">
              NABL
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs font-mono text-ink-3">{row.testCode}</p>
        {row.isPricedToday && row.currentPricePaise != null ? (
          <p className="mt-1 text-sm text-ink-2">
            <span className="font-semibold tabular-nums text-ink">{formatPaise(row.currentPricePaise)}</span>{' '}
            {row.effectiveFrom && t('pricing.from', { date: formatDate(row.effectiveFrom) })}
          </p>
        ) : (
          <p className="mt-1">
            <span className="inline-block rounded-full border border-warning/40 bg-warning-bg px-2 py-0.5 text-xs font-semibold text-ink">
              {t('pricing.notPriced')}
            </span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onEdit} className="gov-btn-primary !min-h-[40px] px-3 text-sm">
          {row.isPricedToday ? t('pricing.changePrice') : t('pricing.setPrice')}
        </button>
        <button type="button" onClick={onHistory} className="gov-btn-secondary !min-h-[40px] px-3 text-sm">
          {t('pricing.history')}
        </button>
        {row.isPricedToday && (
          <button
            type="button"
            onClick={onStop}
            disabled={stop.isPending}
            className="gov-btn-secondary !min-h-[40px] px-3 text-sm text-danger"
          >
            {t('pricing.stop')}
          </button>
        )}
      </div>
    </li>
  );
}

export function RatesPage() {
  const { t } = useTranslation();
  const { data: rows, isPending, isError, refetch } = useVendorPricing();
  const [editing, setEditing] = useState<VendorRateRow | null>(null);
  const [historyFor, setHistoryFor] = useState<VendorRateRow | null>(null);

  // Unpriced rows are the vendor's to-do list — they stay on top.
  const sorted = useMemo(
    () =>
      [...(rows ?? [])].sort((a, b) =>
        a.isPricedToday === b.isPricedToday
          ? a.testName.localeCompare(b.testName)
          : Number(a.isPricedToday) - Number(b.isPricedToday),
      ),
    [rows],
  );

  if (isPending) return <FeedSkeleton />;

  if (isError) {
    return (
      <section className="gov-card border-l-4 border-l-danger p-4">
        <p className="text-sm text-ink-2">{t('pricing.loadFailed')}</p>
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-3">
          {t('pricing.retry')}
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header>
        <h2 className="font-display text-xl font-bold text-ink">{t('pricing.title')}</h2>
        <p className="text-sm text-ink-2">{t('pricing.subtitle')}</p>
      </header>

      {sorted.length === 0 ? (
        <div className="gov-card p-6 text-center">
          <p className="text-sm text-ink-2">{t('pricing.empty')}</p>
          <Link to="/vendor/onboarding" className="gov-btn-primary mt-4 inline-flex items-center justify-center">
            {t('pricing.emptyCta')}
          </Link>
        </div>
      ) : (
        <ul className="gov-card divide-y divide-hair px-4">
          {sorted.map((row) => (
            <RateRowItem
              key={row.testId}
              row={row}
              onEdit={() => setEditing(row)}
              onHistory={() => setHistoryFor(row)}
            />
          ))}
        </ul>
      )}

      {editing && <RateEditor row={editing} onClose={() => setEditing(null)} />}
      {historyFor && <PriceHistorySheet row={historyFor} onClose={() => setHistoryFor(null)} />}
    </section>
  );
}
