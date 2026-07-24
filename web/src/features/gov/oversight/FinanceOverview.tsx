import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { useFinanceSummary, useFinanceDistricts } from './useOversight';
import { formatPaise } from './financeModel';
import { financeExportUrl } from './oversightApi';
import { FlagsPanel } from './FlagsPanel';
import { OrderLedger } from './OrderLedger';
import { VendorEarningsLens } from './VendorEarningsLens';

export function FinanceOverview() {
  const { t } = useTranslation();
  const { data: summary, isPending } = useFinanceSummary();
  const { data: districts = [] } = useFinanceDistricts();
  const [districtFilter, setDistrictFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);

  if (isPending || !summary) return <FeedSkeleton />;

  const kpis: [string, string][] = [
    [t('oversight.kpiFloated'), `${summary.floatedCount} · ${formatPaise(summary.floatedEstimatePaise)}`],
    [t('oversight.kpiBids'), String(summary.bidsReceived)],
    [t('oversight.kpiAwarded'), formatPaise(summary.awardedValuePaise)],
    [t('oversight.kpiSavings'), formatPaise(summary.savingsPaise)],
    [t('oversight.kpiHeld'), formatPaise(summary.paymentsHeldPaise)],
    [t('oversight.kpiReleased'), formatPaise(summary.paymentsReleasedPaise)],
    [t('oversight.kpiFailed'), formatPaise(summary.failedValuePaise)],
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(([label, value]) => (
          <div key={label} className="gov-card p-4">
            <p className="gov-label">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <FlagsPanel onSelectOrder={setSelectedOrder} />

      <div className="gov-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-display text-base font-bold text-ink">{t('oversight.colDistrict')}</h3>
          <a className="gov-btn-secondary text-xs" href={financeExportUrl('districts')} download>
            {t('oversight.exportCsv')}
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-6 py-3">{t('oversight.colDistrict')}</th>
                <th className="px-6 py-3">{t('oversight.colFloated')}</th>
                <th className="px-6 py-3">{t('oversight.colAwarded')}</th>
                <th className="px-6 py-3">{t('oversight.colSavings')}</th>
                <th className="px-6 py-3">{t('oversight.colHeld')}</th>
                <th className="px-6 py-3">{t('oversight.colReleased')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hair">
              {districts.map((d) => (
                <tr
                  key={d.districtId}
                  className={`cursor-pointer ${districtFilter === d.district ? 'bg-brand-tint' : 'hover:bg-surface-2'}`}
                  onClick={() => setDistrictFilter((cur) => (cur === d.district ? '' : d.district))}
                >
                  <td className="px-6 py-3 font-medium text-ink">{d.district}</td>
                  <td className="px-6 py-3 tabular-nums">{d.floatedCount}</td>
                  <td className="px-6 py-3 tabular-nums">{formatPaise(d.awardedValuePaise)}</td>
                  <td className="px-6 py-3 tabular-nums">{formatPaise(d.savingsPaise)}</td>
                  <td className="px-6 py-3 tabular-nums">{formatPaise(d.paymentsHeldPaise)}</td>
                  <td className="px-6 py-3 tabular-nums">{formatPaise(d.paymentsReleasedPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <OrderLedger
        districtFilter={districtFilter}
        selectedOrder={selectedOrder}
        onSelectOrder={setSelectedOrder}
      />

      <VendorEarningsLens />
    </div>
  );
}
