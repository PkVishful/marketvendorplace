import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { PageHero, PortalBody } from '@/components/GovChrome';
import { StatusPill } from '@/components/StatusPill';
import { formatInr } from '@/lib/time';
import { usePublicTenders } from './usePublicTenders';
import { formatCountdown, tenderWindow, type TenderWindow } from './tenderModel';

const WINDOW_TONE: Record<TenderWindow, 'good' | 'warn' | 'neutral'> = {
  open: 'good',
  closing_soon: 'warn',
  closed: 'neutral',
};

// Composes the translated countdown string from formatCountdown's structured,
// locale-free result — keeps formatCountdown itself pure/i18n-free.
function countdownLabel(t: TFunction, submissionCloseAt: string | null, nowMs: number): string {
  const countdown = formatCountdown(submissionCloseAt, nowMs);
  if (countdown === null) return '';
  if (countdown.closed) return t('tender.countdown.closed');
  if (countdown.days > 0) return t('tender.countdown.daysHours', { days: countdown.days, hours: countdown.hours });
  if (countdown.hours > 0) return t('tender.countdown.hoursMinutes', { hours: countdown.hours, minutes: countdown.minutes });
  return t('tender.countdown.minutes', { minutes: countdown.minutes });
}

export function TenderBoardPage() {
  const { t } = useTranslation();
  const { data: tenders, isPending, isError } = usePublicTenders();
  const nowMs = Date.now();

  return (
    <>
      <PageHero title={t('tender.board.title')} description={t('tender.board.subtitle')} />
      <PortalBody>
        {isPending && <FeedSkeleton />}

        {isError && (
          <div className="gov-card text-sm font-semibold text-danger">{t('states.errorBody')}</div>
        )}

        {tenders && tenders.length === 0 && (
          <div className="gov-card text-sm">
            <p className="font-semibold text-ink">{t('tender.board.emptyTitle')}</p>
            <p className="mt-1 text-slate">{t('tender.board.emptyBody')}</p>
          </div>
        )}

        {tenders && tenders.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tenders.map((row) => {
              const win = tenderWindow(row.submissionCloseAt, nowMs);
              return (
                <Link
                  key={row.noticeId}
                  to={`/tenders/${row.noticeId}`}
                  className="gov-card block transition hover:shadow-header"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-[11px] font-bold uppercase tracking-wide text-slate">
                      {row.contractCode} · {row.noticeNo}
                    </p>
                    <StatusPill tone={WINDOW_TONE[win]}>{t(`tender.window.${win}`)}</StatusPill>
                  </div>
                  <h2 className="mt-1.5 font-semibold text-ink">{row.title}</h2>
                  <p className="mt-1 text-xs text-slate">{row.scopeSummary}</p>

                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-slate">{t('tender.board.estValue')}</dt>
                    <dd className="text-right font-semibold text-ink">{formatInr(row.estimatedValuePaise)}</dd>
                    <dt className="text-slate">{t('tender.board.emd')}</dt>
                    <dd className="text-right font-semibold text-ink">{formatInr(row.emdAmountPaise)}</dd>
                  </dl>

                  <p className="mt-3 text-xs font-semibold text-brand">
                    {t('tender.board.closes')}: {countdownLabel(t, row.submissionCloseAt, nowMs)}
                  </p>

                  <span className="mt-3 inline-block text-xs font-semibold text-brand">
                    {t('tender.board.viewDetail')} &rarr;
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </PortalBody>
    </>
  );
}
