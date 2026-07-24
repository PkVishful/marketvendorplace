import { describe, it, expect } from 'vitest';
import { tenderWindow } from './tenderModel';

describe('tenderWindow', () => {
  it('is open well before close, closing-soon within 48h, closed after', () => {
    const now = new Date('2026-08-01T00:00:00Z').getTime();
    expect(tenderWindow('2026-08-10T00:00:00Z', now)).toBe('open');
    expect(tenderWindow('2026-08-02T00:00:00Z', now)).toBe('closing_soon');
    expect(tenderWindow('2026-07-31T00:00:00Z', now)).toBe('closed');
    expect(tenderWindow(null, now)).toBe('open');
  });
});
