import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GovFulfillmentDTO } from '@/types/domain';
import { formatInr } from '@/lib/time';
import { useReleaseGovPayment, useVerifyGovCertificate } from './useGov';

export function GovOrderFulfillment({
  orderId,
  fulfillment,
}: {
  orderId: string;
  fulfillment: GovFulfillmentDTO;
}) {
  const { t } = useTranslation();
  const verify = useVerifyGovCertificate(orderId);
  const release = useReleaseGovPayment(orderId);
  const [message, setMessage] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);
  const [treasuryRef, setTreasuryRef] = useState('PFMS/2026/DEMO-001');
  const [gstInvoice, setGstInvoice] = useState('GST-INV-DEMO');

  async function onVerify() {
    setMessage(null);
    try {
      await verify.mutateAsync({ signerName: 'eMudhra test (dev)' });
      setMessage({ tone: 'good', text: t('fulfillment.verifyOk') });
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: err instanceof Error ? err.message : t('fulfillment.verifyFailed'),
      });
    }
  }

  async function onRelease() {
    setMessage(null);
    try {
      await release.mutateAsync({
        idempotencyKey: `release:${orderId}`,
        treasuryRef,
        gstInvoiceNo: gstInvoice,
      });
      setMessage({ tone: 'good', text: t('fulfillment.releaseOk') });
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: err instanceof Error ? err.message : t('fulfillment.releaseFailed'),
      });
    }
  }

  if (!fulfillment.jobId) {
    return (
      <div className="gov-card p-5 text-sm text-ink-3">{t('fulfillment.noJob')}</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="gov-card overflow-hidden">
        <div className="border-b border-hair px-6 py-4">
          <h2 className="font-display text-lg font-bold">{t('fulfillment.title')}</h2>
          <p className="mt-1 text-sm text-ink-2">{t('fulfillment.subtitle')}</p>
        </div>

        {fulfillment.results.length === 0 ? (
          <p className="p-6 text-sm text-ink-3">{t('fulfillment.noResults')}</p>
        ) : (
          <ul className="divide-y divide-hair">
            {fulfillment.results.map((r) => (
              <li key={r.qrCode} className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 text-sm">
                <div>
                  <span className="font-mono text-xs text-navy">{r.qrCode}</span>
                  <span className="ml-2 text-ink-2">
                    {r.testName} · {r.metric} = {r.metricValue}
                  </span>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                    r.passed ? 'bg-good-soft text-good' : 'bg-danger-soft text-danger'
                  }`}
                >
                  {r.passed ? t('fulfillment.pass') : t('fulfillment.fail')}
                  {r.isProvisional ? ` · ${t('fulfillment.provisional')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="gov-card p-5">
        <p className="gov-label">{t('fulfillment.sitePhoto')}</p>
        <a
          href={`/api/gov/orders/${orderId}/checkin-photo`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block"
        >
          <img
            src={`/api/gov/orders/${orderId}/checkin-photo`}
            alt={t('fulfillment.sitePhoto')}
            className="h-32 w-32 rounded-md object-cover"
            onError={(e) => {
              (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
            }}
          />
        </a>
      </div>

      {fulfillment.escalations.length > 0 && (
        <div className="gov-card border-l-4 border-l-danger p-5">
          <p className="gov-label text-danger">{t('fulfillment.escalations')}</p>
          <ul className="mt-2 space-y-2 text-sm">
            {fulfillment.escalations.map((e) => (
              <li key={e.id}>
                <span className="font-semibold">{e.level}</span> — {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="gov-card p-5">
          <p className="gov-label">{t('fulfillment.certificate')}</p>
          {fulfillment.certificate ? (
            <>
              <p className="mt-1 text-sm font-semibold">{fulfillment.certificate.storagePath}</p>
              <p className="mt-1 text-xs text-ink-3">
                {fulfillment.certificate.signatureVerified
                  ? t('fulfillment.certVerified', { signer: fulfillment.certificate.signerName ?? '' })
                  : t('fulfillment.certPending')}
              </p>
              {fulfillment.canVerifyCertificate && !fulfillment.certificate.signatureVerified && (
                <button
                  type="button"
                  className="gov-btn-secondary mt-3 text-xs"
                  disabled={verify.isPending}
                  onClick={() => void onVerify()}
                >
                  {t('fulfillment.verifyCert')}
                </button>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-3">{t('fulfillment.certMissing')}</p>
          )}
        </div>

        <div className="gov-card p-5">
          <p className="gov-label">{t('fulfillment.payment')}</p>
          {fulfillment.payment ? (
            <>
              <p className="mt-1 font-display text-lg font-bold">
                {formatInr(fulfillment.payment.amountPaise)}
              </p>
              <p className="mt-1 text-xs uppercase tracking-wide text-ink-3">
                {fulfillment.payment.status}
              </p>
              {fulfillment.payment.status === 'RELEASED' && fulfillment.payment.treasuryRef && (
                <p className="mt-2 text-xs text-ink-2">
                  {fulfillment.payment.treasuryRef} · {fulfillment.payment.gstInvoiceNo}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-3">{t('fulfillment.paymentMissing')}</p>
          )}
        </div>
      </div>

      {fulfillment.canReleasePayment &&
        fulfillment.payment?.status === 'HELD' &&
        fulfillment.certificate?.signatureVerified &&
        fulfillment.resultsComplete && (
          <div className="gov-card border-l-4 border-l-navy p-5">
            <p className="text-sm text-ink-2">{t('fulfillment.releaseHint')}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="gov-label">{t('fulfillment.treasuryRef')}</span>
                <input
                  className="mt-1 w-full rounded-md border border-hair px-3 py-2 text-sm"
                  value={treasuryRef}
                  onChange={(e) => setTreasuryRef(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="gov-label">{t('fulfillment.gstInvoice')}</span>
                <input
                  className="mt-1 w-full rounded-md border border-hair px-3 py-2 text-sm"
                  value={gstInvoice}
                  onChange={(e) => setGstInvoice(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="gov-btn-primary mt-4"
              disabled={release.isPending}
              onClick={() => void onRelease()}
            >
              {release.isPending ? t('states.loading') : t('fulfillment.releasePayment')}
            </button>
          </div>
        )}

      {message && (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${
            message.tone === 'good'
              ? 'border-good/30 bg-good-soft text-good'
              : 'border-danger/30 bg-danger-soft text-danger'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
