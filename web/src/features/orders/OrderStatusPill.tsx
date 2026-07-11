import type { Tone } from '@/features/notifications/eventMeta';
import { StatusPill } from '@/components/StatusPill';

const STATUS_TONE: Record<string, Tone> = {
  FLOATED: 'accent',
  REVEALING: 'warn',
  AWARDED: 'good',
  DRAFT: 'neutral',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

export function OrderStatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return <StatusPill tone={tone}>{status.replace(/_/g, ' ')}</StatusPill>;
}
