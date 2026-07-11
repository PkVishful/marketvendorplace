import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { VendorTierPill } from './HealthPill';
import { useVendorRatings } from './useGov';

function formatPassRate(rate: number) {
  if (rate === 0 && Number.isNaN(rate)) return '—';
  return `${Math.round(rate * 100)}%`;
}

export function VendorRatingsPage() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useVendorRatings();

  if (isPending) return <FeedSkeleton />;

  return (
    <section className="space-y-4">
      <header>
        <h2 className="font-display text-xl font-bold">{t('ratings.title')}</h2>
        <p className="mt-1 text-sm text-ink-2">{t('ratings.subtitle')}</p>
      </header>

      {isError ? (
        <div className="gov-card border-l-4 border-l-danger p-6 text-center">
          <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
          <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
            {t('states.retry')}
          </button>
        </div>
      ) : (data ?? []).length === 0 ? (
        <div className="gov-card p-10 text-center">
          <p className="font-semibold text-ink">{t('ratings.emptyTitle')}</p>
          <p className="mt-2 text-sm text-ink-2">{t('ratings.emptyBody')}</p>
        </div>
      ) : (
        <div className="gov-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-6 py-3 font-semibold">{t('ratings.colLab')}</th>
                  <th className="px-6 py-3 font-semibold">{t('ratings.colTier')}</th>
                  <th className="px-6 py-3 font-semibold">{t('ratings.colPassRate')}</th>
                  <th className="px-6 py-3 font-semibold">{t('ratings.colCompleted')}</th>
                  <th className="px-6 py-3 font-semibold">{t('ratings.colAwards')}</th>
                  <th className="px-6 py-3 font-semibold">{t('ratings.colEscalations')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hair">
                {(data ?? []).map((v) => (
                  <tr key={v.id}>
                    <td className="px-6 py-4">
                      <span className="font-medium text-ink">{v.legalName}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">{v.districtName}</span>
                    </td>
                    <td className="px-6 py-4">
                      <VendorTierPill tier={v.tier}>{t(`ratings.tier.${v.tier}`)}</VendorTierPill>
                    </td>
                    <td className="px-6 py-4 font-mono">
                      {v.resultCount > 0 ? formatPassRate(v.passRate) : '—'}
                    </td>
                    <td className="px-6 py-4 font-mono">{v.jobsCompleted}</td>
                    <td className="px-6 py-4 font-mono">{v.awardsWon}</td>
                    <td className="px-6 py-4">
                      {v.openEscalations > 0 ? (
                        <span className="font-semibold text-danger">{v.openEscalations}</span>
                      ) : (
                        <span className="text-ink-3">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-hair px-6 py-3 text-xs text-ink-3">{t('ratings.footnote')}</p>
        </div>
      )}
    </section>
  );
}
