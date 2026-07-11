import type { ReactNode } from 'react';
import type { Tone } from '@/features/notifications/eventMeta';

const TONE_ICON: Record<Tone, string> = {
  accent: '●',
  good: '✓',
  warn: '!',
  danger: '✕',
  neutral: '○',
};

const TONE_CLASS: Record<Tone, string> = {
  accent: 'bg-brand-tint text-brand',
  good: 'bg-success-bg text-success',
  warn: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  neutral: 'bg-surface-2 text-slate',
};

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex min-h-[24px] items-center gap-1 rounded-lg px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${TONE_CLASS[tone]}`}
    >
      <span aria-hidden="true">{TONE_ICON[tone]}</span>
      {children}
    </span>
  );
}
