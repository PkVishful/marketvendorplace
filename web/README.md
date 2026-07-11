# E-Works — Web (frontend)

Vite + React + TypeScript. Exercises the real PostgreSQL backend through a dev BFF with HTTP-only session cookies and row-level security.

Modern **Tamil Nadu e-gov** visual theme: navy header, saffron/green/gold accents, DM Sans + Source Serif 4.

## What's built

| Portal | Routes | Status |
|--------|--------|--------|
| **Sign-in** | `/sign-in` | Phone + OTP + MFA (gov officers) · dev persona picker |
| **Public** | `/verify`, `/verify/:certId` | Certificate authenticity check (no login) |
| **Vendor** | `/vendor/orders`, `/vendor/orders/:id`, `/vendor/jobs`, `/vendor/jobs/:id`, `/vendor/notifications`, `/vendor/earnings` | Full vendor + field flow |
| **Government** | `/gov`, `/gov/planner`, `/gov/orders`, `/gov/orders/:id`, `/gov/vendors`, `/gov/quality`, `/gov/ratings`, `/gov/analytics`, `/gov/audit` | Full procurement cycle + analytics |

## Run it locally

The `eworks` database must be up (docker Postgres on `127.0.0.1:5433`) with migrations applied:

```bash
bash scripts/db-test.sh    # from repo root
cd web
npm install
npm run seed               # demo notifications + floated order + verified cert
npm run bff                # terminal 1: dev BFF on :8787
npm run dev                # terminal 2: Vite on :5173
```

Open http://localhost:5173/sign-in:

- **Phone sign-in:** e.g. `9000000002` (District Officer) → OTP `123456` → MFA `654321`
- **Dev personas tab:** quick-switch fixture users

Public verify demo: http://localhost:5173/verify/cccc3333-0000-0000-0000-000000000001

```bash
npm test          # Vitest + RTL
npm run build     # tsc -b && vite build
```

## Architecture

```
server/          dev BFF (Express + pg) + auth.mjs + dev seed
src/app/         shell, layouts, routing, sign-in
src/auth/        cookie-aware session + OTP hooks
src/features/
  public/        certificate QR verify
  auth/          phone OTP sign-in UI
  notifications/ feed (Phase 6a)
  orders/        vendor order board, detail, sealed bidding
  jobs/          field jobs, geo check-in, QR bind, custody, results, certificate
  earnings/      vendor payment ledger (held / released)
  gov/           planner, RFQ, award, KYC, fulfillment, quality, ratings, analytics, audit
src/lib/         apiClient, bidCrypto, qrCode, deviceId, time utils
src/i18n/        en + ta
```

All data goes through `/api/*` → BFF → `withUserSession()` → RLS. No tokens in JS.

Dev helpers: `POST /api/dev/orders/:id/advance` skips auction clocks locally (`reveal` | `award`).

## Next slice

Production BFF swap (Supabase Edge Functions), real SMS OTP, and mobile offline field capture
