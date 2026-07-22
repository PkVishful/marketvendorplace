// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { scoreFromHealthCounts } from './bff.mjs';

describe('scoreFromHealthCounts', () => {
  it('weights amber at half and rounds', () => {
    expect(scoreFromHealthCounts({ green: 3, amber: 1, red: 1, neutral: 9 })).toBe(70); // (3+0.5)/5=0.7
  });
  it('is null when there is no completed/failed signal', () => {
    expect(scoreFromHealthCounts({ green: 0, amber: 0, red: 0, neutral: 4 })).toBeNull();
  });
  it('is 100 when all green', () => {
    expect(scoreFromHealthCounts({ green: 2, amber: 0, red: 0, neutral: 0 })).toBe(100);
  });
});
