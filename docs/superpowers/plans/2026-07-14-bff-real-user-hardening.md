# BFF Real-User Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two remaining pre-real-user blockers in `web/server`: forge-proof the session cookie (HMAC-signed) and add a real MSG91 SMS OTP provider.

**Architecture:** Build on the completed production-BFF hardening. The cookie becomes a signed `<uid>.<expiresTs>.<sig>` token verified with `crypto.timingSafeEqual` + expiry; a new `SESSION_SECRET` joins the prod fail-fast set. A new `Msg91Provider` delivers our own server-generated OTP via MSG91's Flow API behind the existing `selectProvider` seam. No new runtime dependency (uses `node:crypto` + global `fetch`).

**Tech Stack:** Node ESM (`.mjs`), Express 5, `node:crypto`, global `fetch` (Node 18+), Vitest (Node environment via `// @vitest-environment node`).

## Global Constraints

- No secret VALUE in any repo file. `.env.production.example` is placeholders only.
- Server tests: first line `// @vitest-environment node`; import from `vitest` (`globals: false`); run from `web/` with `npm test -- <path>`.
- Do not weaken the RLS seam (`db.mjs`) or the OTP engine's hashed/TTL/single-use semantics.
- Cookie signature comparison MUST be constant-time (`crypto.timingSafeEqual`, length-guarded).
- `SESSION_SECRET` missing in production MUST abort boot (like `OTP_PEPPER`).
- MSG91 provider MUST send our generated code (not use MSG91's own OTP generator) and MUST throw on non-2xx so `issueChallenge` surfaces `otp_send_failed`.
- Cookie name stays `eworks_dev_uid`.

---

### Task 1: `env.mjs` — SESSION_SECRET + MSG91 config + prod fail-fast

**Files:**
- Modify: `web/server/env.mjs`
- Modify (fixtures): `web/server/env.test.mjs`, `web/server/auth.test.mjs`, `web/server/security.test.mjs`, `web/server/bff.test.mjs`

**Interfaces:**
- Produces: config gains `sessionSecret: string` and a frozen `msg91: { authKey, templateId, senderId }` (each `string|null`). `SESSION_SECRET` added to `REQUIRED_IN_PROD`.

**Why the fixture edits:** every test that builds a production config via `loadConfig({...})` currently omits `SESSION_SECRET`. Once it's required in prod, those calls would throw and break `auth`/`security`/`bff` suites. All prod fixtures must add `SESSION_SECRET`.

- [ ] **Step 1: Update the existing env test + add new assertions**

In `web/server/env.test.mjs`, add `SESSION_SECRET: 's'.repeat(32)` to the `prodBase` object, and add these tests:

```js
  it('throws in production when SESSION_SECRET is missing', () => {
    const { SESSION_SECRET, ...rest } = prodBase;
    expect(() => loadConfig(rest)).toThrow(/SESSION_SECRET/);
  });

  it('exposes sessionSecret and a frozen msg91 block', () => {
    const c = loadConfig({ ...prodBase, MSG91_AUTH_KEY: 'k', MSG91_TEMPLATE_ID: 't' });
    expect(c.sessionSecret).toBe('s'.repeat(32));
    expect(c.msg91).toEqual({ authKey: 'k', templateId: 't', senderId: null });
    expect(() => { c.msg91.authKey = 'x'; }).toThrow();
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd web && npm test -- server/env.test.mjs`
Expected: FAIL — `SESSION_SECRET` not required yet / `sessionSecret`/`msg91` undefined.

- [ ] **Step 3: Implement in `web/server/env.mjs`**

Change the required list:
```js
const REQUIRED_IN_PROD = ['OTP_PEPPER', 'CORS_ORIGIN', 'SESSION_SECRET'];
```

Add these two fields inside the `Object.freeze({ ... })` return (e.g. after `otpPepper`):
```js
    sessionSecret: rawEnv.SESSION_SECRET || 'dev-insecure-session-secret',
    msg91: Object.freeze({
      authKey: rawEnv.MSG91_AUTH_KEY || null,
      templateId: rawEnv.MSG91_TEMPLATE_ID || null,
      senderId: rawEnv.MSG91_SENDER_ID || null,
    }),
```

- [ ] **Step 4: Add SESSION_SECRET to the other prod fixtures**

In each of `web/server/auth.test.mjs`, `web/server/security.test.mjs`, `web/server/bff.test.mjs`, find the production `loadConfig({ ... })` fixture (the object containing `OTP_PEPPER` and `CORS_ORIGIN`) and add `SESSION_SECRET: 's'.repeat(32),` to it.

- [ ] **Step 5: Run the full server suite**

Run: `cd web && npm test -- server/`
Expected: PASS — all suites green (fixtures updated, new env tests pass).

- [ ] **Step 6: Commit**

```bash
git add web/server/env.mjs web/server/env.test.mjs web/server/auth.test.mjs web/server/security.test.mjs web/server/bff.test.mjs
git commit -m "feat(bff): SESSION_SECRET + MSG91 config with production fail-fast"
```

---

### Task 2: `security.mjs` — HMAC-signed session cookie

**Files:**
- Modify: `web/server/security.mjs`
- Modify: `web/server/bff.mjs` (two `readSessionCookie` call sites)
- Modify: `web/server/security.test.mjs`

**Interfaces:**
- Consumes: `config.sessionSecret` (Task 1).
- Produces: `setSessionCookie(res, uid, config)` writes a signed token; `readSessionCookie(req, config)` (**signature gains `config`**) returns the uid only for a valid, unexpired signature, else `null`. `clearSessionCookie(res, config)` unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the existing cookie `describe('cookies', ...)` block in `web/server/security.test.mjs` with:

```js
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
```

Ensure `loadConfig` is imported at the top of the test file (it already is for building `dev`/`prod`).

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npm test -- server/security.test.mjs`
Expected: FAIL — `readSessionCookie` ignores `config`, cookie is unsigned, tamper/expiry not enforced.

- [ ] **Step 3: Implement signed cookie in `web/server/security.mjs`**

Add the crypto import at the top (with the existing imports):
```js
import crypto from 'node:crypto';
```

Add a shared max-age constant and a signing helper, and rewrite the three cookie functions:
```js
const COOKIE = 'eworks_dev_uid';
const SESSION_MAX_AGE_S = 86400; // 24h

function signSession(uid, expiresTs, secret) {
  return crypto.createHmac('sha256', secret).update(`${uid}.${expiresTs}`).digest('base64url');
}

export function cookieAttributes(config, { clear = false } = {}) {
  const parts = ['HttpOnly', 'Path=/', 'SameSite=Lax'];
  if (config.cookieSecure) parts.push('Secure');
  parts.push(`Max-Age=${clear ? 0 : SESSION_MAX_AGE_S}`);
  return parts.join('; ');
}

export function setSessionCookie(res, uid, config) {
  const expiresTs = Date.now() + SESSION_MAX_AGE_S * 1000;
  const value = `${uid}.${expiresTs}.${signSession(uid, expiresTs, config.sessionSecret)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; ${cookieAttributes(config)}`);
}

export function clearSessionCookie(res, config) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttributes(config, { clear: true })}`);
}

export function readSessionCookie(req, config) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  if (!hit) return null;
  const value = decodeURIComponent(hit.slice(COOKIE.length + 1));
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [uid, expiresStr, sig] = parts;
  const expiresTs = Number(expiresStr);
  if (!Number.isFinite(expiresTs) || Date.now() > expiresTs) return null;
  const expected = signSession(uid, expiresTs, config.sessionSecret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return uid;
}
```
(If `cookieAttributes` already exists above, replace it in place; keep only one definition.)

- [ ] **Step 4: Update the two `readSessionCookie` call sites in `web/server/bff.mjs`**

Both are inside `createApp` (so `config` is in scope):
- In `requireUser`: `const userId = readSessionCookie(req, config);`
- In `GET /api/me`: `const userId = readSessionCookie(req, config);`

- [ ] **Step 5: Run the full server suite**

Run: `cd web && npm test -- server/`
Expected: PASS — signed-cookie tests green; nothing else regresses.

- [ ] **Step 6: Commit**

```bash
git add web/server/security.mjs web/server/security.test.mjs web/server/bff.mjs
git commit -m "feat(bff): HMAC-signed session cookie (stops plaintext-uid impersonation)"
```

---

### Task 3: MSG91 OTP provider

**Files:**
- Create: `web/server/otp/msg91.mjs`
- Modify: `web/server/otp/provider.mjs`
- Create: `web/server/otp/msg91.test.mjs`
- Modify: `web/server/otp/provider.test.mjs`

**Interfaces:**
- Consumes: `config.msg91` (Task 1).
- Produces: `class Msg91Provider { constructor(config); async send({ phone, code, purpose }) }`. `selectProvider(config)` gains `case 'msg91'`.

- [ ] **Step 1: Write the failing MSG91 provider test**

```js
// web/server/otp/msg91.test.mjs
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Msg91Provider } from './msg91.mjs';

const cfg = { msg91: { authKey: 'AUTHKEY', templateId: 'TPL', senderId: null } };

afterEach(() => vi.unstubAllGlobals());

describe('Msg91Provider', () => {
  it('throws when auth key or template id is missing', () => {
    expect(() => new Msg91Provider({ msg91: { authKey: null, templateId: null } }))
      .toThrow(/MSG91/);
  });

  it('posts our code to the flow API with the right shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    const r = await new Msg91Provider(cfg).send({ phone: '9876543210', code: '123456', purpose: 'otp' });
    expect(r).toEqual({ delivered: true, channel: 'msg91' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://control.msg91.com/api/v5/flow/');
    expect(opts.method).toBe('POST');
    expect(opts.headers.authkey).toBe('AUTHKEY');
    const body = JSON.parse(opts.body);
    expect(body.template_id).toBe('TPL');
    expect(body.recipients[0].mobiles).toBe('919876543210');
    expect(body.recipients[0].var1).toBe('123456');
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(new Msg91Provider(cfg).send({ phone: '9876543210', code: '1', purpose: 'otp' }))
      .rejects.toThrow(/MSG91 send failed: 401/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npm test -- server/otp/msg91.test.mjs`
Expected: FAIL — cannot resolve `./msg91.mjs`.

- [ ] **Step 3: Implement `web/server/otp/msg91.mjs`**

```js
// web/server/otp/msg91.mjs
// MSG91 SMS OTP provider. Delivers OUR server-generated code via MSG91's Flow API
// (a DLT-approved template with a variable for the code) — it does NOT use MSG91's
// own OTP generator, so the hashed/TTL/single-use engine stays the source of truth.

export class Msg91Provider {
  constructor(config) {
    const m = config.msg91 || {};
    if (!m.authKey || !m.templateId) {
      throw new Error('MSG91 provider requires MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
    }
    this.authKey = m.authKey;
    this.templateId = m.templateId;
    this.senderId = m.senderId; // optional; usually embedded in the DLT template
    this.endpoint = 'https://control.msg91.com/api/v5/flow/';
  }

  async send({ phone, code /*, purpose */ }) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: this.authKey },
      body: JSON.stringify({
        template_id: this.templateId,
        recipients: [{ mobiles: `91${phone}`, var1: code }],
      }),
    });
    if (!res.ok) {
      throw new Error(`MSG91 send failed: ${res.status}`);
    }
    return { delivered: true, channel: 'msg91' };
  }
}
```

- [ ] **Step 4: Wire it into `web/server/otp/provider.mjs`**

Add the import at the top:
```js
import { Msg91Provider } from './msg91.mjs';
```
Add a case in `selectProvider`'s switch (before `default`):
```js
    case 'msg91':
      return new Msg91Provider(config);
```

- [ ] **Step 5: Add provider-selection tests**

Append to `web/server/otp/provider.test.mjs`:
```js
import { Msg91Provider } from './msg91.mjs';

describe('selectProvider msg91', () => {
  it('returns a Msg91Provider when configured', () => {
    const p = selectProvider({ provider: 'msg91', msg91: { authKey: 'k', templateId: 't', senderId: null } });
    expect(p).toBeInstanceOf(Msg91Provider);
  });
  it('throws when msg91 keys are missing', () => {
    expect(() => selectProvider({ provider: 'msg91', msg91: { authKey: null, templateId: null } }))
      .toThrow(/MSG91/);
  });
});
```
(Ensure `describe`/`it`/`expect` are imported from `vitest` at the top — they already are.)

- [ ] **Step 6: Run the OTP tests then the full suite**

Run: `cd web && npm test -- server/otp/ && npm test -- server/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/server/otp/msg91.mjs web/server/otp/msg91.test.mjs web/server/otp/provider.mjs web/server/otp/provider.test.mjs
git commit -m "feat(bff): MSG91 OTP provider via Flow API behind the delivery seam"
```

---

### Task 4: Deploy artifacts + prod console-sink warning

**Files:**
- Modify: `web/server/.env.production.example`
- Modify: `web/server/DEPLOY.md`
- Modify: `web/server/bff.mjs` (main-module guard warning only)

**Interfaces:** none (config/docs + a boot-time warning).

- [ ] **Step 1: Add the new env placeholders**

Append to `web/server/.env.production.example` (placeholders only — no values):
```
SESSION_SECRET=          # 32+ random bytes; generate on the server, keep out of git
OTP_PROVIDER=msg91       # real delivery for real users (console sink is staging-only)
MSG91_AUTH_KEY=
MSG91_TEMPLATE_ID=       # DLT-approved template with a variable (var1) for the OTP code
MSG91_SENDER_ID=         # optional; usually embedded in the DLT template
```
(If an `OTP_PROVIDER=console` line already exists from the earlier task, change it to `msg91`.)

- [ ] **Step 2: Document in `web/server/DEPLOY.md`**

Add a short "Real-user prerequisites" section stating: set `SESSION_SECRET` (32+ random bytes) and `OTP_PROVIDER=msg91` with `MSG91_AUTH_KEY`/`MSG91_TEMPLATE_ID`; the MSG91 DLT template must be **TRAI-approved** and contain a variable (`var1`) for the code; `OTP_PROVIDER=console` logs codes and is staging-only.

- [ ] **Step 3: Add the prod console-sink warning to the main-module guard**

In `web/server/bff.mjs`, inside the `if (isMain) { ... }` block, after `const config = loadConfig();`, add:
```js
  if (config.isProd && config.provider === 'console') {
    console.warn('[bff] WARNING: OTP_PROVIDER=console in production — codes are only logged, not delivered. Set OTP_PROVIDER=msg91 before real users.');
  }
```
(Placing it in the main guard — not `createApp` — keeps tests quiet.)

- [ ] **Step 4: Verify no secret slipped in + suite still green**

Run:
```bash
cd web && git grep -nE 'Vishful|Eworks%23DB|eyJhbGci|BEGIN .*PRIVATE|authkey.*[A-Za-z0-9]{20}' -- web/server/ || echo clean
npm test -- server/
```
Expected: `clean` and all tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/server/.env.production.example web/server/DEPLOY.md web/server/bff.mjs
git commit -m "chore(bff): document SESSION_SECRET + MSG91 env; warn on prod console sink"
```

---

## Self-Review

**Spec coverage:**
- Signed cookie (spec §2) → Task 2 ✅ (sign/verify/expiry/timing-safe + call-site updates)
- `SESSION_SECRET` prod fail-fast (spec §2) → Task 1 ✅
- MSG91 provider via Flow API (spec §3) → Task 3 ✅
- `selectProvider` case + constructor fail-fast (spec §3) → Task 3 ✅
- `env.mjs` msg91 block (spec §3) → Task 1 ✅
- Deploy artifacts + prod console warning (spec §3, §4) → Task 4 ✅
- Tests for all of the above (spec §5) → Tasks 1–3 ✅

**Placeholder scan:** none — every step has concrete code or exact commands.

**Type consistency:** `config.sessionSecret` (Task 1) consumed by `signSession`/`setSessionCookie`/`readSessionCookie` (Task 2); `config.msg91.{authKey,templateId,senderId}` (Task 1) consumed by `Msg91Provider` (Task 3); `readSessionCookie(req, config)` signature updated at both call sites (Task 2); `selectProvider` `case 'msg91'` returns the `Msg91Provider` defined in Task 3.

**Cross-cutting note:** Task 1 must update the prod `loadConfig` fixtures in `auth.test.mjs`, `security.test.mjs`, and `bff.test.mjs` (not just `env.test.mjs`), or adding `SESSION_SECRET` to `REQUIRED_IN_PROD` breaks those suites. Called out explicitly in Task 1 Step 4.
