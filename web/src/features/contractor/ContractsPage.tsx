import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { useSession } from '@/auth/useSession';
import { useContractorContracts, useBidOnContract } from './useContractor';
import type { ContractSummary } from '@/types/domain';

function formatInr(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
}

function BidBox({ contract }: { contract: ContractSummary }) {
  const { t } = useTranslation();
  const bid = useBidOnContract();
  const [rupees, setRupees] = useState<string>(
    contract.myBidPaise != null ? String(Math.round(contract.myBidPaise / 100)) : '',
  );
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const value = Number(rupees);
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('contractor.bidInvalid'));
      return;
    }
    bid.mutate(
      { contractId: contract.id, amountPaise: Math.round(value * 100) },
      { onError: (e) => setError((e as Error).message) },
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-2/50 p-3">
      {contract.myBidPaise != null && (
        <p className="mb-2 text-xs font-semibold text-success">
          {t('contractor.bidPlaced', { amount: formatInr(contract.myBidPaise) })}
        </p>
      )}
      <label className="gov-label" htmlFor={`bid-${contract.id}`}>
        {t('contractor.bidAmount')}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`bid-${contract.id}`}
          type="number"
          min={1}
          inputMode="numeric"
          value={rupees}
          onChange={(e) => setRupees(e.target.value)}
          className="gov-input w-40"
          placeholder="₹"
        />
        <button type="button" className="gov-btn-primary" onClick={submit} disabled={bid.isPending}>
          {bid.isPending
            ? t('states.saving')
            : contract.myBidPaise != null
              ? t('contractor.reviseBid')
              : t('contractor.submitBid')}
        </button>
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-danger">{error}</p>}
    </div>
  );
}

export function ContractsPage() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const { data: contracts, isPending, isError, error } = useContractorContracts();
  const notApproved = session?.contractorStatus !== 'APPROVED';

  return (
    <div className="py-2">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold text-ink">{t('contractor.contractsTitle')}</h1>
        <p className="mt-1 text-sm text-slate">{t('contractor.contractsSubtitle')}</p>
      </header>

      {notApproved && (
        <div className="gov-card mb-4 border-accent/40 bg-accent/5">
          <p className="text-sm font-semibold text-ink">{t('contractor.notApprovedTitle')}</p>
          <p className="mt-1 text-sm text-slate">{t('contractor.notApprovedBody')}</p>
          <Link to="/contractor/registration" className="gov-btn-primary mt-3 inline-block">
            {t('contractor.goToRegistration')}
          </Link>
        </div>
      )}

      {isPending && <FeedSkeleton />}
      {isError && (
        <div className="gov-card border-danger/40 text-sm text-danger">{(error as Error).message}</div>
      )}
      {contracts && contracts.length === 0 && (
        <div className="gov-card text-sm text-slate">{t('contractor.noContracts')}</div>
      )}

      <div className="grid gap-4">
        {contracts?.map((c) => {
          const open = c.status === 'FLOATED';
          return (
            <article key={c.id} className="gov-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate">{c.code}</p>
                  <h2 className="mt-0.5 font-semibold text-ink">{c.title}</h2>
                  <p className="mt-1 text-xs text-slate">
                    {t('contractor.project')}: {c.projectName}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      open ? 'bg-accent/20 text-accent-ink' : 'bg-success/15 text-success'
                    }`}
                  >
                    {open ? t('contractor.statusOpen') : t('contractor.statusAwarded')}
                  </span>
                  <p className="mt-1 text-sm font-bold text-ink">{formatInr(c.valuePaise)}</p>
                  <p className="text-[10px] text-slate">{t('contractor.estValue')}</p>
                </div>
              </div>

              {open ? (
                <BidBox contract={c} />
              ) : (
                <p className="mt-3 text-xs font-semibold text-success">{t('contractor.awardedToYou')}</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
