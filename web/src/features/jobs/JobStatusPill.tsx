import type { Tone } from '@/features/notifications/eventMeta';
import { StatusPill } from '@/components/StatusPill';

const STATUS_TONE: Record<string, Tone> = {
  ASSIGNED: 'accent',
  CHECKED_IN: 'warn',
  SAMPLES_COLLECTED: 'warn',
  IN_TRANSIT: 'accent',
  COMPLETED: 'good',
  CANCELLED: 'neutral',
};

export function JobStatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return <StatusPill tone={tone}>{status.replace(/_/g, ' ')}</StatusPill>;
}
