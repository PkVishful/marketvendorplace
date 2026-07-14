// web/server/security.test.mjs
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from './env.mjs';
import {
  cookieAttributes, setSessionCookie, readSessionCookie, clearSessionCookie,
  corsMiddleware, createRateLimiter, redactErrorDetailMiddleware,
  ipKey, phoneKey, errorHandler,
} from './security.mjs';

const dev = loadConfig({});
const prod = loadConfig({
  EWORKS_ENV: 'production', OTP_PEPPER: 'p'.repeat(32),
  CORS_ORIGIN: 'https://getlegal.anvastech.in', SESSION_SECRET: 's'.repeat(32),
  EWORKS_USE_LOCAL_PG: '1',
});

function fakeRes() {
  return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    _body: undefined, json(b) { this._body = b; return this; } };
}

describe('signed cookies', () => {
  it('always HttpOnly + SameSite=Lax; Secure only in prod', () => {
    expect(cookieAttributes(dev)).toContain('HttpOnly');
    expect(cookieAttributes(dev)).toContain('SameSite=Lax');
    expect(cookieAttributes(dev)).not.toContain('Secure');
    expect(cookieAttributes(prod)).toContain('Secure');
  });

  function cookieHeaderToReq(res) {
    const setCookie = res.headers['Set-Cookie'];
    return { headers: { cookie: setCookie.split(';')[0] } };
  }

  it('sign -> read round-trips the uid', () => {
    const res = fakeRes();
    setSessionCookie(res, 'user-42', prod);
    expect(readSessionCookie(cookieHeaderToReq(res), prod)).toBe('user-42');
  });

  it('rejects a tampered uid', () => {
    const res = fakeRes();
    setSessionCookie(res, 'user-42', prod);
    const req = cookieHeaderToReq(res);
    req.headers.cookie = req.headers.cookie.replace('user-42', 'user-99');
    expect(readSessionCookie(req, prod)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const res = fakeRes();
    setSessionCookie(res, 'user-42', prod);
    const req = cookieHeaderToReq(res);
    // flip the last char of the cookie value (part of the signature)
    const last = req.headers.cookie.slice(-1) === 'A' ? 'B' : 'A';
    req.headers.cookie = req.headers.cookie.slice(0, -1) + last;
    expect(readSessionCookie(req, prod)).toBeNull();
  });

  it('rejects a cookie signed with a different secret', () => {
    const other = loadConfig({
      EWORKS_ENV: 'production', OTP_PEPPER: 'p'.repeat(32),
      CORS_ORIGIN: 'https://getlegal.anvastech.in', EWORKS_USE_LOCAL_PG: '1',
      SESSION_SECRET: 'DIFFERENT'.repeat(4),
    });
    const res = fakeRes();
    setSessionCookie(res, 'user-42', other);
    expect(readSessionCookie(cookieHeaderToReq(res), prod)).toBeNull();
  });

  it('rejects an expired cookie', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const res = fakeRes();
    setSessionCookie(res, 'user-42', prod);         // expires at +24h
    vi.setSystemTime(24 * 60 * 60 * 1000 + 1000);   // just past expiry
    expect(readSessionCookie(cookieHeaderToReq(res), prod)).toBeNull();
    vi.useRealTimers();
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
  it('evicts stale entries from the internal map instead of growing forever', () => {
    vi.useFakeTimers();
    const rl = createRateLimiter({ windowMs: 1000, max: 5, keyFn: (req) => req.key });
    const hit = (key) => {
      const res = fakeRes();
      let nexted = false;
      rl({ key }, res, () => { nexted = true; });
      return nexted;
    };
    expect(hit('A')).toBe(true);
    expect(rl._size()).toBe(1);
    // Move past A's window so its entry is stale, then trigger a sweep by
    // hitting a different key (also past lastSweep + windowMs).
    vi.advanceTimersByTime(1001);
    expect(hit('B')).toBe(true);
    // A must have been evicted by the sweep — only B remains resident.
    expect(rl._size()).toBe(1);
    // Behaviorally: A is treated as a brand-new window, not a resurrected one.
    expect(hit('A')).toBe(true);
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

describe('clearSessionCookie', () => {
  it('sets Max-Age=0, HttpOnly always, Secure only in prod', () => {
    const resDev = fakeRes();
    clearSessionCookie(resDev, dev);
    const devCookie = resDev.headers['Set-Cookie'];
    expect(devCookie).toContain('Max-Age=0');
    expect(devCookie).toContain('HttpOnly');
    expect(devCookie).not.toContain('Secure');

    const resProd = fakeRes();
    clearSessionCookie(resProd, prod);
    const prodCookie = resProd.headers['Set-Cookie'];
    expect(prodCookie).toContain('Max-Age=0');
    expect(prodCookie).toContain('HttpOnly');
    expect(prodCookie).toContain('Secure');
  });
});

describe('ipKey / phoneKey', () => {
  it('ipKey returns ip:<req.ip>', () => {
    expect(ipKey({ ip: '203.0.113.7' })).toBe('ip:203.0.113.7');
  });
  it('phoneKey returns phone:<normalized> for a valid phone', () => {
    expect(phoneKey({ body: { phone: '9876543210' } })).toBe('phone:9876543210');
    expect(phoneKey({ body: { phone: '+91 98765 43210' } })).toBe('phone:9876543210');
  });
  it('phoneKey returns null for a missing or invalid phone', () => {
    expect(phoneKey({ body: {} })).toBe(null);
    expect(phoneKey({ body: { phone: '123' } })).toBe(null);
    expect(phoneKey({})).toBe(null);
  });
});

describe('errorHandler', () => {
  it('prod: responds 500 with only { error: internal_error }, no detail', () => {
    const res = fakeRes();
    errorHandler(prod)(new Error('boom'), {}, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error' });
  });
  it('dev: responds 500 with detail included', () => {
    const res = fakeRes();
    errorHandler(dev)(new Error('boom'), {}, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res._body).toEqual({ error: 'internal_error', detail: 'boom' });
  });
});

describe('corsMiddleware', () => {
  function fakeCorsRes() {
    const headers = {};
    return {
      headers,
      statusCode: 200,
      getHeader(k) { return headers[k]; },
      setHeader(k, v) { headers[k] = v; },
      end() {},
    };
  }
  function run(config, requestOrigin) {
    const mw = corsMiddleware(config);
    const req = { method: 'GET', headers: { origin: requestOrigin } };
    const res = fakeCorsRes();
    let nexted = false;
    mw(req, res, () => { nexted = true; });
    return { res, nexted };
  }

  it('prod: locks Access-Control-Allow-Origin to config.corsOrigin regardless of request origin', () => {
    const { res, nexted } = run(prod, 'https://evil.example.com');
    expect(nexted).toBe(true);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(prod.corsOrigin);
    expect(res.headers['Access-Control-Allow-Origin']).not.toBe('https://evil.example.com');
  });

  it('dev: reflects the request origin (origin: true)', () => {
    const { res, nexted } = run(dev, 'http://localhost:5173');
    expect(nexted).toBe(true);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });
});
