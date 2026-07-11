import { useTranslation } from 'react-i18next';
import type { NotificationDTO } from '@/types/domain';
import { isDeadLink, hasLiveOrder } from '@/types/domain';
import type { Tone } from './eventMeta';
import { EVENT_META } from './eventMeta';
import { StatusPill } from '@/components/StatusPill';
import { relativeTime } from '@/lib/time';

// Static (JIT-safe) tone classes for the leading glyph chip.
const GLYPH_TONE: Record<Tone, string> = {
  accent: 'bg-accent-soft text-accent',
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-2 text-ink-3',
};

interface Props {
  notification: NotificationDTO;
  onOpen: (n: NotificationDTO) => void;
}

export function NotificationRow({ notification: n, onOpen }: Props) {
  const { t, i18n } = useTranslation();
  const meta = EVENT_META[n.eventType];
  const dead = isDeadLink(n);
  const live = hasLiveOrder(n);
  const unread = n.readAt === null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        aria-label={t(`event.${n.eventType}.title`)}
        data-testid="notification-row"
        data-unread={unread ? 'true' : 'false'}
        className={`group flex w-full items-start gap-3 rounded-lg border border-hair p-4 text-left transition
          focus:outline-none focus-visible:ring-2 focus-visible:ring-accent
          ${dead ? 'bg-surface-2 opacity-80' : 'gov-card hover:border-navy/20'}
          ${unread ? 'border-l-[3px] border-l-saffron' : ''}`}
      >
        <span
          className={`mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg text-[15px]
            ${dead ? 'bg-surface text-ink-3' : GLYPH_TONE[meta.tone]}`}
          aria-hidden="true"
        >
          {dead ? '⊘' : meta.glyph}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`font-semibold tracking-tight ${dead ? 'text-ink-2' : 'text-ink'}`}>
              {t(`event.${n.eventType}.title`)}
            </span>
            {unread && (
              <span
                className="h-1.5 w-1.5 flex-none rounded-full bg-accent"
                aria-label={t('row.unread')}
              />
            )}
            <span className="ml-auto flex-none font-mono text-[11.5px] text-ink-3">
              {relativeTime(n.createdAt, i18n.language)}
            </span>
          </span>

          {!dead && (
            <span className="mt-1.5 block">
              <StatusPill tone={meta.tone}>{t(`pill.${n.eventType}`)}</StatusPill>
            </span>
          )}

          {dead ? (
            <span className="mt-2 flex items-start gap-2 text-[13.5px] text-ink-3">
              <span aria-hidden="true">⊘</span>
              <span>
                <b className="font-semibold text-ink-2">{t('row.deadLink')}</b>{' '}
                {t('row.deadLinkWhy')}
              </span>
            </span>
          ) : (
            <span className="mt-2 block text-[14px] text-ink-2">
              {t(`event.${n.eventType}.desc`)}
            </span>
          )}

          {live && (
            <span className="mt-2.5 flex items-center gap-2 text-[12px] text-ink-3">
              <span className="uppercase tracking-wide">{t('row.order')}</span>
              <span className="font-mono text-ink-2">{n.orderId?.slice(0, 8)}</span>
              {n.orderMilestone && <span className="truncate">· {n.orderMilestone}</span>}
              <span className="ml-auto font-semibold text-accent group-hover:underline">
                {t('row.viewOrder')} →
              </span>
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
