import type { EventType } from '@/types/domain';

export type Tone = 'accent' | 'good' | 'warn' | 'danger' | 'neutral';

// Presentation only — semantic tone and glyph per event type. The message text
// lives in i18n (event.<TYPE>.title / .desc, pill.<TYPE>).
interface EventMeta {
  tone: Tone;
  glyph: string;
}

export const EVENT_META: Record<EventType, EventMeta> = {
  VENDOR_APPROVED: { tone: 'good', glyph: '◈' },
  VENDOR_REJECTED: { tone: 'danger', glyph: '×' },
  ORDER_FLOATED: { tone: 'accent', glyph: '◆' },
  REVEAL_WINDOW_OPEN: { tone: 'warn', glyph: '!' },
  AWARD_WON: { tone: 'good', glyph: '✓' },
  AWARD_LOST: { tone: 'danger', glyph: '–' },
  ORDER_FAILED: { tone: 'neutral', glyph: '○' },
};
