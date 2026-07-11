import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/auth/useSession';
import {
  computeBidCommitment,
  generateNonce,
  loadBidSecrets,
  rupeesToPaise,
  storeBidSecrets,
} from '@/lib/bidCrypto';
import type { VendorOrderDetail } from '@/types/domain';
import { useCommitBid, useRevealBid } from './useOrders';

function formatInr(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function BidPanel({ order }: { order: VendorOrderDetail }) {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedLocally, setSavedLocally] = useState(() => Boolean(loadBidSecrets(order.id)));

  const commit = useCommitBid(order.id);
  const reveal = useRevealBid(order.id);
  const vendorId = session?.vendorId;

  async function handleCommit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!vendorId) {
      setError(t('bid.noVendor'));
      return;
    }
    const rupees = Number(price);
    if (!rupees || rupees <= 0) {
      setError(t('bid.invalidPrice'));
      return;
    }
    const pricePaise = rupeesToPaise(rupees);
    const nonce = generateNonce();
    try {
      const commitment = await computeBidCommitment(order.id, vendorId, pricePaise, nonce);
      storeBidSecrets(order.id, pricePaise, nonce);
      setSavedLocally(true);
      await commit.mutateAsync(commitment);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bid.commitFailed'));
    }
  }

  async function handleReveal() {
    setError(null);
    const secrets = loadBidSecrets(order.id);
    if (!secrets) {
      setError(t('bid.secretsMissing'));
      return;
    }
    try {
      await reveal.mutateAsync(secrets);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bid.revealFailed'));
    }
  }

  if (order.myBid?.status === 'REVEALED') {
    return (
      <div className="gov-card border-l-4 border-l-green p-5">
        <p className="gov-label text-green">{t('bid.revealedTitle')}</p>
        <p className="mt-2 font-display text-2xl font-bold text-ink">
          {order.myBid.revealedPricePaise != null
            ? formatInr(order.myBid.revealedPricePaise)
            : '—'}
        </p>
        <p className="mt-1 text-sm text-ink-2">{t('bid.revealedBody')}</p>
      </div>
    );
  }

  if (order.myBid?.status === 'COMMITTED') {
    return (
      <div className="gov-card border-l-4 border-l-gold p-5">
        <p className="gov-label text-gold">{t('bid.committedTitle')}</p>
        <p className="mt-2 text-sm text-ink-2">{t('bid.committedBody')}</p>
        {savedLocally ? (
          <p className="mt-2 text-xs text-good">{t('bid.secretsSaved')}</p>
        ) : (
          <p className="mt-2 text-xs text-warn">{t('bid.secretsLost')}</p>
        )}
        {order.status === 'REVEALING' && (
          <button
            type="button"
            onClick={() => void handleReveal()}
            disabled={reveal.isPending || !savedLocally}
            className="gov-btn-primary mt-4"
          >
            {reveal.isPending ? t('bid.revealing') : t('bid.revealAction')}
          </button>
        )}
        {order.status === 'FLOATED' && (
          <p className="mt-3 text-xs text-ink-3">{t('bid.waitForClose')}</p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  if (order.status !== 'FLOATED') return null;

  return (
    <div className="gov-card border-l-4 border-l-navy p-5">
      <p className="gov-label">{t('bid.sealedTitle')}</p>
      <p className="mt-1 text-sm text-ink-2">{t('bid.sealedBody')}</p>
      <form onSubmit={(e) => void handleCommit(e)} className="mt-4 space-y-3">
        <div>
          <label htmlFor="bid-price" className="gov-label">
            {t('bid.priceLabel')}
          </label>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3">
              ₹
            </span>
            <input
              id="bid-price"
              type="number"
              min="1"
              step="1"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="2500"
              className="gov-input pl-7"
            />
          </div>
          <p className="mt-1 text-xs text-ink-3">{t('bid.priceHint')}</p>
        </div>
        <button type="submit" disabled={commit.isPending} className="gov-btn-primary w-full sm:w-auto">
          {commit.isPending ? t('bid.committing') : t('bid.commitAction')}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}
