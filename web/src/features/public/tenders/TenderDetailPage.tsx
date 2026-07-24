import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { PortalBody } from '@/components/GovChrome';
import { formatDate, formatDeadline, formatInr } from '@/lib/time';
import { usePublicTender } from './usePublicTenders';

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt className="text-slate">{k}</dt>
      <dd className="font-medium text-ink">{v}</dd>
    </>
  );
}

export function TenderDetailPage() {
  const { t } = useTranslation();
  const { noticeId = '' } = useParams<{ noticeId: string }>();
  const { data, isPending, isError } = usePublicTender(noticeId);

  return (
    <PortalBody>
      <Link to="/tenders" className="text-sm font-semibold text-brand">
        &larr; {t('tender.detail.back')}
      </Link>

      {isPending && (
        <div className="mt-5">
          <FeedSkeleton />
        </div>
      )}

      {!isPending && (isError || !data?.found) && (
        <div className="gov-card mt-5 max-w-xl">
          <p className="font-display text-lg font-bold text-ink">{t('tender.detail.notFoundTitle')}</p>
          <p className="mt-2 text-sm text-slate">{t('tender.detail.notFoundBody')}</p>
        </div>
      )}

      {!isPending && !isError && data?.found && (
        <div className="mt-5 max-w-3xl space-y-5">
          <header>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate">
              {data.contractCode} · {data.noticeNo}
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold text-ink">{data.title}</h1>
          </header>

          <div className="gov-card">
            <h2 className="font-semibold text-ink">{t('tender.detail.scope')}</h2>
            <p className="mt-2 text-sm text-slate">{data.scopeSummary}</p>
          </div>

          <div className="gov-card">
            <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
              <Row k={t('tender.detail.estValue')} v={formatInr(data.estimatedValuePaise)} />
              <Row k={t('tender.detail.emd')} v={formatInr(data.emdAmountPaise)} />
              <Row k={t('tender.detail.completionPeriod')} v={data.completionPeriodDays} />
              {data.publishAt && <Row k={t('tender.notice.publishAt')} v={formatDate(data.publishAt)} />}
              {data.queryDeadlineAt && (
                <Row k={t('tender.detail.queryDeadline')} v={formatDeadline(data.queryDeadlineAt)} />
              )}
              {data.submissionCloseAt && (
                <Row k={t('tender.detail.submissionClose')} v={formatDeadline(data.submissionCloseAt)} />
              )}
              {data.technicalOpeningAt && (
                <Row k={t('tender.detail.technicalOpening')} v={formatDeadline(data.technicalOpeningAt)} />
              )}
              {data.financialOpeningAt && (
                <Row k={t('tender.detail.financialOpening')} v={formatDeadline(data.financialOpeningAt)} />
              )}
            </dl>
          </div>

          <div className="gov-card">
            <h2 className="font-semibold text-ink">{t('tender.detail.criteria')}</h2>
            {data.criteria.length === 0 ? (
              <p className="mt-2 text-sm text-slate">&mdash;</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.criteria.map((c) => (
                  <li key={c.seq} className="rounded-xl border border-line p-3">
                    <p className="text-sm font-semibold text-ink">{c.label}</p>
                    <p className="mt-1 text-xs text-slate">{c.description}</p>
                    <span className="mt-2 inline-block rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate">
                      {c.kind}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="gov-card">
            <h2 className="font-semibold text-ink">{t('tender.detail.corrigenda')}</h2>
            {data.corrigenda.length === 0 ? (
              <p className="mt-2 text-sm text-slate">{t('tender.detail.noCorrigenda')}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.corrigenda.map((c) => (
                  <li key={c.corrigendumNo} className="border-b border-line pb-2 last:border-b-0">
                    <p className="text-sm font-semibold text-ink">
                      {t('tender.corrigendum.entry', { no: c.corrigendumNo, date: formatDate(c.issuedAt) })}
                    </p>
                    <p className="mt-1 text-xs text-slate">{c.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </PortalBody>
  );
}
