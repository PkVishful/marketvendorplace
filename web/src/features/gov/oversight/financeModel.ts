import { formatInr } from '@/lib/time';

// Money for this screen is always paise; formatInr expects paise already.
export function formatPaise(paise: number | null | undefined): string {
  if (paise == null) return '—';
  return formatInr(paise);
}
