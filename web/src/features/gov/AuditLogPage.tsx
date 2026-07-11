import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { formatDeadline } from '@/lib/time';
import { useAuditChain, useAuditLogInfinite } from './useGov';

function payloadPreview(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  if (keys.length === 0) return '—';
  const first = keys.slice(0, 3).map((k) => `${k}: ${String(payload[k])}`);
  return first.join(' · ');
}

export function AuditLogPage() {
  const { t } = useTranslation();
  const { data: chain, isPending: chainPending } = useAuditChain();
  const canRead = chain?.allowed === true;
  const {
    data,
    isPending,
    isError,
    refetch,
    isFetching,
    fetchNextPage,
    hasNextPage,
  } = useAuditLogInfinite(canRead);

  const rows = data?.pages.flat() ?? [];

  if (chainPending || (isPending && rows.length === 0)) return <FeedSkeleton />;

  if (chain && !chain.allowed) {
    return (
      <div className="gov-card p-10 text-center">
        <p className="font-semibold text-ink">{t('audit.noAccessTitle')}</p>
        <p className="mt-2 text-sm text-ink-2">{t('audit.noAccessBody')}</p>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <header>
        <h2 className="font-display text-xl font-bold">{t('audit.title')}</h2>
        <p className="mt-1 text-sm text-ink-2">{t('audit.subtitle')}</p>
      </header>

      {chain?.allowed && (
        <div
          className={`gov-card border-l-4 p-5 ${
            chain.intact ? 'border-l-green' : 'border-l-danger'
          }`}
        >
          <p className="gov-label">{t('audit.chainTitle')}</p>
          <p className={`mt-1 text-sm font-semibold ${chain.intact ? 'text-good' : 'text-danger'}`}>
            {chain.intact ? t('audit.chainIntact') : t('audit.chainBroken', { seq: chain.brokenAtSeq })}
          </p>
          {chain.headSeq != null && chain.headHash && (
            <p className="mt-2 font-mono text-[10px] text-ink-3 break-all">
              #{chain.headSeq} · {chain.headHash.slice(0, 16)}…
            </p>
          )}
        </div>
      )}

      {isError ? (
        <div className="gov-card border-l-4 border-l-danger p-6 text-center">
          <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
          <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
            {t('states.retry')}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="gov-card p-10 text-center">
          <p className="font-semibold text-ink">{t('audit.emptyTitle')}</p>
          <p className="mt-2 text-sm text-ink-2">{t('audit.emptyBody')}</p>
        </div>
      ) : (
        <>
          <div className="gov-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
                  <tr>
                    <th className="px-6 py-3 font-semibold">#</th>
                    <th className="px-6 py-3 font-semibold">{t('audit.colWhen')}</th>
                    <th className="px-6 py-3 font-semibold">{t('audit.colAction')}</th>
                    <th className="px-6 py-3 font-semibold">{t('audit.colActor')}</th>
                    <th className="px-6 py-3 font-semibold">{t('audit.colEntity')}</th>
                    <th className="px-6 py-3 font-semibold">{t('audit.colDetail')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hair">
                  {rows.map((row) => (
                    <tr key={row.seq}>
                      <td className="px-6 py-3 font-mono text-xs text-ink-3">{row.seq}</td>
                      <td className="px-6 py-3 whitespace-nowrap text-ink-2">
                        {formatDeadline(row.occurredAt)}
                      </td>
                      <td className="px-6 py-3 font-mono text-xs font-semibold text-navy">
                        {row.action}
                      </td>
                      <td className="px-6 py-3 text-ink-2">{row.actorName ?? t('audit.system')}</td>
                      <td className="px-6 py-3">
                        <span className="text-xs text-ink-3">{row.entityType}</span>
                        {row.entityId && (
                          <span className="mt-0.5 block font-mono text-[10px] text-ink-3">
                            {row.entityId.slice(0, 8)}
                          </span>
                        )}
                      </td>
                      <td className="max-w-xs px-6 py-3 truncate text-xs text-ink-3">
                        {payloadPreview(row.payload)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {hasNextPage && (
            <button
              type="button"
              className="gov-btn-secondary"
              disabled={isFetching}
              onClick={() => void fetchNextPage()}
            >
              {isFetching ? t('states.loading') : t('audit.loadMore')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
