// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computeSavings, isBiddingClosed, toCsv } from './oversight-finance.mjs';

describe('computeSavings', () => {
  it('sums only rows with both estimate and award; ignores nulls (not zeroed)', () => {
    const r = computeSavings([
      { estimatePaise: 100, awardPaise: 80 },
      { estimatePaise: null, awardPaise: 50 }, // excluded
      { estimatePaise: 200, awardPaise: null }, // excluded
      { estimatePaise: 300, awardPaise: 250 },
    ]);
    expect(r).toEqual({ estimatedPaise: 400, awardedPaise: 330, savingsPaise: 70 });
  });
  it('is zero savings, not NaN, when no row has both', () => {
    expect(computeSavings([{ estimatePaise: null, awardPaise: 10 }]))
      .toEqual({ estimatedPaise: 0, awardedPaise: 0, savingsPaise: 0 });
  });
});

describe('isBiddingClosed', () => {
  it('is false while sealed', () => {
    expect(isBiddingClosed('FLOATED')).toBe(false);
    expect(isBiddingClosed('DRAFT')).toBe(false);
  });
  it('is true once closed', () => {
    for (const s of ['REVEALING', 'AWARDED', 'FAILED', 'CANCELLED']) {
      expect(isBiddingClosed(s)).toBe(true);
    }
  });
});

describe('toCsv', () => {
  it('quotes fields containing comma, quote, or newline and doubles quotes', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'he said "hi"'], [1, null]]);
    expect(csv).toBe('a,b\r\n"x,y","he said ""hi"""\r\n1,\r\n');
  });
});
