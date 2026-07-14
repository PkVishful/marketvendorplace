// web/server/security.test.mjs
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from './env.mjs';
import {
  cookieAttributes, setSessionCookie, readSessionCookie,
  createRateLimiter, redactErrorDetailMiddleware,
} from './security.mjs';

const dev = loadConfig({});
const prod = loadConfig({
  EWORKS_ENV: 'production', OTP_PEPPER: 'p'.repeat(32),
  CORS_ORIGIN: 'https://getlegal.anvastech.in', EWORKS_USE_LOCAL_PG: '1',
});

function fakeRes() {
  return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    _body: undefined, json(b) { this._body = b; return this; } };
}

describe('cookies', () => {
  it('always HttpOnly + SameSite=Lax; Secure only in prod', () => {
    expect(cookieAttributes(dev)).toContain('HttpOnly');
    expect(cookieAttributes(dev)).toContain('SameSite=Lax');
    expect(cookieAttributes(dev)).not.toContain('Secure');
    expect(cookieAttributes(prod)).toContain('Secure');
  });
  it('round-trips uid via set/read', () => {
    const res = fakeRes();
    setSessionCookie(res, 'user-42', prod);
    const cookie = res.headers['Set-Cookie'];
    const req = { headers: { cookie: cookie.split(';')[0] } };
    expect(readSessionCookie(req)).toBe('user-42');
  });
});

describe('rate limiter', () => {
  it('allows up to max then 429s', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 2, keyFn: () => 'k' });
    const run = () => { const res = fakeRes(); let nexted = false;
      rl({}, res, () => { nexted = true; }); return { res, nexted }; };
    expect(run().nexted).toBe(true);
    expect(run().nexted).toBe(true);
    const third = run();
    expect(third.nexted).toBe(false);
    expect(third.res.statusCode).toBe(429);
  });
  it('resets after the window', () => {
    vi.useFakeTimers();
    const rl = createRateLimiter({ windowMs: 1000, max: 1, keyFn: () => 'k' });
    const run = () => { const res = fakeRes(); let nexted = false;
      rl({}, res, () => { nexted = true; }); return nexted; };
    expect(run()).toBe(true);
    expect(run()).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(run()).toBe(true);
    vi.useRealTimers();
  });
});

describe('error detail redaction', () => {
  it('strips detail on >=400 in prod, keeps it in dev', () => {
    const mkNext = () => { let f = false; return { call: () => (f = true), done: () => f }; };
    // prod: stripped
    const rp = fakeRes(); rp.statusCode = 400;
    redactErrorDetailMiddleware(prod)({}, rp, () => {});
    rp.json({ error: 'x', detail: 'secret' });
    expect(rp._body).toEqual({ error: 'x' });
    // dev: kept
    const rd = fakeRes(); rd.statusCode = 400;
    redactErrorDetailMiddleware(dev)({}, rd, () => {});
    rd.json({ error: 'x', detail: 'secret' });
    expect(rd._body).toEqual({ error: 'x', detail: 'secret' });
  });
});
