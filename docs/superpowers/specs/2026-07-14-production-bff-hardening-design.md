# Production BFF Hardening — Design

**Date:** 2026-07-14
**Status:** Approved for planning
**Scope:** Task 5 of the Vultr deployment prompt — make `web/server` safe to run in
production. This is the hard blocker: the current BFF authenticates anyone as anyone.

This spec covers **only** the repo-side BFF code. Server provisioning, Supabase,
reverse proxy, DNS, GitHub Actions, migrations against the live DB, and backups
(Tasks 1–4, 6, 7) are out of scope for this pass and will be specced separately.

---

## 1. Problem — verified defects

Read from the current code:

| # | Defect | Location | Consequence in production |
|---|---|---|---|
| 1 | Fixed OTP `123456` / MFA `654321`; `validateOtpCode` compares to a constant | `auth.mjs:14-15,76-84` | Anyone logs in as anyone |
| 2 | `/api/dev/login` mints a session from a bare `userId`, no OTP | `dev-bff.mjs:223-230` | Complete auth bypass |
| 3 | Session cookie lacks `Secure` | `dev-bff.mjs:50-53` | Session transmissible over plain HTTP |
| 4 | No CORS middleware at all | absent | Cross-subdomain frontend cannot call the BFF |
| 5 | No rate limiting on OTP endpoints | absent | OTP brute-force; SMS-bombing a phone |
| 6 | Every error returns `detail: err.message` | throughout `dev-bff.mjs` | Internal error / schema disclosure |
| 7 | Dev state-mutation routes always mounted | `dev-bff.mjs:1213,1258` | Tamper with auction/job state |
| 8 | Listen log hardcodes `8787`; port not fully env-driven | `dev-bff.mjs:2324` | Cosmetic + wrong port for prod (3001) |

**Non-negotiables carried from the deployment prompt:** no secrets in the repo;
`service_role` never in the browser (unaffected — BFF is server-side); RLS is never
weakened; the fixed dev codes must be impossible to use in production.

---

## 2. Approach — config-driven single file, not a fork

The 2324-line route file is left intact. Hardening is a security change, not a
decomposition; forking a dev copy and a prod copy would guarantee drift. Instead,
behavior that differs between environments is centralized and gated on one flag,
`isProd`, derived from `EWORKS_ENV`.

The entry file is renamed `dev-bff.mjs` → `bff.mjs` (it is now production code;
the `dev-` prefix is misleading). Two references update: the `bff` npm script and
a comment in `vite.config.ts`.

npm scripts:

- `bff` → `EWORKS_ENV=dev node server/bff.mjs` (local dev; Vite proxy on 8787)
- `start` → `EWORKS_ENV=production node server/bff.mjs` (prod; port 3001, run under pm2)

---

## 3. Module boundaries

New, small, single-purpose modules alongside the existing server files:

### `server/env.mjs`
Resolves and validates all environment-dependent config once at boot:

- `EWORKS_ENV` (`dev` | `production`), exposed as `isProd`
- `PORT` (default 8787 dev; set to 3001 in prod via env)
- `CORS_ORIGIN` (prod: exactly `https://marketplace.anvastech.in`)
- `OTP_PEPPER` (HMAC key for hashing codes)
- cookie flags (`Secure` on in prod)
- OTP TTL / attempt caps / rate-limit windows (with safe defaults)

**Fail-fast:** in production, boot throws if `OTP_PEPPER`, a DB connection URL, or
`CORS_ORIGIN` is missing. A misconfigured prod server must not start, not start
insecure.

### `server/security.mjs`
- `corsMiddleware()` — wraps the installed `cors` package: `credentials: true`,
  `origin = CORS_ORIGIN` in prod; permissive in dev (Vite proxy is same-origin).
- Cookie helpers `setSessionCookie(res, uid)` / `clearSessionCookie(res)` — single
  source of truth for flags: `HttpOnly` always; `Secure` + `SameSite=Lax` in prod.
- `rateLimit(opts)` — small in-memory fixed-window limiter, ~40 lines, no new
  dependency. Keyed independently per-phone and per-IP. Pluggable store interface
  (in-memory default; Redis adapter later). Applied to `/api/auth/otp/send` and
  `/api/auth/otp/verify`.

**Cookie same-site nuance (verified):** `marketplace.anvastech.in` and
`supabase-marketplace.anvastech.in` share the registrable domain `anvastech.in`,
so browser requests between them are **same-site**. `SameSite=Lax` therefore works
cross-subdomain; the riskier `SameSite=None` is not needed.

### `server/otp/provider.mjs`
Pluggable delivery seam:

- `OtpProvider` interface: `send({ phone, code, purpose })`.
- `ConsoleSink` (default) — logs the code; acceptable for staging, never real users.
- `SmsProvider` interface documented for a later adapter (Twilio / MSG91 / SNS),
  selected by env. No concrete provider ships in this pass (per decision).

### `server/auth.mjs` (rewrite of the code path, same exports where possible)
- `issueOtpChallenge` now: generate a cryptographically-random 6-digit code, store
  its **HMAC-SHA256(pepper) hash** with `expiresAt` (5 min), `attempts: 0`,
  `used: false`, keyed by normalized phone; deliver via the provider.
- `verifyOtp(phone, code)`: constant-time hash compare, TTL check, single-use
  (delete/mark on success), attempt cap (e.g. 5) → then invalidate.
- The fixed-code path exists **only when `EWORKS_ENV=dev`**. In production the dev
  branch is unreachable, so `123456` / `654321` cannot authenticate.
- Store is the same in-memory Map today, behind an interface so a Redis store can
  replace it without touching callers. (Restart loses pending challenges — user
  simply re-requests a code; acceptable.)

### MFA
Reuses the OTP engine. MFA-required users (`userRequiresMfa`, unchanged) receive a
second server-generated code through the same provider after OTP verification —
no separate fixed code. TOTP is a documented future option, out of scope now.

---

## 4. Route-level changes in `bff.mjs`

- Mount `corsMiddleware()` before routes.
- Replace inline cookie writes with the `security.mjs` helpers.
- Apply `rateLimit` to the two OTP endpoints.
- Wrap `/api/dev/*` route registration in `if (!isProd)` so they return 404 in prod.
- Error responses: include `detail: err.message` only when `!isProd`; prod returns
  the stable machine code (e.g. `{ error: 'query_failed' }`) with no internals.
- Add `GET /api/health` → `{ ok: true }` for pm2 / reverse-proxy checks.
- Port and startup log read from `env.mjs`.

The RLS seam (`withUserSession`, `set local role`, `app.user_id`) is unchanged.

---

## 5. Process management & config templates

- `web/server/ecosystem.config.cjs` — pm2, **fork mode** (single instance so the
  in-memory limiter/store are authoritative), restart-on-boot, env injected on the
  server (never from the repo).
- Documented `systemd` unit alternative in the runbook section.
- `web/server/.env.production.example` — **placeholders only**, no secret values:
  `EWORKS_ENV`, `PORT`, `CORS_ORIGIN`, `OTP_PEPPER`, DB connection vars, provider
  selection.

---

## 6. Testing (TDD)

Each security guarantee gets a unit test; these are the reason the change exists.

- OTP: generate → hash stored (never plaintext) → verify success; wrong code fails;
  expired (TTL) fails; single-use (second verify fails); attempt cap invalidates.
- Rate limiter: allows under limit, blocks over limit, window resets, per-phone and
  per-IP keys are independent.
- Cookies: dev flags vs prod flags matrix (`Secure` present iff prod; `HttpOnly`
  always).
- CORS: allowed origin passes; other origins rejected in prod.
- Prod lockdown: `/api/dev/*` returns 404 when `isProd`; error responses omit
  `detail` when `isProd`.
- Fixed dev codes: rejected when `EWORKS_ENV=production`.

Run via the existing `vitest` setup.

---

## 7. Definition of done (this pass)

- `EWORKS_ENV=production` boot: fixed OTP/MFA codes rejected; `/api/dev/*` gone;
  cookies `Secure`+`HttpOnly`; CORS locked to the frontend origin; OTP endpoints
  rate-limited; error `detail` suppressed; missing secrets abort boot.
- `EWORKS_ENV=dev` boot: local flow unchanged (Vite proxy, dev codes work).
- All new unit tests pass; existing suite still green.
- No secret value committed; `.env.production.example` is placeholders only.
- RLS untouched.

---

## 8. Out of scope (later passes)

Tasks 1–4, 6, 7 of the deployment prompt: server hardening, self-hosted Supabase,
schema migration against the live DB + `eworks_authenticated`/`eworks_notifier`
roles, Caddy + HTTPS, GitHub Actions (deploy + separate manual migrations), and
off-server backups. Each becomes its own spec + runbook, since execution requires
server/DNS/secret access this pass deliberately does not touch.
