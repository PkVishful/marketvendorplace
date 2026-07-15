// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadConfig } from './env.mjs';
import {
  generateOtpCode, hashOtp, issueChallenge, verifyChallenge, __resetChallenges,
} from './auth.mjs';

const devCfg = loadConfig({});
const prodCfg = loadConfig({
  EWORKS_ENV: 'production', OTP_PEPPER: 'pepper-'.repeat(4),
  CORS_ORIGIN: 'https://getlegal.anvastech.in', SESSION_SECRET: 's'.repeat(32),
  EWORKS_USE_LOCAL_PG: '1',
});
// Capture the delivered code so the test can verify with the real value.
function captureProvider() {
  const sent = [];
  return { sent, async send(m) { sent.push(m); return { delivered: true }; } };
}

beforeEach(() => __resetChallenges());

describe('otp engine', () => {
  it('generateOtpCode is a 6-digit string', () => {
    expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it('hashOtp never returns the plaintext code', () => {
    const h = hashOtp('123456', 'pep');
    expect(h).not.toContain('123456');
    expect(h).toHaveLength(64);
  });

  it('issue then verify the delivered code succeeds and is single-use', async () => {
    const p = captureProvider();
    await issueChallenge({ phone: '9876543210', userId: 'u1', requiresMfa: false, config: prodCfg, provider: p });
    const code = p.sent[0].code;
    const first = verifyChallenge({ phone: '9876543210', code, config: prodCfg });
    expect(first.ok).toBe(true);
    expect(first.challenge.userId).toBe('u1');
    const second = verifyChallenge({ phone: '9876543210', code, config: prodCfg });
    expect(second.ok).toBe(false); // consumed
  });

  it('rejects a wrong code and enforces the attempt cap', async () => {
    const p = captureProvider();
    await issueChallenge({ phone: '9876543210', userId: 'u1', config: prodCfg, provider: p });
    for (let i = 0; i < prodCfg.otpMaxAttempts; i++) {
      expect(verifyChallenge({ phone: '9876543210', code: '000000', config: prodCfg }).ok).toBe(false);
    }
    // even the correct code fails now — challenge invalidated
    expect(verifyChallenge({ phone: '9876543210', code: p.sent[0].code, config: prodCfg }).ok).toBe(false);
  });

  it('rejects an expired code', async () => {
    vi.useFakeTimers();
    const p = captureProvider();
    await issueChallenge({ phone: '9876543210', userId: 'u1', config: prodCfg, provider: p });
    vi.advanceTimersByTime(prodCfg.otpTtlMs + 1000);
    const r = verifyChallenge({ phone: '9876543210', code: p.sent[0].code, config: prodCfg });
    expect(r).toEqual({ ok: false, reason: 'expired' });
    vi.useRealTimers();
  });

  it('a failed send leaves an existing delivered challenge intact', async () => {
    const p = captureProvider();
    await issueChallenge({ phone: '9876543210', userId: 'u1', config: prodCfg, provider: p });
    const failing = { async send() { throw new Error('provider down'); } };
    await expect(issueChallenge({ phone: '9876543210', userId: 'u1', config: prodCfg, provider: failing }))
      .rejects.toThrow('provider down');
    // the first (actually delivered) code must still verify
    const r = verifyChallenge({ phone: '9876543210', code: p.sent[0].code, config: prodCfg });
    expect(r.ok).toBe(true);
  });

  it('a failed send stores no challenge at all', async () => {
    const failing = { async send() { throw new Error('provider down'); } };
    await expect(issueChallenge({ phone: '9876543210', userId: 'u1', config: prodCfg, provider: failing }))
      .rejects.toThrow('provider down');
    const r = verifyChallenge({ phone: '9876543210', code: '000000', config: prodCfg });
    expect(r).toEqual({ ok: false, reason: 'no_challenge' });
  });

  it('PRODUCTION rejects the fixed dev code', async () => {
    const p = captureProvider();
    await issueChallenge({ phone: '9876543210', userId: 'u1', config: prodCfg, provider: p });
    expect(verifyChallenge({ phone: '9876543210', code: '123456', config: prodCfg }).ok).toBe(false);
  });

  it('DEV accepts the fixed dev code (local flow unchanged)', async () => {
    const p = captureProvider();
    await issueChallenge({ phone: '9876543210', userId: 'u1', config: devCfg, provider: p });
    const r = verifyChallenge({ phone: '9876543210', code: '123456', config: devCfg });
    expect(r.ok).toBe(true);
    expect(r.challenge.userId).toBe('u1');
  });
});
