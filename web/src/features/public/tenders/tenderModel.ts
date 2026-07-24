// Pure view-model helpers for tender notices — no fetch, no React, so unit
// tests never need a server or a query client.

export type TenderWindow = 'open' | 'closing_soon' | 'closed';

export function tenderWindow(submissionCloseAt: string | null, nowMs: number): TenderWindow {
  if (!submissionCloseAt) return 'open';
  const close = new Date(submissionCloseAt).getTime();
  if (nowMs >= close) return 'closed';
  if (close - nowMs <= 48 * 3600 * 1000) return 'closing_soon';
  return 'open';
}

// Renders the remaining time to submission close as a short human string, e.g.
// "3d 4h left", "5h 12m left", or "closed" once the window has passed.
export function formatCountdown(submissionCloseAt: string | null, nowMs: number): string {
  if (!submissionCloseAt) return '';
  const close = new Date(submissionCloseAt).getTime();
  const remainingMs = close - nowMs;
  if (remainingMs <= 0) return 'closed';

  const totalMinutes = Math.floor(remainingMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}
