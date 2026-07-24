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

// Structured remaining-time-to-submission-close result. Kept locale-free (no
// hardcoded English) so callers can compose a translated string via i18n —
// see TenderBoardPage's `countdownLabel`.
export type CountdownResult =
  | { closed: true }
  | { closed: false; days: number; hours: number; minutes: number }
  | null; // no submissionCloseAt at all

export function formatCountdown(submissionCloseAt: string | null, nowMs: number): CountdownResult {
  if (!submissionCloseAt) return null;
  const close = new Date(submissionCloseAt).getTime();
  const remainingMs = close - nowMs;
  if (remainingMs <= 0) return { closed: true };

  const totalMinutes = Math.floor(remainingMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  return { closed: false, days, hours, minutes };
}
