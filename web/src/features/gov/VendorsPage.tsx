import { useState } from 'react';

import { useTranslation } from 'react-i18next';

import { FeedSkeleton } from '@/components/Skeleton';

import { StatusPill } from '@/components/StatusPill';

import { KycDocumentPreview } from '@/features/kyc/KycDocumentPreview';

import { formatDate } from '@/lib/time';

import { useGovVendor, useGovVendors, useReviewGovVendor, useReviewGovVendorDocument } from './useGov';



function docLabelKey(docType: string) {

  return `kyc.doc.${docType}`;

}



export function VendorsPage() {

  const { t } = useTranslation();

  const { data: vendors, isPending, isError, refetch } = useGovVendors('SUBMITTED');

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: detail } = useGovVendor(selectedId ?? '');

  const review = useReviewGovVendor();

  const docReview = useReviewGovVendorDocument(selectedId ?? '');

  const [message, setMessage] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null);

  const [rejectDoc, setRejectDoc] = useState<string | null>(null);

  const [rejectReason, setRejectReason] = useState('');



  async function onReview(decision: 'approve' | 'reject') {

    if (!selectedId) return;

    setMessage(null);

    try {

      const row = await review.mutateAsync({ id: selectedId, decision });

      setMessage({

        tone: 'good',

        text: t(decision === 'approve' ? 'govVendors.approvedOk' : 'govVendors.rejectedOk', {

          name: row.legalName,

        }),

      });

      setSelectedId(null);

    } catch (err) {

      setMessage({

        tone: 'danger',

        text: err instanceof Error ? err.message : t('govVendors.reviewFailed'),

      });

    }

  }



  async function onDocReview(docType: string, decision: 'approve' | 'reject') {

    if (!selectedId) return;

    if (decision === 'reject' && !rejectReason.trim()) return;

    setMessage(null);

    try {

      await docReview.mutateAsync({

        docType,

        decision,

        reason: decision === 'reject' ? rejectReason.trim() : undefined,

      });

      setRejectDoc(null);

      setRejectReason('');

      setMessage({ tone: 'good', text: t('govVendors.docReviewOk', { doc: t(docLabelKey(docType)) }) });

    } catch (err) {

      setMessage({

        tone: 'danger',

        text: err instanceof Error ? err.message : t('govVendors.docReviewFailed'),

      });

    }

  }



  if (isPending) return <FeedSkeleton />;



  return (

    <section className="space-y-4">

      <header>

        <h2 className="font-display text-xl font-bold">{t('govVendors.title')}</h2>

        <p className="mt-1 text-sm text-ink-2">{t('govVendors.subtitle')}</p>

      </header>



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



      {isError ? (

        <div className="gov-card border-l-4 border-l-danger p-6 text-center">

          <button type="button" onClick={() => void refetch()} className="gov-btn-secondary">

            {t('states.retry')}

          </button>

        </div>

      ) : (vendors ?? []).length === 0 ? (

        <div className="gov-card p-10 text-center">

          <p className="font-semibold text-ink">{t('govVendors.emptyTitle')}</p>

          <p className="mt-2 text-sm text-ink-2">{t('govVendors.emptyBody')}</p>

        </div>

      ) : (

        <div className="grid gap-4 lg:grid-cols-2">

          <div className="gov-card divide-y divide-hair overflow-hidden">

            {(vendors ?? []).map((v) => (

              <button

                key={v.id}

                type="button"

                onClick={() => {

                  setSelectedId(v.id);

                  setRejectDoc(null);

                  setRejectReason('');

                }}

                className={`flex w-full flex-col gap-1 px-5 py-4 text-left transition hover:bg-surface-2 ${

                  selectedId === v.id ? 'bg-accent-soft/40' : ''

                }`}

              >

                <span className="font-semibold text-ink">{v.legalName}</span>

                <span className="text-xs text-ink-3">

                  {v.districtName} · {v.gstin}

                </span>

              </button>

            ))}

          </div>



          {selectedId && detail && (

            <div className="gov-card space-y-5 p-5">

              <h3 className="font-display text-lg font-bold">{detail.legalName}</h3>

              <dl className="space-y-2 text-sm">

                <div>

                  <dt className="gov-label">{t('govVendors.district')}</dt>

                  <dd>{detail.districtName}</dd>

                </div>

                <div>

                  <dt className="gov-label">{t('govVendors.address')}</dt>

                  <dd>{detail.address}</dd>

                </div>

                <div>

                  <dt className="gov-label">NABL</dt>

                  <dd>

                    {detail.nablNo ?? '—'}

                    {detail.nablValidUntil && ` · ${formatDate(detail.nablValidUntil)}`}

                  </dd>

                </div>

                <div>

                  <dt className="gov-label">{t('govVendors.radius')}</dt>

                  <dd>{detail.serviceRadiusKm} km</dd>

                </div>

              </dl>



              {detail.capabilities.length > 0 && (

                <div>

                  <p className="gov-label">{t('govVendors.capabilities')}</p>

                  <ul className="mt-2 space-y-1 text-xs text-ink-2">

                    {detail.capabilities.map((c) => (

                      <li key={c.testCode}>

                        {c.testName} ({c.testCode})

                        {c.isNablAccredited && ` · ${t('kyc.nablRequired')}`}

                      </li>

                    ))}

                  </ul>

                </div>

              )}



              {detail.documents.length > 0 && (

                <div className="space-y-4">

                  <p className="gov-label">{t('govVendors.documents')}</p>

                  {detail.documents.map((d) => (

                    <div key={d.docType} className="space-y-2 rounded-xl border border-line p-3">

                      <div className="flex flex-wrap items-center justify-between gap-2">

                        <span className="text-sm font-semibold text-ink">{t(docLabelKey(d.docType))}</span>

                        <StatusPill tone={d.status === 'APPROVED' ? 'good' : d.status === 'REJECTED' ? 'danger' : 'warn'}>
                          {d.status}
                        </StatusPill>

                      </div>

                      {d.storagePath && (

                        <KycDocumentPreview

                          vendorId={selectedId}

                          docType={d.docType}

                          mimeType={d.mimeType}

                          label={t(docLabelKey(d.docType))}

                        />

                      )}

                      {d.rejectReason && (

                        <p className="text-xs text-danger">{d.rejectReason}</p>

                      )}

                      {d.status === 'PENDING' && (

                        <div className="flex flex-wrap gap-2">

                          <button

                            type="button"

                            className="gov-btn-primary text-xs"

                            disabled={docReview.isPending}

                            onClick={() => void onDocReview(d.docType, 'approve')}

                          >

                            {t('govVendors.approveDoc')}

                          </button>

                          <button

                            type="button"

                            className="gov-btn-secondary text-xs"

                            disabled={docReview.isPending}

                            onClick={() => setRejectDoc(d.docType)}

                          >

                            {t('govVendors.rejectDoc')}

                          </button>

                        </div>

                      )}

                      {rejectDoc === d.docType && (

                        <div className="space-y-2">

                          <input

                            className="gov-input text-sm"

                            placeholder={t('govVendors.rejectReasonPlaceholder')}

                            value={rejectReason}

                            onChange={(e) => setRejectReason(e.target.value)}

                          />

                          <button

                            type="button"

                            className="gov-btn-secondary text-xs"

                            disabled={!rejectReason.trim() || docReview.isPending}

                            onClick={() => void onDocReview(d.docType, 'reject')}

                          >

                            {t('govVendors.confirmRejectDoc')}

                          </button>

                        </div>

                      )}

                    </div>

                  ))}

                </div>

              )}



              <div className="flex gap-3 border-t border-line pt-4">

                <button

                  type="button"

                  className="gov-btn-primary"

                  disabled={review.isPending}

                  onClick={() => void onReview('approve')}

                >

                  {t('govVendors.approve')}

                </button>

                <button

                  type="button"

                  className="gov-btn-secondary"

                  disabled={review.isPending}

                  onClick={() => void onReview('reject')}

                >

                  {t('govVendors.reject')}

                </button>

              </div>

            </div>

          )}

        </div>

      )}

    </section>

  );

}

