import { describe, it, expect } from 'vitest';
import { tenderWindow, formatCountdown } from './tenderModel';

describe('tenderWindow', () => {
  it('is open well before close, closing-soon within 48h, closed after', () => {
    const now = new Date('2026-08-01T00:00:00Z').getTime();
    expect(tenderWindow('2026-08-10T00:00:00Z', now)).toBe('open');
    expect(tenderWindow('2026-08-02T00:00:00Z', now)).toBe('closing_soon');
    expect(tenderWindow('2026-07-31T00:00:00Z', now)).toBe('closed');
    expect(tenderWindow(null, now)).toBe('open');
  });
});

describe('formatCountdown', () => {
  // Structured, locale-free result — callers compose the translated string
  // via i18n (see TenderBoardPage's countdownLabel). No hardcoded English here.
  it('returns null when there is no submission close date', () => {
    const now = new Date('2026-08-01T00:00:00Z').getTime();
    expect(formatCountdown(null, now)).toBeNull();
  });

  it('returns closed once the window has passed', () => {
    const now = new Date('2026-08-01T00:00:00Z').getTime();
    expect(formatCountdown('2026-07-31T00:00:00Z', now)).toEqual({ closed: true });
  });

  it('returns days/hours/minutes remaining for a far-out close', () => {
    const now = new Date('2026-08-01T00:00:00Z').getTime();
    expect(formatCountdown('2026-08-04T04:30:00Z', now)).toEqual({
      closed: false,
      days: 3,
      hours: 4,
      minutes: 30,
    });
  });

  it('returns hours/minutes remaining under a day', () => {
    const now = new Date('2026-08-01T00:00:00Z').getTime();
    expect(formatCountdown('2026-08-01T05:12:00Z', now)).toEqual({
      closed: false,
      days: 0,
      hours: 5,
      minutes: 12,
    });
  });

  it('returns minutes-only remaining under an hour', () => {
    const now = new Date('2026-08-01T00:00:00Z').getTime();
    expect(formatCountdown('2026-08-01T00:45:00Z', now)).toEqual({
      closed: false,
      days: 0,
      hours: 0,
      minutes: 45,
    });
  });
});
