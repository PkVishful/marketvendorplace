import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pagination } from '@/components/Pagination';
import { OrderStatusPill } from '@/features/orders/OrderStatusPill';
import { useFinanceOrders } from './useOversight';
import { formatPaise } from './financeModel';
import { financeExportUrl } from './oversightApi';
import { OrderFinanceDetail } from './OrderFinanceDetail';

const PAGE_SIZE = 20;

export function OrderLedger({
  districtFilter, selectedOrder, onSelectOrder,
}: { districtFilter: string; selectedOrder: string | null; onSelectOrder: (id: string) => void }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data } = useFinanceOrders(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const all = data?.rows ?? [];
  const rows = districtFilter ? all.filter((r) => r.orgName.includes(districtFilter)) : all;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start">
      <div className="gov-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-display text-base font-bold text-ink">{t('oversight.ledgerTitle')}</h3>
          <a className="gov-btn-secondary text-xs" href={financeExportUrl('orders')} download>
            {t('oversight.exportCsv')}
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-6 py-3">{t('oversight.colOrder')}</th>
                <th className="px-6 py-3">{t('oversight.colStatus')}</th>
                <th className="px-6 py-3">{t('oversight.colEstimate')}</th>
                <th className="px-6 py-3">{t('oversight.colBids')}</th>
                <th className="px-6 py-3">{t('oversight.colAward')}</th>
                <th className="px-6 py-3">{t('oversight.colPayment')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hair">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`cursor-pointer ${selectedOrder === r.id ? 'bg-brand-tint' : 'hover:bg-surface-2'}`}
                  onClick={() => onSelectOrder(r.id)}
                >
                  <td className="px-6 py-3">
                    <span className="font-medium text-ink">{r.milestone}</span>
                    <span className="mt-0.5 block text-xs text-slate">{r.orgName}</span>
                  </td>
                  <td className="px-6 py-3"><OrderStatusPill status={r.status} /></td>
                  <td className="px-6 py-3 tabular-nums">{formatPaise(r.estimatePaise)}</td>
                  <td className="px-6 py-3 tabular-nums">{r.bidCount}</td>
                  <td className="px-6 py-3 tabular-nums">{r.awardPaise == null ? t('oversight.sealed') : formatPaise(r.awardPaise)}</td>
                  <td className="px-6 py-3 text-xs text-slate">{r.paymentStatus ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4">
          <Pagination total={data?.total ?? 0} page={page} pageSize={PAGE_SIZE} onPage={setPage} />
        </div>
      </div>

      <aside className="lg:sticky lg:top-4">
        {selectedOrder ? (
          <OrderFinanceDetail orderId={selectedOrder} />
        ) : (
          <div className="gov-card p-6 text-center text-sm text-slate">{t('oversight.empty')}</div>
        )}
      </aside>
    </div>
  );
}
