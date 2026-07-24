import { useTranslation } from 'react-i18next';
import { useFinanceVendors } from './useOversight';
import { formatPaise } from './financeModel';
import { financeExportUrl } from './oversightApi';

export function VendorEarningsLens() {
  const { t } = useTranslation();
  const { data: vendors = [] } = useFinanceVendors();

  return (
    <div className="gov-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h3 className="font-display text-base font-bold text-ink">{t('oversight.vendorsTitle')}</h3>
        <a className="gov-btn-secondary text-xs" href={financeExportUrl('vendors')} download>
          {t('oversight.exportCsv')}
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
            <tr>
              <th className="px-6 py-3">{t('oversight.colVendorName')}</th>
              <th className="px-6 py-3">{t('oversight.colVendorAwarded')}</th>
              <th className="px-6 py-3">{t('oversight.colVendorPaid')}</th>
              <th className="px-6 py-3">{t('oversight.colVendorPending')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hair">
            {vendors.map((v) => (
              <tr key={v.vendorId} className="hover:bg-surface-2">
                <td className="px-6 py-3 font-medium text-ink">{v.vendorName}</td>
                <td className="px-6 py-3 tabular-nums">{formatPaise(v.awardedPaise)}</td>
                <td className="px-6 py-3 tabular-nums">{formatPaise(v.paidPaise)}</td>
                <td className="px-6 py-3 tabular-nums">{formatPaise(v.pendingPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
