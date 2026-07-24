import { describe, it, expect } from 'vitest';
import { formatPaise } from './financeModel';

describe('formatPaise', () => {
  it('renders paise as INR rupees', () => {
    expect(formatPaise(2500000)).toContain('25,000');
  });
  it('renders a dash for null', () => {
    expect(formatPaise(null)).toBe('—');
  });
});
