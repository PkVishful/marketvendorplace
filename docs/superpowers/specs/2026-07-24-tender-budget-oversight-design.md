# Tender & Budget Oversight — Design (Cycle A)

*Status: approved 2026-07-24. Part of the "Head Admin Oversight" build. This is
**Cycle A of two**; Cycle B (Field Work Monitor) is a separate spec.*

## Goal

Let the state head admin — and, scoped down, a district officer — **see every
tender's money end to end**: floated → bids → award → payment, at four zoom
levels (state → district → order → line), with drill-through to raw evidence and
the audit chain. Read-only screens over existing data, plus one additive column.

## Decisions (resolved during brainstorming)

1. **Sequence:** build Tenders & Budget first (this spec). Field Work Monitor is
   a later cycle.
2. **"District admin" = `DISTRICT_OFFICER`.** No `DISTRICT_ADMIN` role exists;
   the existing district-anchored gov role is scoped by `in_scope()` already. No
   new role migration.
3. **Permission gate = `order.read`.** No `analytics.read` permission exists;
   `order.read` is held by HEAD_ADMIN, DISTRICT_OFFICER, AUDITOR and matches how
   the current Analytics tab is gated.
4. **Auditor can export.** The spec's "no export without `analytics.read`" is moot
   since that permission does not exist; export serves the same scope-filtered
   data the user can already see, so it is gated on `order.read` like everything
   else.
5. **"Field work" sub-tab** ships now as a disabled "coming soon" stub so the
   Oversight nav matches the two-sub-tab intent; it becomes live in Cycle B.

## Ground truth (verified against the local DB, 2026-07-24)

- **Money model:**
  - `eworks.order_bids`: `commitment bytea` (sealed), `revealed_price_paise
    bigint` (NULL until reveal), `revealed_at`, `status`.
  - `eworks.order_award`: `order_id, bid_id, vendor_id, price_paise,
    qualified_bid_count, awarded_at, awarded_by`.
  - `eworks.payments`: `order_id, vendor_id, amount_paise, status`
    (HELD/RELEASED…), `released_at`, `created_at`, `gst_invoice_no`,
    `treasury_ref`.
  - `eworks.order_status` enum: `DRAFT, FLOATED, REVEALING, AWARDED, CANCELLED,
    FAILED`. Current seed: 65 AWARDED, 45 FLOATED.
- **`test_orders` has no estimate column** → the one additive migration is
  genuinely needed.
- `eworks.settings` exists (holds thresholds).
- Existing `web/server/area-queries.mjs` already joins `payments` and
  `order_award` per order; the analytics endpoint (`/api/gov/analytics`) already
  rolls up `paymentsHeldPaise`, `paymentsReleasedPaise`, awarded counts. These
  are the single source of truth to extend — do not fork new rollup logic.

## Scope

**In (Cycle A):**
- `/gov/oversight` shell with a top tab strip: **Tenders & budget** (live),
  **Field work** (disabled stub).
- One additive migration + planner input + seed backfill for estimates.
- Finance BFF endpoints (summary, districts, orders, order detail, vendors,
  flags, CSV export).
- Finance screens: overview (summary strip + district table + flags panel),
  order ledger + detail, vendor earnings lens.
- Sealed-bid confidentiality enforced server-side, tested both sides of close.
- Nav + tab-visibility entry; en + ta; a11y; mobile-usable.

**Out (Cycle B, separate spec):** field activity feed, today's jobs board,
map overlay, job evidence sheet, and field-specific anomaly flags
(geofence FAIL, custody gap).

## Migration + seed (the one allowed migration)

- `supabase/migrations/<ts>_order_estimate.sql`:
  `alter table eworks.test_orders add column estimated_amount_paise bigint;`
  Nullable, no default, commented. Applied to the **local** DB only; the shared
  remote Supabase is not touched (repo is the source of truth for the eworks
  schema).
- **Planner input:** an optional "Officer estimate (₹)" field in the float flow
  (`PlannerPage` / the float endpoint) writes `estimated_amount_paise`.
- **Seed backfill:** give a subset of awarded orders an estimate ≈ award ×
  (1.05–1.25) so savings reads positive and realistic; deliberately leave some
  NULL so "missing estimates are excluded, not zeroed" is exercised on screen and
  in tests.

## BFF endpoints

All read-only, inside `withUserSession`, gated on `order.read`, scope-filtered by
`in_scope()`. Lists are paginated (no unbounded queries). Rollups reuse the
Area/analytics money SQL.

| Endpoint | Returns |
|---|---|
| `GET /api/gov/oversight/finance/summary` | floated (count + est value), bids received (commitment count), awarded value, savings (Σ est − Σ award over orders **with** estimates), payments held, payments released, **failed value** (Σ estimate — or award where present — of `FAILED`/`CANCELLED` orders) + open-escalation count |
| `GET /api/gov/oversight/finance/districts` | one row per district with the summary columns; scope-filtered |
| `GET /api/gov/oversight/finance/orders` | paginated ledger: estimate, bid count, L1 award, awarded vendor, payment status |
| `GET /api/gov/oversight/finance/orders/:id` | estimate, revealed bids **with vendor names (only if bidding closed)**, L1 award, awarded vendor, payment (held since / released on / amount), certificate link, audit links |
| `GET /api/gov/oversight/finance/vendors` | per-vendor totals: awarded, paid, pending |
| `GET /api/gov/oversight/flags` | finance anomaly flags (see below) |
| `GET /api/gov/oversight/finance/export.csv?table=…` | CSV of `summary\|districts\|orders\|vendors`, scope-respecting, numbers matching the screen |

## Sealed-bid confidentiality (hard rule)

Bid amounts are exposed **only** when bidding has closed:
`order.status ∈ {REVEALING, AWARDED, FAILED, CANCELLED}` **and**
`revealed_price_paise IS NOT NULL`.

For `FLOATED` / `DRAFT` orders the endpoints return `sealed: true` and a plain
commitment **count**, and **never** any amount (no count-with-amounts). The UI
shows "sealed — opens after close." Enforced in SQL so no path leaks reveal data
early, **including to HEAD_ADMIN**. Tested explicitly on both sides of close.

## Frontend (`web/src/features/gov/oversight/`)

- **OversightPage / layout** — top tab strip; "Tenders & budget" active, "Field
  work" disabled stub.
- **FinanceOverview** — summary KPI strip; district table (row → same view scoped
  to that district, drill consistent with `/gov/area`); "Needs attention" flags
  panel.
- **OrderLedger** — paginated ledger; row → order detail pane.
- **OrderFinanceDetail** — estimate → bids (`sealed` placeholder or revealed rows
  with vendor names) → L1/award → payment (held since / released on / amount) →
  certificate link; each entry links its audit-log row.
- **VendorEarningsLens** — per-vendor totals (awarded / paid / pending),
  cross-linked from the ledger.
- Per-table **CSV export** buttons.
- Reuses `formatInr`, `Pagination`, `StatusPill`, gov-card styles, and the
  `/gov/area` drill pattern. en + ta, a11y, mobile-usable.

## Anomaly flags (finance subset)

Computed server-side, advisory only (no enforcement):
- job/tender-money anomalies: **single-bidder awards**; **repeated
  vendor+officer** award share above a configurable threshold; **award > estimate
  by > X %** (threshold in `eworks.settings`).
- **integrity alerts** (DB-impossible by constraint, so any hit is a red alert):
  payment released without certificate; certificate without passing results.
  Renders the offending row in red and links the audit-chain segment.

Each flag deep-links to the order finance detail.

## Component boundaries (isolation)

- **rollup SQL module** — pure query builders shared with Area/analytics; one
  source of truth for money math.
- **finance model (TS)** — savings math (NULL estimates excluded), sealed-gating
  predicate, CSV row shaping; pure and unit-tested.
- **endpoints** — thin wrappers: auth → model/SQL → JSON/CSV.
- **presentational components** — take data + callbacks, no fetching logic.

## Tests & definition of done (Cycle A)

- **Scope:** a district officer cannot fetch another district's summary / ledger;
  auditor hits only read-only paths.
- **Sealed-bid:** a FLOATED order with committed bids → finance endpoints return
  no amounts and the UI shows "sealed"; after close + reveal → amounts appear.
  Verified for HEAD_ADMIN too.
- **Savings math:** unit-tested including missing estimates (excluded, not
  zeroed).
- **CSV export** matches the on-screen numbers for each table.
- `npm run test`, `npm run lint`, `tsc -b` green; en + ta present; overview and
  ledger usable on mobile.
- **Demo:** head admin opens Oversight → Tenders & budget, reads an order's
  estimate → bids → L1 award → held payment, drills to the district, and exports
  the district CSV; a FLOATED order shows "sealed".
