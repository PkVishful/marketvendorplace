# Production BFF Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `web/server` safe to run in production — eliminate the fixed-code auth bypass and add the transport/rate/CORS hardening the deployment requires — without forking a dev vs prod copy of the server.

**Architecture:** One mode-aware Express app. A single `loadConfig()` resolves environment-dependent behavior and fails fast in production on missing secrets. New focused modules (`env`, `security`, `otp/provider`) hold the config, CORS/cookie/rate-limit/error-redaction concerns, and the delivery seam; `auth.mjs` gains a real hashed-OTP engine. The 2324-line route file is preserved and wrapped in `createApp(config)`; it listens only when run directly. All environment differences are gated on `config.isProd`.

**Tech Stack:** Node ESM (`.mjs`), Express 5, `cors` (already installed), `node:crypto`, Vitest (Node environment via per-file docblock). No new runtime dependencies.

## Global Constraints

- No secret value in any repo file. `.env.production.example` is placeholders only. (deployment rule #1)
- Fixed dev codes `123456` (OTP) / `654321` (MFA) MUST be impossible to accept when `EWORKS_ENV=production`. (deployment rule #6)
- `service_role` key is server-side only; never sent to the browser. (unaffected — BFF has no PostgREST path)
- RLS is never weakened. The `withUserSession` / `set local role` / `app.user_id` seam in `db.mjs` is unchanged.
- Local dev flow must keep working unchanged: Vite proxies `/api` → `127.0.0.1:8787`, and typing the fixed codes still logs in.
- Production CORS origin for this deployment: `https://getlegal.anvastech.in` (supplied via `CORS_ORIGIN` env — no code change to retarget).
- Server tests are `.mjs` files beside the module, first line `// @vitest-environment node`, importing helpers from `vitest` (config has `globals: false`).
- Run all tests from `web/`: `npm test -- <path>`.

---

### Task 1: Config resolution and fail-fast (`env.mjs`)

**Files:**
- Create: `web/server/env.mjs`
- Test: `web/server/env.test.mjs`

**Interfaces:**
- Produces: `loadConfig(rawEnv = process.env)` → frozen object
  `{ env:'dev'|'production', isProd:boolean, isDev:boolean, port:number,
  corsOrigin:string|null, cookieSecure:boolean, otpPepper:string,
  otpTtlMs:number, otpMaxAttempts:number,
  rateLimit:{ windowMs:number, maxPerPhone:number, maxPerIp:number },
  provider:string }`. Throws in production if `OTP_PEPPER`, `CORS_ORIGIN`, or a
  DB connection (`SUPABASE_DB_URL` | `DATABASE_URL` | `EWORKS_USE_LOCAL_PG=1`) is missing.

- [ ] **Step 1: Write the failing test**

```js
// web/server/env.test.mjs
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { loadConfig } from './env.mjs';

const prodBase = {
  EWORKS_ENV: 'production',
  OTP_PEPPER: 'x'.repeat(32),
  CORS_ORIGIN: 'https://getlegal.anvastech.in',
  EWORKS_USE_LOCAL_PG: '1',
};

describe('loadConfig', () => {
  it('defaults to dev with dev port and insecure cookies', () => {
    const c = loadConfig({});
    expect(c.env).toBe('dev');
    expect(c.isProd).toBe(false);
    expect(c.port).toBe(8787);
    expect(c.cookieSecure).toBe(false);
  });

  it('resolves production config with secure cookies and port 3001', () => {
    const c = loadConfig(prodBase);
    expect(c.isProd).toBe(true);
    expect(c.cookieSecure).toBe(true);
    expect(c.port).toBe(3001);
    expect(c.corsOrigin).toBe('https://getlegal.anvastech.in');
  });

  it('throws in production when OTP_PEPPER is missing', () => {
    const { OTP_PEPPER, ...rest } = prodBase;
    expect(() => loadConfig(rest)).toThrow(/OTP_PEPPER/);
  });

  it('throws in production when no DB connection is configured', () => {
    const { EWORKS_USE_LOCAL_PG, ...rest } = prodBase;
    expect(() => loadConfig(rest)).toThrow(/DB|DATABASE|LOCAL_PG/);
  });

  it('is frozen', () => {
    const c = loadConfig({});
    expect(() => { c.isProd = true; }).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- server/env.test.mjs`
Expected: FAIL — cannot resolve `./env.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// web/server/env.mjs
// Resolves and validates all environment-dependent config once, at boot.
// Pure: pass the env object in (process.env by default) so it is trivially
// testable without module-cache tricks.

const REQUIRED_IN_PROD = ['OTP_PEPPER', 'CORS_ORIGIN'];

export function loadConfig(rawEnv = process.env) {
  const isProd = rawEnv.EWORKS_ENV === 'production';
  const env = isProd ? 'production' : 'dev';

  if (isProd) {
    const missing = REQUIRED_IN_PROD.filter((k) => !rawEnv[k]);
    const hasDb =
      rawEnv.SUPABASE_DB_URL || rawEnv.DATABASE_URL || rawEnv.EWORKS_USE_LOCAL_PG === '1';
    if (!hasDb) missing.push('SUPABASE_DB_URL|DATABASE_URL|EWORKS_USE_LOCAL_PG');
    if (missing.length) {
      throw new Error(
        `refusing to start in production: missing required env: ${missing.join(', ')}`,
      );
    }
  }

  return Object.freeze({
    env,
    isProd,
    isDev: !isProd,
    port: Number(rawEnv.PORT || (isProd ? 3001 : 8787)),
    corsOrigin: rawEnv.CORS_ORIGIN || null,
    cookieSecure: isProd,
    otpPepper: rawEnv.OTP_PEPPER || 'dev-insecure-pepper',
    otpTtlMs: Number(rawEnv.OTP_TTL_MS || 5 * 60 * 1000),
    otpMaxAttempts: Number(rawEnv.OTP_MAX_ATTEMPTS || 5),
    rateLimit: Object.freeze({
      windowMs: Number(rawEnv.OTP_RL_WINDOW_MS || 15 * 60 * 1000),
      maxPerPhone: Number(rawEnv.OTP_RL_MAX_PHONE || 5),
      maxPerIp: Number(rawEnv.OTP_RL_MAX_IP || 20),
    }),
    provider: rawEnv.OTP_PROVIDER || 'console',
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- server/env.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/server/env.mjs web/server/env.test.mjs
git commit -m "feat(bff): env config resolution with production fail-fast"
```

---

### Task 2: OTP delivery seam (`otp/provider.mjs`)

**Files:**
- Create: `web/server/otp/provider.mjs`
- Test: `web/server/otp/provider.test.mjs`

**Interfaces:**
- Consumes: config object from Task 1 (reads `config.provider`).
- Produces:
  - `class ConsoleSink { async send({ phone, code, purpose }) → { delivered:true, channel:'console' } }`
  - `selectProvider(config)` → provider instance; throws on unknown provider name.

- [ ] **Step 1: Write the failing test**

```js
// web/server/otp/provider.test.mjs
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ConsoleSink, selectProvider } from './provider.mjs';

describe('otp provider', () => {
  it('ConsoleSink.send resolves delivered', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await new ConsoleSink().send({ phone: '9876543210', code: '123456', purpose: 'otp' });
    expect(r).toEqual({ delivered: true, channel: 'console' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('selectProvider returns ConsoleSink by default', () => {
    expect(selectProvider({ provider: 'console' })).toBeInstanceOf(ConsoleSink);
  });

  it('selectProvider throws on unknown provider', () => {
    expect(() => selectProvider({ provider: 'nope' })).toThrow(/unknown OTP provider/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- server/otp/provider.test.mjs`
Expected: FAIL — cannot resolve `./provider.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// web/server/otp/provider.mjs
// Pluggable OTP delivery seam. The default logs the code (staging/local only,
// never a real-user delivery path). A real SMS adapter implements the same
// async send({ phone, code, purpose }) and is selected via config.provider.

export class ConsoleSink {
  async send({ phone, code, purpose }) {
    console.log(`[otp:${purpose}] code for ${phone}: ${code}`);
    return { delivered: true, channel: 'console' };
  }
}

// Interface a future SMS adapter must satisfy (documented, not yet implemented):
//   class SmsProvider { constructor(config) {} async send({ phone, code, purpose }) {} }

export function selectProvider(config) {
  switch (config.provider) {
    case 'console':
      return new ConsoleSink();
    default:
      throw new Error(`unknown OTP provider: ${config.provider}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- server/otp/provider.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/server/otp/provider.mjs web/server/otp/provider.test.mjs
git commit -m "feat(bff): pluggable OTP delivery seam with console sink"
```

---

### Task 3: Real hashed-OTP engine (`auth.mjs`)

**Files:**
- Modify: `web/server/auth.mjs` (replace the fixed-code path; keep `normalizePhone`, `maskPhone`, `findUserIdByPhone`, `userRequiresMfa`, `buildSession`)
- Test: `web/server/auth.test.mjs`

**Interfaces:**
- Consumes: config from Task 1; a provider from Task 2.
- Produces:
  - `generateOtpCode()` → 6-digit string, cryptographically random.
  - `hashOtp(code, pepper)` → hex HMAC-SHA256 string.
  - `async issueChallenge({ phone, userId, requiresMfa, purpose='otp', config, provider })`
    → `{ maskedPhone, requiresMfa }` (stores a hashed challenge, delivers the code).
  - `verifyChallenge({ phone, code, purpose='otp', config })`
    → `{ ok:true, challenge:{ userId, requiresMfa } }` or `{ ok:false, reason }`.
  - `__resetChallenges()` — test hook clearing the in-memory store.
  - Unchanged exports: `normalizePhone`, `maskPhone`, `findUserIdByPhone`, `userRequiresMfa`, `buildSession`, `DEV_OTP`, `DEV_MFA`.

- [ ] **Step 1: Write the failing test**

```js
// web/server/auth.test.mjs
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadConfig } from './env.mjs';
import {
  generateOtpCode, hashOtp, issueChallenge, verifyChallenge, __resetChallenges,
} from './auth.mjs';

const devCfg = loadConfig({});
const prodCfg = loadConfig({
  EWORKS_ENV: 'production', OTP_PEPPER: 'pepper-'.repeat(4),
  CORS_ORIGIN: 'https://getlegal.anvastech.in', EWORKS_USE_LOCAL_PG: '1',
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- server/auth.test.mjs`
Expected: FAIL — `issueChallenge`/`verifyChallenge`/`__resetChallenges` not exported.

- [ ] **Step 3: Write minimal implementation**

Replace `web/server/auth.mjs` in full with:

```js
// Phone + OTP + MFA auth for the BFF.
//
// Codes are cryptographically random, stored only as HMAC-SHA256(pepper) hashes
// with a short TTL, single-use, and attempt-capped. Delivery goes through the
// pluggable provider seam. The fixed dev codes work ONLY when config.isDev, so
// they cannot authenticate in production.

import crypto from 'node:crypto';
import { lookupProfile } from './db.mjs';

const GOV_ROLES = new Set([
  'SITE_ENGINEER', 'EXECUTIVE_ENGINEER', 'DISTRICT_OFFICER',
  'SUPERINTENDING_ENGINEER', 'AUDITOR', 'HEAD_ADMIN',
]);

export const DEV_OTP = '123456';
export const DEV_MFA = '654321';

// key `${purpose}:${phone}` -> { userId, requiresMfa, hash, expiresAt, attempts }
const store = new Map();

export function __resetChallenges() { store.clear(); }

export function normalizePhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return null;
}

export function maskPhone(phone) {
  if (phone.length < 4) return '**********';
  return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
}

export async function findUserIdByPhone(pool, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const { rows } = await pool.query(
    `select id from eworks.user_profiles where phone = $1`,
    [normalized],
  );
  return rows[0]?.id ?? null;
}

export async function userRequiresMfa(pool, userId) {
  const { rows } = await pool.query(
    `select role_code from eworks.user_roles where user_id = $1`,
    [userId],
  );
  const codes = rows.map((r) => r.role_code);
  if (codes.length === 0) return false;
  const vendorOnly = codes.every((c) => c === 'LAB_VENDOR' || c === 'FIELD_TECHNICIAN');
  if (vendorOnly) return false;
  return codes.some((c) => GOV_ROLES.has(c));
}

export function generateOtpCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashOtp(code, pepper) {
  return crypto.createHmac('sha256', pepper).update(String(code)).digest('hex');
}

const key = (purpose, phone) => `${purpose}:${phone}`;

export async function issueChallenge({
  phone, userId, requiresMfa = false, purpose = 'otp', config, provider,
}) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const code = generateOtpCode();
  store.set(key(purpose, normalized), {
    userId,
    requiresMfa,
    hash: hashOtp(code, config.otpPepper),
    expiresAt: Date.now() + config.otpTtlMs,
    attempts: 0,
  });
  await provider.send({ phone: normalized, code, purpose });
  return { maskedPhone: maskPhone(normalized), requiresMfa };
}

export function verifyChallenge({ phone, code, purpose = 'otp', config }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, reason: 'invalid_phone' };
  const k = key(purpose, normalized);
  const hit = store.get(k);

  // Dev convenience only: the fixed codes never reach this branch in production.
  if (config.isDev) {
    const fixed = purpose === 'mfa' ? DEV_MFA : DEV_OTP;
    if (String(code ?? '').replace(/\D/g, '') === fixed) {
      store.delete(k);
      return { ok: true, challenge: hit ?? { userId: null, requiresMfa: false } };
    }
  }

  if (!hit) return { ok: false, reason: 'no_challenge' };
  if (Date.now() > hit.expiresAt) { store.delete(k); return { ok: false, reason: 'expired' }; }
  if (hit.attempts >= config.otpMaxAttempts) {
    store.delete(k);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const provided = hashOtp(String(code ?? '').replace(/\D/g, ''), config.otpPepper);
  const match =
    provided.length === hit.hash.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(hit.hash));
  if (!match) {
    hit.attempts += 1;
    return { ok: false, reason: 'invalid_code' };
  }
  store.delete(k); // single use
  return { ok: true, challenge: hit };
}

export async function buildSession(userId) {
  const profile = await lookupProfile(userId);
  if (!profile) return null;
  const { id, ...rest } = profile;
  return { authenticated: true, userId: id, ...rest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- server/auth.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add web/server/auth.mjs web/server/auth.test.mjs
git commit -m "feat(bff): real hashed-OTP engine, dev codes gated to non-prod"
```

---

### Task 4: Security middleware (`security.mjs`)

**Files:**
- Create: `web/server/security.mjs`
- Test: `web/server/security.test.mjs`

**Interfaces:**
- Consumes: config from Task 1; `normalizePhone` from Task 3.
- Produces:
  - `cookieAttributes(config, { clear })` → attribute string (`HttpOnly`, `Path=/`, `SameSite=Lax`, `Secure` iff prod, `Max-Age`).
  - `setSessionCookie(res, uid, config)` / `clearSessionCookie(res, config)`.
  - `readSessionCookie(req)` → uid string or null. (cookie name `eworks_dev_uid`, unchanged.)
  - `corsMiddleware(config)` → configured `cors` middleware.
  - `createRateLimiter({ windowMs, max, keyFn })` → Express middleware; `429` + `Retry-After` over limit.
  - `redactErrorDetailMiddleware(config)` → strips `detail` from `>=400` JSON bodies in prod only.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm test -- server/security.test.mjs`
Expected: FAIL — cannot resolve `./security.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// web/server/security.mjs
// CORS, cookie, rate-limit, and error-redaction concerns for the BFF.
// All environment differences are driven by the config object.

import cors from 'cors';
import { normalizePhone } from './auth.mjs';

const COOKIE = 'eworks_dev_uid';

export function cookieAttributes(config, { clear = false } = {}) {
  const parts = ['HttpOnly', 'Path=/', 'SameSite=Lax'];
  if (config.cookieSecure) parts.push('Secure');
  parts.push(`Max-Age=${clear ? 0 : 86400}`);
  return parts.join('; ');
}

export function setSessionCookie(res, uid, config) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(uid)}; ${cookieAttributes(config)}`);
}

export function clearSessionCookie(res, config) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttributes(config, { clear: true })}`);
}

export function readSessionCookie(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  return hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : null;
}

export function corsMiddleware(config) {
  // Prod: only the frontend origin, with credentials. Dev: reflect (Vite proxy
  // is same-origin, but reflecting keeps direct-origin testing simple).
  return cors({
    origin: config.isProd ? config.corsOrigin : true,
    credentials: true,
  });
}

export function createRateLimiter({ windowMs, max, keyFn }) {
  const hits = new Map(); // key -> { count, resetAt }
  return function rateLimiter(req, res, next) {
    const k = keyFn(req);
    if (k == null) return next();
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + windowMs }; hits.set(k, entry); }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited' });
    }
    return next();
  };
}

// Key helpers for the OTP endpoints.
export const ipKey = (req) => `ip:${req.ip}`;
export const phoneKey = (req) => {
  const n = normalizePhone(req.body?.phone);
  return n ? `phone:${n}` : null;
};

export function redactErrorDetailMiddleware(config) {
  return function redactErrorDetail(req, res, next) {
    if (!config.isProd) return next();
    const orig = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400 && body && typeof body === 'object' && 'detail' in body) {
        const { detail, ...rest } = body;
        return orig(rest);
      }
      return orig(body);
    };
    return next();
  };
}
```

Note: `fakeRes().status` is not defined in the test but the limiter calls `res.status(429).json(...)`. Add a `status` method to the test's `fakeRes` if missing:

```js
// in fakeRes(): add
status(code) { this.statusCode = code; return this; },
```
(Update the test's `fakeRes` before running Step 4.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm test -- server/security.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/server/security.mjs web/server/security.test.mjs
git commit -m "feat(bff): cookie/CORS/rate-limit/error-redaction middleware"
```

---

### Task 5: Wire it all into a mode-aware app (`dev-bff.mjs` → `bff.mjs`)

**Files:**
- Rename: `web/server/dev-bff.mjs` → `web/server/bff.mjs` (via `git mv`)
- Modify: `web/server/bff.mjs` (wrap in `createApp`, wire middleware, gate dev routes, real OTP endpoints, health, port)
- Modify: `web/package.json` (scripts)
- Modify: `web/vite.config.ts` (comment mentions `dev-bff.mjs`)
- Test: `web/server/bff.test.mjs`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `selectProvider` (Task 2), `issueChallenge`/`verifyChallenge`/`findUserIdByPhone`/`userRequiresMfa`/`buildSession` (Task 3), `corsMiddleware`/`setSessionCookie`/`clearSessionCookie`/`readSessionCookie`/`createRateLimiter`/`ipKey`/`phoneKey`/`redactErrorDetailMiddleware` (Task 4).
- Produces: `createApp(config, { provider } = {})` → configured Express app (does not listen). Listens only when run as the main module.

- [ ] **Step 1: Rename the file**

```bash
cd web && git mv server/dev-bff.mjs server/bff.mjs
```

- [ ] **Step 2: Write the failing integration test**

```js
// web/server/bff.test.mjs
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from './env.mjs';
import { createApp } from './bff.mjs';

// A no-op provider so createApp needs no real SMS; DB is never hit by these routes.
const provider = { async send() { return { delivered: true }; } };

function listen(config) {
  const app = createApp(config, { provider });
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}
let open;
afterEach(() => new Promise((r) => (open ? open.close(r) : r())));

const prod = loadConfig({
  EWORKS_ENV: 'production', OTP_PEPPER: 'p'.repeat(32),
  CORS_ORIGIN: 'https://getlegal.anvastech.in', EWORKS_USE_LOCAL_PG: '1',
});
const dev = loadConfig({});

describe('bff app wiring', () => {
  it('health endpoint responds', async () => {
    const { srv, port } = await listen(dev); open = srv;
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('dev-only routes are mounted in dev (400, not 404)', async () => {
    const { srv, port } = await listen(dev); open = srv;
    const r = await fetch(`http://127.0.0.1:${port}/api/dev/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(r.status).toBe(400); // reached the handler, missing userId
  });

  it('dev-only routes are ABSENT in production (404)', async () => {
    const { srv, port } = await listen(prod); open = srv;
    const r = await fetch(`http://127.0.0.1:${port}/api/dev/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(r.status).toBe(404);
  });

  it('CORS allows the configured origin in production', async () => {
    const { srv, port } = await listen(prod); open = srv;
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { Origin: 'https://getlegal.anvastech.in' },
    });
    expect(r.headers.get('access-control-allow-origin')).toBe('https://getlegal.anvastech.in');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npm test -- server/bff.test.mjs`
Expected: FAIL — `createApp` is not exported (file still calls `app.listen` at top level).

- [ ] **Step 4: Restructure `bff.mjs`**

Make these exact changes to `web/server/bff.mjs`:

1. **Replace the imports and top-of-file setup.** Change the top of the file (the `import express` block down through the `app.use(express.json(...))` line and the local `readCookie`/`setCookie`/`clearCookie` helpers) to:

```js
import express from 'express';
import { pathToFileURL } from 'node:url';
import { withUserSession, lookupProfile, pool } from './db.mjs';
import {
  buildSession, findUserIdByPhone, issueChallenge, userRequiresMfa, verifyChallenge,
} from './auth.mjs';
import { saveKycDocument, readKycDocument } from './kyc-upload.mjs';
import { saveContractorDocument, readContractorDocument } from './kyc-upload.mjs';
import { loadConfig } from './env.mjs';
import { selectProvider } from './otp/provider.mjs';
import {
  corsMiddleware, setSessionCookie, clearSessionCookie, readSessionCookie,
  createRateLimiter, ipKey, phoneKey, redactErrorDetailMiddleware,
} from './security.mjs';

const KYC_DOC_TYPES = [ /* unchanged list */ ];
const KYC_REQUIRED_DOCS = [ /* unchanged */ ];
const CONTRACTOR_DOC_TYPES = [ /* unchanged */ ];
const CONTRACTOR_REQUIRED_DOCS = [ /* unchanged */ ];

export function createApp(config = loadConfig(), { provider = selectProvider(config) } = {}) {
  const app = express();
  if (config.isProd) app.set('trust proxy', 1);
  app.use(corsMiddleware(config));
  app.use(express.json({ limit: '6mb' }));
  app.use(redactErrorDetailMiddleware(config));

  const otpIpLimiter = createRateLimiter({
    windowMs: config.rateLimit.windowMs, max: config.rateLimit.maxPerIp, keyFn: ipKey,
  });
  const otpPhoneLimiter = createRateLimiter({
    windowMs: config.rateLimit.windowMs, max: config.rateLimit.maxPerPhone, keyFn: phoneKey,
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
```

   - The `mapSampleRow`, `fetchFulfillment`, `computeMilestoneHealth`, `computeVendorTier`, `sessionDto` helpers can stay as module-level functions above `createApp` (they are pure). `requireUser` must move inside (or stay module-level but call `readSessionCookie`).

2. **All existing `app.<verb>(...)` route registrations move inside `createApp`** (between the health route and the final `return app;`). This is a mechanical wrap — do not change handler bodies except the specific replacements below.

3. **`requireUser` and `/api/me`:** replace `readCookie(req)` with `readSessionCookie(req)`, and `clearCookie(res)` with `clearSessionCookie(res, config)`:

```js
function requireUser(req, res) {
  const userId = readSessionCookie(req);
  if (!userId) { res.status(401).json({ error: 'not_authenticated' }); return null; }
  return userId;
}
```

4. **Gate the dev routes.** Wrap every `app.post('/api/dev/...')` registration (`/api/dev/login`, `/api/dev/logout`, `/api/dev/orders/:id/advance`, `/api/dev/jobs/:id/advance`) in a single block:

```js
  if (!config.isProd) {
    app.post('/api/dev/login', async (req, res) => {
      const { userId } = req.body || {};
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const profile = await lookupProfile(userId);
      if (!profile) return res.status(404).json({ error: 'unknown user' });
      setSessionCookie(res, userId, config);
      res.json(sessionDto(profile));
    });
    app.post('/api/dev/logout', (_req, res) => { clearSessionCookie(res, config); res.json({ ok: true }); });
    // ...the two /api/dev/.../advance routes, unchanged bodies...
  }
```

5. **Rewrite the OTP endpoints** to use the engine + rate limiters (replace the existing `/api/auth/otp/send` and `/api/auth/otp/verify`):

```js
  app.post('/api/auth/otp/send', otpIpLimiter, otpPhoneLimiter, async (req, res) => {
    const { phone } = req.body || {};
    try {
      const userId = await findUserIdByPhone(pool, phone);
      if (!userId) return res.status(404).json({ error: 'unknown_phone' });
      const requiresMfa = await userRequiresMfa(pool, userId);
      const challenge = await issueChallenge({ phone, userId, requiresMfa, purpose: 'otp', config, provider });
      if (!challenge) return res.status(400).json({ error: 'invalid_phone' });
      if (requiresMfa) {
        await issueChallenge({ phone, userId, requiresMfa, purpose: 'mfa', config, provider });
      }
      res.json({ sent: true, ...challenge });
    } catch (err) {
      res.status(500).json({ error: 'otp_send_failed', detail: err.message });
    }
  });

  app.post('/api/auth/otp/verify', otpIpLimiter, otpPhoneLimiter, async (req, res) => {
    const { phone, otp, mfaCode } = req.body || {};
    const otpResult = verifyChallenge({ phone, code: otp, purpose: 'otp', config });
    if (!otpResult.ok) return res.status(401).json({ error: 'invalid_otp', reason: otpResult.reason });
    const challenge = otpResult.challenge;
    if (challenge.requiresMfa) {
      const mfaResult = verifyChallenge({ phone, code: mfaCode, purpose: 'mfa', config });
      if (!mfaResult.ok) return res.status(401).json({ error: 'invalid_mfa', reason: mfaResult.reason });
    }
    try {
      const session = await buildSession(challenge.userId);
      if (!session) return res.status(404).json({ error: 'unknown_user' });
      setSessionCookie(res, challenge.userId, config);
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: 'login_failed', detail: err.message });
    }
  });

  app.post('/api/auth/logout', (_req, res) => { clearSessionCookie(res, config); res.json({ ok: true }); });
```

6. **`/api/me`:** keep the logic, swap cookie helpers:

```js
  app.get('/api/me', async (req, res) => {
    const userId = readSessionCookie(req);
    if (!userId) return res.status(401).json({ authenticated: false });
    const profile = await lookupProfile(userId);
    if (!profile) { clearSessionCookie(res, config); return res.status(401).json({ authenticated: false }); }
    res.json({ authenticated: true, ...sessionDto(profile) });
  });
```

7. **Close `createApp` and add the main-module guard** at the very end (replace the old `app.listen(...)` line):

```js
  return app;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => console.log(`BFF (${config.env}) listening on http://127.0.0.1:${config.port}`));
}
```

- [ ] **Step 5: Update `web/package.json` scripts**

```json
    "bff": "node server/bff.mjs",
    "start": "EWORKS_ENV=production node server/bff.mjs",
```
(Dev uses `bff` — env defaults to dev. `start` targets the Linux deploy host; production normally runs under pm2, which sets `EWORKS_ENV` itself.)

- [ ] **Step 6: Update the `vite.config.ts` comment**

Change `the dev BFF (node server/dev-bff.mjs)` to `the BFF (node server/bff.mjs)`.

- [ ] **Step 7: Run the full server suite**

Run: `cd web && npm test -- server/`
Expected: PASS — env, provider, auth, security, and bff tests all green.

- [ ] **Step 8: Manual dev smoke (local flow unchanged)**

Run: `cd web && npm run bff` then in another shell:
`curl -s -X POST localhost:8787/api/dev/login -H 'content-type: application/json' -d '{}'`
Expected: `{"error":"userId required"}` (dev route present). `curl localhost:8787/api/health` → `{"ok":true}`.

- [ ] **Step 9: Commit**

```bash
git add web/server/bff.mjs web/package.json web/vite.config.ts web/server/bff.test.mjs
git commit -m "feat(bff): mode-aware app, prod-gated dev routes, real OTP endpoints"
```

---

### Task 6: Process config and env template

**Files:**
- Create: `web/server/ecosystem.config.cjs`
- Create: `web/server/.env.production.example`
- Modify: `web/server/README` note (create `web/server/DEPLOY.md` if no server README exists)

**Interfaces:** none (config + docs).

- [ ] **Step 1: Create the pm2 ecosystem file**

```js
// web/server/ecosystem.config.cjs
// Run the BFF under pm2 in fork mode (single instance so the in-memory rate
// limiter and OTP store are authoritative). All secrets come from the server
// environment — never from this file.
module.exports = {
  apps: [{
    name: 'bff',
    script: 'server/bff.mjs',
    cwd: '/home/deploy/marketvendorplace/web',
    exec_mode: 'fork',
    instances: 1,
    env: { EWORKS_ENV: 'production' },
    max_restarts: 10,
    restart_delay: 2000,
  }],
};
```

- [ ] **Step 2: Create the placeholder env template (NO secret values)**

```bash
# web/server/.env.production.example
EWORKS_ENV=production
PORT=3001
CORS_ORIGIN=https://getlegal.anvastech.in
OTP_PROVIDER=console          # swap for a real SMS adapter before real users
OTP_PEPPER=                   # 32+ random bytes; generate on the server, keep out of git
# BFF connects to the Vultr Postgres over localhost:
EWORKS_USE_LOCAL_PG=1
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=                   # set on the server only
PGDATABASE=postgres
```

- [ ] **Step 3: Add a short server deploy note**

Create `web/server/DEPLOY.md` documenting: start-on-boot (`pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`), that `OTP_PROVIDER=console` is staging-only (the console sink logs codes; a real SMS adapter must be added before real users), and the systemd alternative (a unit running `EWORKS_ENV=production node server/bff.mjs` with an `EnvironmentFile=` pointing at a root-owned env file).

- [ ] **Step 4: Verify no secret slipped in**

Run: `git grep -nE 'Vishful|Eworks%23DB|eyJhbGci|BEGIN .*PRIVATE' -- web/server/ || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add web/server/ecosystem.config.cjs web/server/.env.production.example web/server/DEPLOY.md
git commit -m "chore(bff): pm2 ecosystem, prod env template, deploy notes"
```

---

## Self-Review

**Spec coverage** (design §2 defect table → task):
- Fixed OTP/MFA (#1) → Task 3 (dev-gated codes) ✅
- `/api/dev/login` bypass (#2) → Task 5 step 4.4 (prod-gated) ✅
- Cookie `Secure` (#3) → Task 4 (`cookieAttributes`) ✅
- CORS absent (#4) → Task 4 + Task 5 (`corsMiddleware`) ✅
- No rate limiting (#5) → Task 4 + Task 5 (OTP limiters) ✅
- Error `detail` disclosure (#6) → Task 4 (`redactErrorDetailMiddleware`) ✅
- Dev advance routes (#7) → Task 5 step 4.4 ✅
- Port/log hardcoded (#8) → Task 5 step 4.7 ✅
- Fail-fast on missing secrets → Task 1 ✅
- pm2 + env template → Task 6 ✅
- MFA reuses engine (design §3) → Task 3 (`purpose`) + Task 5 (dual issue/verify) ✅

**Placeholder scan:** none — every step has concrete code or an exact command.

**Type consistency:** `config` shape (Task 1) is consumed identically in Tasks 3/4/5; `issueChallenge`/`verifyChallenge` signatures match between Task 3 definition, Task 3 tests, and Task 5 call sites; `setSessionCookie(res, uid, config)` / `clearSessionCookie(res, config)` / `readSessionCookie(req)` consistent between Task 4 and Task 5; `ipKey`/`phoneKey` defined in Task 4, used in Task 5.

**One known caveat carried forward:** the `console` OTP provider is staging-only — Task 6 step 3 documents that a real SMS adapter is required before real users (matches the "pluggable seam, no provider yet" decision).
