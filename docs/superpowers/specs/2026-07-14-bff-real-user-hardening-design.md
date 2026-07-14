# BFF Real-User Hardening — Design (signed session cookie + MSG91 OTP)

**Date:** 2026-07-14
**Status:** Approved for planning
**Scope:** Close the two remaining "before real users" blockers in `web/server`, on top of
the completed production-BFF hardening ([[production-bff-hardening]]): (1) the session cookie
is an unsigned plaintext user id (impersonation bypass); (2) OTP delivery has only a console
sink. Adds an HMAC-signed cookie and a real MSG91 SMS provider.

Out of scope: server-side session revocation ("logout everywhere"), which would need a session
store — deferred. Signed cookies are stateless; global logout is only possible by rotating
`SESSION_SECRET`.

---

## 1. Problem

Verified in the current code:

| # | Defect | Location | Consequence |
|---|---|---|---|
| 1 | Session cookie value is the raw `userId` (`encodeURIComponent(uid)`), trusted verbatim | `security.mjs:17-28` | Anyone who learns a user's UUID sets `eworks_dev_uid=<uuid>` and is authenticated as them, bypassing OTP; drives RLS `app.user_id` as the victim |
| 2 | Only `ConsoleSink` exists (logs the code) | `otp/provider.mjs:5-22` | No real OTP delivery; cannot onboard real users |

Both are the last items gating real users (the fixed dev codes and stack leaks were already fixed).

---

## 2. Signed session cookie

**Format.** The cookie value becomes `"<uid>.<expiresTs>.<sig>"` where:
- `expiresTs` = ms epoch when the session expires (now + 24h, matching the existing `Max-Age`).
- `sig` = `base64url(HMAC-SHA256("<uid>.<expiresTs>", SESSION_SECRET))`.
- UUIDs contain no `.`, so the three-field split on `.` is unambiguous.

**`security.mjs` changes** (`crypto` import added):
- `signSession(uid, expiresTs, secret)` → `sig` (helper).
- `setSessionCookie(res, uid, config)` — compute `expiresTs`, build the signed value, set with the
  existing `cookieAttributes(config)` flags (`HttpOnly`, `SameSite=Lax`, `Secure` in prod).
- `readSessionCookie(req, config)` — **signature gains `config`.** Read the raw cookie, split into
  `uid`/`expiresTs`/`sig`; recompute the HMAC and compare with **`crypto.timingSafeEqual`**
  (length-guarded, as the OTP engine does); reject if the signature fails or `Date.now() > expiresTs`.
  Return `uid` on success, else `null`.
- `clearSessionCookie(res, config)` — unchanged behavior.
- Cookie name stays `eworks_dev_uid` (rename is cosmetic; noted for a later cleanup).

**`env.mjs` changes:**
- Add `SESSION_SECRET` to `REQUIRED_IN_PROD` (prod fail-fast, exactly like `OTP_PEPPER`).
- Add `sessionSecret: rawEnv.SESSION_SECRET || 'dev-insecure-session-secret'` to the frozen config.

**`bff.mjs` changes:** the two `readSessionCookie(req)` call sites — `requireUser` and `GET /api/me` —
become `readSessionCookie(req, config)`. No other handler reads the cookie directly.

**Compatibility:** old plaintext cookies fail signature verification → `null` → the user logs in
once more. Acceptable, no migration needed.

---

## 3. MSG91 OTP provider

Keeps our own hashed/TTL/single-use OTP engine as the source of truth; MSG91 only *delivers* the
code we generate — so we use MSG91's **Flow API**, not its OTP-generator endpoint.

**New file `otp/msg91.mjs`:**
```
export class Msg91Provider {
  constructor(config) {
    if (!config.msg91.authKey || !config.msg91.templateId) {
      throw new Error('MSG91 provider requires MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
    }
    this.authKey = config.msg91.authKey;
    this.templateId = config.msg91.templateId;
    this.senderId = config.msg91.senderId; // optional; usually embedded in the DLT template
    this.endpoint = 'https://control.msg91.com/api/v5/flow/';
  }
  async send({ phone, code, purpose }) {
    const mobiles = `91${phone}`;               // phone is a normalized 10-digit number
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: this.authKey },
      body: JSON.stringify({
        template_id: this.templateId,
        recipients: [{ mobiles, var1: code }],
      }),
    });
    if (!res.ok) {
      throw new Error(`MSG91 send failed: ${res.status}`);
    }
    return { delivered: true, channel: 'msg91' };
  }
}
```

**`otp/provider.mjs`:** `selectProvider(config)` gains `case 'msg91': return new Msg91Provider(config);`
(constructor validates keys → fail-fast at `createApp` boot). `ConsoleSink` unchanged.

**`env.mjs`:** add to the frozen config:
```
msg91: Object.freeze({
  authKey: rawEnv.MSG91_AUTH_KEY || null,
  templateId: rawEnv.MSG91_TEMPLATE_ID || null,
  senderId: rawEnv.MSG91_SENDER_ID || null,
}),
```
Also: at boot, if `isProd && provider === 'console'`, emit a loud `console.warn` (console sink is
staging-only) — a warning, not a hard failure, so prod-mode staging still works.

**Note:** the DLT-approved template must contain one variable (`var1`) for the code and be TRAI-registered.
The provider does not enforce this — it's an operational precondition documented in `DEPLOY.md`.

---

## 4. Config / deploy artifacts

`.env.production.example` and `DEPLOY.md` gain:
```
SESSION_SECRET=          # 32+ random bytes, generate on the server, keep out of git
OTP_PROVIDER=msg91       # real delivery for real users (console is staging-only)
MSG91_AUTH_KEY=
MSG91_TEMPLATE_ID=       # DLT-approved template with a var for the OTP code
MSG91_SENDER_ID=         # optional
```
with a one-line note that the DLT template must be TRAI-approved and contain the code variable.

---

## 5. Testing (TDD)

- **Cookie** (`security.test.mjs`): sign→read round-trip returns the uid; a tampered uid rejected;
  a tampered signature rejected; an expired `expiresTs` rejected; a cookie signed with a different
  secret rejected. Update existing cookie tests to the new `readSessionCookie(req, config)` signature.
- **MSG91** (`otp/msg91.test.mjs`): `fetch` stubbed via `vi.stubGlobal` — asserts POST to the flow
  endpoint, `authkey` header, `template_id`, recipient `mobiles === '91' + phone`, `var1 === code`;
  returns `{ delivered: true, channel: 'msg91' }` on 2xx; throws on non-2xx. Constructor throws when
  keys are missing. No network.
- **provider** (`otp/provider.test.mjs`): `selectProvider({provider:'msg91', msg91:{...}})` returns a
  `Msg91Provider`; missing keys → throws.
- **env** (`env.test.mjs`): prod throws when `SESSION_SECRET` missing; config exposes `sessionSecret`
  and the frozen `msg91` block.

All under the existing `vitest` Node-environment setup (`// @vitest-environment node`).

---

## 6. Definition of done

- Forged/plaintext cookies are rejected; only server-signed, unexpired cookies authenticate.
- `SESSION_SECRET` missing in prod aborts boot.
- `OTP_PROVIDER=msg91` delivers the server-generated code via the MSG91 Flow API; missing MSG91
  keys abort boot; console sink emits a prod warning.
- All new unit tests pass; existing server suite stays green.
- No secret value committed; `.env.production.example` placeholders only.
- RLS seam and the OTP engine's hashed/TTL/single-use semantics unchanged.
