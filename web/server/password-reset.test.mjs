// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  generateResetToken, hashResetToken, isExpired, RESET_TOKEN_TTL_MS,
} from './password-reset.mjs';

const PEPPER = 'test-pepper';

describe('generateResetToken', () => {
  it('is long enough not to be guessable', () => {
    // 32 bytes base64url ≈ 43 chars. Anything materially shorter is brute
    // forceable given the token is the entire credential for a reset.
    expect(generateResetToken().length).toBeGreaterThanOrEqual(40);
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateResetToken()));
    expect(seen.size).toBe(500);
  });

  it('is URL safe, so it survives being put in a link', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateResetToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('hashResetToken', () => {
  it('does not return the token itself', () => {
    const token = generateResetToken();
    expect(hashResetToken(token, PEPPER)).not.toBe(token);
  });

  it('is stable for the same token and pepper', () => {
    const token = generateResetToken();
    expect(hashResetToken(token, PEPPER)).toBe(hashResetToken(token, PEPPER));
  });

  it('changes with the pepper, so a stolen database alone cannot mint hashes', () => {
    const token = generateResetToken();
    expect(hashResetToken(token, PEPPER)).not.toBe(hashResetToken(token, 'other-pepper'));
  });

  it('differs for different tokens', () => {
    expect(hashResetToken('a-token', PEPPER)).not.toBe(hashResetToken('b-token', PEPPER));
  });
});

describe('isExpired', () => {
  const now = new Date('2026-07-23T12:00:00Z');

  it('accepts a token still inside its window', () => {
    expect(isExpired(new Date('2026-07-23T12:29:00Z'), now)).toBe(false);
  });

  it('rejects one whose expiry has passed', () => {
    expect(isExpired(new Date('2026-07-23T11:59:59Z'), now)).toBe(true);
  });

  it('treats the exact expiry instant as expired', () => {
    // Fail closed on the boundary rather than allowing one last use.
    expect(isExpired(now, now)).toBe(true);
  });

  it('treats a missing expiry as expired rather than eternal', () => {
    expect(isExpired(null, now)).toBe(true);
    expect(isExpired(undefined, now)).toBe(true);
  });

  it('has a TTL short enough to limit exposure', () => {
    expect(RESET_TOKEN_TTL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(RESET_TOKEN_TTL_MS).toBeGreaterThan(0);
  });
});
