# E-Works Construction Testing & Certification Marketplace

Implementation of `eworks-testing-marketplace-master-prompt.md`.

**372 checks pass** — against local PostgreSQL 18 + PostGIS 3.6.2 (`bash scripts/db-test.sh`)
and against a live Supabase project (`bash scripts/supabase-verify.sh`).

- **Phase 0 — complete and verified.** Auth/RLS/audit spine plus the configurable test catalog.
- **Phase 1 — complete and verified.** Vendors, KYC, capabilities, NABL eligibility, geo-radius matching.
- **Phase 2 — complete and verified.** Non-overlapping price windows, effective price resolution, vendor service catalog.
- **Phase 3 — complete and verified.** Requirement planner (IS 456 ladder evaluated from `jsonb`), sealed RFQ orders, order state machine, eligibility-scoped vendor order board.
- **Phase 4 — complete and verified.** Commit–reveal sealed bidding, timed close, reveal verification, forfeiture, re-check of accreditation at award, atomic single-winner L1.
- **Phase 5 — complete and verified.** Geo-fenced check-in, serialized QR, per-specimen hash-chained custody, data-driven pass/fail, escalation, certificates, idempotent treasury payment held until certificate.
- **Phase 6a — complete and verified.** Notification events, payload-free
  recipient fan-out, and a plain outbox drained with `FOR UPDATE SKIP LOCKED`.
- **Phase 6b/6c — not started.** Vendor ratings, analytics.
- **No frontend exists yet.**

## What exists

| Migration | Contents |
|---|---|
| `…000100_extensions.sql` | `ltree`, `pgcrypto`, `eworks` schema |
| `…000200_org_units.sql` | 8-level org hierarchy, materialized ltree path, GiST index, path cascade |
| `…000300_identity.sql` | users, roles, permissions, `in_scope()`, `has_permission()` |
| `…000400_audit_log.sql` | append-only hash-chained audit log, `verify_audit_chain()` |
| `…000500_rls.sql` | row-level security policies |
| `…000600_test_catalog.sql` | catalog, stage rules, per-project requirements |
| `…000700_seed_reference_data.sql` | 8 roles, 13 permissions, 9 stages, 12 tests, IS-code rules |
| `…000800_vendors.sql` | PostGIS, vendors, KYC documents, capabilities, pricing, `match_vendors_for_test()` |
| `…000900_pricing_integrity.sql` | non-overlapping price windows, `vendor_effective_price()`, `vendor_service_catalog` |
| `…001000_requirement_planner.sql` | `compute_sample_count()`, `resolve_stage_rule()`, `generate_project_requirements()` |
| `…001100_test_orders.sql` | sealed RFQ orders, order items, status state machine, `float_order()`, `eligible_vendors_for_order()` |
| `…001200_sealed_bids.sql` | commit–reveal bids, `close_bidding()`, `reveal_bid()`, `finalize_award()`, pg_cron sweepers |
| `…001300_ground_execution.sql` | `check_in()` (server geofence), serialized QR samples, per-specimen hash-chained `chain_of_custody` |
| `…001400_results_certificates_payments.sql` | pass/fail engine, escalations, certificates, `hold_payment()` / `release_payment()` |
| `…20260710000100_notifications.sql` | events, payload-free fan-out, outbox, `claim_deliveries()` / `complete_delivery()` |

The master prompt's §13 puts only the catalog in Phase 0. The catalog is useless
without the spine every later phase depends on, and that spine did not exist, so
it is built here.

## Running the tests locally

Requires PostgreSQL 15+ with `ltree` and `pgcrypto`. PostGIS is required for
Phases 1–5; without it, `db-test.sh` skips those migrations and tests and says
so loudly rather than reporting a misleading green.

```bash
bash scripts/db-test.sh          # DROPS and rebuilds $PGDATABASE (default: eworks)
```

Defaults to `127.0.0.1:5433`, user `postgres`. Override with the standard
`PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` variables.

The checks cover, among others:

- a Coimbatore officer reads zero Salem rows, and cannot enumerate Salem staff
- a Section engineer reaches down into their subtree but not sideways to a sibling
- an unauthenticated connection sees zero rows in every table
- a District Officer cannot grant themselves `HEAD_ADMIN` — denied **by RLS**, and
  the test first asserts the `INSERT` privilege is actually held, so it cannot
  pass because of a missing `GRANT`
- modifying, mid-deleting, or prefix-deleting an audit row is detected
- tail-truncating the audit log is **not** detected (asserted as a known limitation)
- renaming a mid-tree org unit cascades every descendant path
- IS 456's concrete sampling ladder lives in `jsonb`, not in an `if` chain
- a lab holding a role in a district still cannot read a competitor's row
- a vendor with lapsed NABL is excluded from a NABL test, but not from a non-NABL one
- two overlapping price windows for one (vendor, test) are impossible
- `vendor_service_catalog` is `security_invoker`, so it cannot be read around RLS
- the IS 456 ladder computed from `jsonb`: 50 m³ → 4 samples, 51 m³ → 5 ("or part thereof")
- a stricter district QAP overrides the state-wide rule for that district only
- an order cannot jump `DRAFT → AWARDED`, skipping the auction
- a vendor sees a floated order only while eligible for **every** item in it
- a vendor cannot see `DRAFT` orders or the project's planned test calendar
- a committed bid stores **no price at all** — not even a superuser can read one
- revealing a lower price than committed, or a wrong nonce, is rejected
- an officer sees **zero bids** (not even the count) while an order is `FLOATED`
- a bidder who never reveals is `FORFEITED`; one whose NABL lapsed mid-auction is `DISQUALIFIED`
- an order with no qualified revealed bid `FAILS` rather than awarding
- a second award for the same order is impossible (primary key, not application logic)
- a check-in 907 m from the site is refused; the server computes the distance, the client never supplies it
- a site photo cannot be reused on a second job (global hash uniqueness)
- a specimen's custody chain is independent: breaking one does not invalidate another
- a result cannot be recorded for a specimen never received at the lab, or whose custody chain is broken
- the same 30 N/mm² passes on an M25 project and fails on M45 — with no code change
- a 7-day failure is provisional and does **not** escalate; a 28-day failure does
- payment releases on a **failing** result once certified, and a lab cannot release its own payment
- a vendor notified of a floated order, whose NABL then lapses, still holds the
  notification and reads **zero rows** from `test_orders` — a dead link, not a leak
- a vendor who never revealed is told nothing at award; the reveal notice it did
  receive is what the forfeiture rests on
- `eworks_authenticated` holds no privilege at all on the delivery outbox
- a delivery that exhausts its retries becomes `DEAD` and is never deleted
- a worker cannot report on a delivery it never claimed, nor on one another
  worker holds, nor re-report one it already finished
- a `DEAD` delivery cannot be resurrected, and keeps its error
- a claim abandoned past the visibility timeout is reclaimed; a fresh one is not

## Applying the schema to Supabase

```bash
cp .env.example .env               # then fill in SUPABASE_DB_URL
bash scripts/supabase-push.sh      # applies all migrations in one transaction
bash scripts/supabase-verify.sh    # runs every check, then removes its fixtures
```

`supabase-push.sh` refuses to run if an `eworks` schema already exists (the
migrations are not idempotent). `supabase-verify.sh` refuses to run if
`org_units` has any rows, so it cannot pollute a project holding real data —
point it at a scratch project.

Prefer to paste it by hand? `bash scripts/gen-bundle.sh` writes
`supabase/bundle/eworks_full_schema.sql`, a single file for the SQL editor.

Two Supabase facts worth internalising:

- The **`service_role` key bypasses RLS entirely.** Every policy in this project
  becomes decorative on a connection that uses it. It belongs only in server-side
  code that genuinely has no user identity, such as the `pg_cron` bid-close job.
- Hosted Supabase is **not MeitY-empanelled**, so it is a development and staging
  target. Nothing in the schema depends on Supabase-managed schemas, so a NIC or
  State Data Centre PostgreSQL takes the same migrations unchanged.

## Deliberate divergences from the master prompt

Each of these is a decision, not an oversight. Reasoning in `docs/security-gaps.md`.

1. **Plain PostgreSQL, not Supabase-coupled.** Data residency (§0, §14) is
   unresolved and hosted Supabase is not MeitY-empanelled.
2. **PostGIS arrives with `vendors`, not in the first migration.** Creating an
   unused extension would break migrations on clusters that lack the binaries.
3. **Sealed bids use commit–reveal**, not encrypt-at-rest. §9's "un-openable even
   by admin" is false under encrypt-at-rest, because whoever holds the key can
   open early. Under commit–reveal the database holds only a digest, so the claim
   is literally true. The cost is a reveal window and a forfeit rule, which
   belongs in your tender conditions, not just in code.
4. **The audit log is tamper-*evident*, not tamper-*proof*.** A superuser can
   disable a trigger. The chain makes that loud, not impossible.
5. **`vendor.read` and `order.read` are permissions, not org scope.** A lab
   vendor holds a role anchored at its own district, so `in_scope()` is true for
   them on that district's paths. Any policy gating reads on scope alone lets
   every lab enumerate its competitors (`vendors`) and read the district's whole
   RFQ pipeline including unfloated `DRAFT` orders (`test_orders`,
   `project_test_requirements`). Both were real bugs, both caught by tests, both
   pinned by regression tests in `03_vendors.sql` and `05_planner_and_orders.sql`.

   The rule: **`in_scope()` answers "where", never "whether."** A read policy
   must name a permission. The only safe bare use of `in_scope()` is combined
   with one, as `audit_logs_read` does.

6. **Payment is for the test, not for a pass.** §12 holds payment until a valid
   certificate exists — not until the concrete passes. A lab paid only when the
   cube passes has a direct financial incentive to report a pass. Release is
   gated on a signature-verified certificate and complete results, never on
   `passed = true`. A failure escalates for engineering sign-off; it does not
   block, and it does not withhold the lab's fee.

7. **A plain outbox table, not `pgmq`.** §7 names pgmq; pgmq is tables and
   functions over `FOR UPDATE SKIP LOCKED`. A plain table gives identical
   semantics with no extension, so these migrations still run unchanged on a NIC
   or State Data Centre cluster — the same argument as divergence 1 — and Phase
   6a stays verifiable by `db-test.sh` on a stock PostgreSQL.

8. **Notifications carry no payload.** A recipient row names an event, never an
   order's content. §11 asks for a fast feed; a denormalised title would deliver
   one and would also become a disclosure channel that bypasses `test_orders`'
   RLS, permanently, for a vendor who has since become ineligible. The row is a
   pointer, and following it goes through live RLS.

## Operational notes

- **RLS refuses by making rows invisible, not by raising.** An `UPDATE` a user is
  not allowed to make against a row hidden by a `USING` clause affects zero rows
  and returns success. The BFF **must** check the affected row count and surface a
  403, or a denied write looks like a completed one.
- **Audit appends are serialized** by an advisory lock, so the hash chain cannot
  fork. This is the real cost of a linear chain.
- **RLS constrains rows, not transitions.** `test_orders` has a trigger enforcing
  the legal status graph, because an officer who may update an order could
  otherwise move it `DRAFT → AWARDED` and skip bidding entirely.
- **Order eligibility is recomputed per row, never cached.** Revoking a vendor's
  accreditation hides the order from them immediately; a materialised eligibility
  table would leave a window where a lapsed lab still sees live work.
- **Bids are placed only through functions.** `eworks_authenticated` holds no
  `INSERT`/`UPDATE` on `order_bids`; a direct write would bypass the window
  check, the eligibility lock, and the hash verification at once.
- **Bidding closes on wall-clock, not on the sweeper.** A bid arriving after
  `bid_close_at` is refused even if `pg_cron` is lagging.
- **`pg_cron` is not installed by these migrations.** Enable it, then schedule
  `sweep_close_bidding()` and `sweep_finalize_awards()`; both are idempotent, so
  a missed tick self-heals.
- **Supabase is not a superuser environment.** `postgres` holds `CREATEROLE`, not
  superuser. Since PG16, creating a role grants `ADMIN` but not `SET`, so
  `SET ROLE` fails until membership is granted `WITH SET TRUE`. Migration 000500
  does this, guarded by a version check.
- **Supabase puts extensions in an `extensions` schema.** Any `SECURITY INVOKER`
  function calling `digest()` or `st_distance()` runs as the caller, so
  `eworks_authenticated` needs `USAGE` there — otherwise it fails with the
  thoroughly misleading "function digest(bytea, unknown) does not exist".
  `SECURITY DEFINER` functions hide this bug because they run as the owner.
- **Notifications are not audited.** The state change that produced each one
  already is, and `audit_logs_seal()` serialises every append behind an advisory
  lock. Fanning out inside it would put the PostGIS radius query behind the one
  global lock at exactly the bid-broadcast spike.
- **`notifications` is partition-ready, not partitioned.** The key is
  `(created_at, id)` and nothing references `notifications.id` alone. When you do
  partition, note that a partition queried **directly** enforces only its own
  grants and policies — never the parent's.
- **A delivery worker's authority is its claim, never a delivery id.**
  `complete_delivery()` refuses to act on a row the caller does not currently
  hold, and `DEAD` is terminal against both entry points. Ids are sequential
  bigints; treating one as authority would let a compromised SMS worker forge or
  destroy the record of a reveal notice, and that record is what a forfeited
  vendor's deposit turns on.
- **A claim abandoned for five minutes is reaped.** A worker that dies after
  claiming would otherwise strand a notice with no operator-visible signal.
  `select * from eworks.notification_deliveries where status = 'DEAD'` remains
  the "who did we fail to reach" report.
