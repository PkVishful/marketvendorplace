# Award → Job Assignment — Design

*Status: approved 2026-07-21.*

Closes the gap between winning a tender and executing the field job. Today,
awarding an order does not create a `test_jobs` row and there is no app path to
create one (the seed inserts jobs directly; `test_jobs` grants only `SELECT` to
app users). So a winning lab sees an empty jobs list and cannot check in. This
adds a self-service **accept the award** step that creates the job with the
vendor owner as its technician.

## Decisions

- **Technician model: owner self-assigns (MVP).** Accepting the award makes the
  vendor owner the job's technician; they perform check-in. Matches today's
  reality (one seed `FIELD_TECHNICIAN`; a vendor is effectively its owner).
  Team assignment can come later.
- **DB target: local Docker Postgres** (`docker start eworks-pg`, `127.0.0.1:5433`).
  The migration is applied and tested there; the shared remote Supabase is left
  untouched.

## Goal / definition of done

- A vendor that wins a tender can, from the app, accept the award and land on a
  field job ready for check-in — no manual DB insert.
- The full chain check-in → sample → custody → result → certificate → payment
  works from that job (already proven; this only wires the missing first step).
- `npm run test`, `npm run lint`, `tsc -b` green in `web/`. DB-gated tests pass
  against the local cluster.
- No changes to the shared remote schema.

## Relevant existing mechanics

- `eworks.test_jobs (order_id, vendor_id, technician_id, status)` — `status`
  defaults to `ASSIGNED`; `unique (order_id)` (one job per order).
- Trigger `test_jobs_award_trg` → `test_jobs_award_check()`: a job may be
  inserted only when the order is `AWARDED` and `vendor_id` equals the
  `order_award` winner. This already blocks losers and wrong vendors.
- `eworks.order_award (order_id, vendor_id, ...)` records the winner.
- `eworks.vendors.owner_user_id` links a vendor to its owner user.
- `eworks.user_won_order(uuid)` (migration `20260716000100`) lets the winner read
  their `AWARDED` order (RLS helper, `SECURITY DEFINER`).
- `eworks.check_in(job_id, ...)` requires `technician_id = current_user_id()`.
- `test_jobs` is `grant select` only to `eworks_authenticated` — inserts must go
  through a `SECURITY DEFINER` function (the pattern used by `float_order`,
  `submit_bid_commitment`, `check_in`).

## Layer 1 — Migration `20260721000100_assign_job.sql`

```
create or replace function eworks.assign_job(p_order_id uuid)
returns eworks.test_jobs
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
```

Logic:
1. Load the order; error if not found.
2. Error unless `status = 'AWARDED'`.
3. Resolve the winning vendor from `order_award`; error if the order has no
   award row.
4. Assert the caller owns the winning vendor:
   `vendors.owner_user_id = eworks.current_user_id()` for that vendor id;
   else raise with `errcode = 'insufficient_privilege'`.
5. Insert `test_jobs (order_id, vendor_id, technician_id)` with
   `technician_id = eworks.current_user_id()`; return the row.

The award-check trigger re-validates AWARDED + winner; the `unique (order_id)`
constraint makes a second accept fail (caught and surfaced as "already started").
`grant execute on function eworks.assign_job(uuid) to eworks_authenticated;`

Idempotency/UX: the BFF treats a unique-violation as "job already exists" and
returns the existing job rather than a hard error.

## Layer 2 — BFF (`web/server/bff.mjs`)

- `POST /api/vendor/orders/:id/accept` — inside `withUserSession`; calls
  `select * from eworks.assign_job($1)`. On success returns
  `{ jobId, status }`. On `unique_violation` (already accepted) returns the
  existing job's `{ jobId, status }` with 200. Other errors → 400.
- Extend `GET /api/vendor/orders/:id`: add `jobId` — the id of this vendor's
  `test_jobs` row for the order (or null). Lets the detail page route to the job.
- Extend `GET /api/vendor/jobs`: in addition to existing jobs, return
  awarded-unstarted orders the caller won — `test_orders` where `status='AWARDED'`,
  `eworks.user_won_order(id)`, and no `test_jobs` row yet. Shape them as
  `{ orderId, milestone, requiredBy, awaitingAccept: true }` in a separate
  `awaiting` array (existing jobs stay in the primary array unchanged).

## Layer 3 — Frontend (`web/src/features/`)

- `jobs/api.ts` + hook: `acceptAward(orderId)` → POST accept; `useAcceptAward`
  mutation invalidating the jobs + order queries. Jobs list type gains an
  `awaiting` array.
- **Field jobs page** (`jobs/JobsPage.tsx`): a new "Awarded — ready to start"
  section above the job list; each entry shows milestone + required-by and an
  **Accept & start job** button → `acceptAward` → navigate to
  `/vendor/jobs/:jobId`.
- **Vendor order/tender detail** (`orders/OrderDetailPage.tsx`): when the order
  is `AWARDED` and readable (i.e. the caller won): if `jobId` is null show
  **Accept & start job**; if set show **Go to job**.
- i18n: `jobs.awaitingTitle`, `jobs.acceptStart`, `jobs.goToJob`,
  `jobs.accepting`, plus an order-detail `won` label — in `en.json` and
  `ta.json`, keys identical.

## Layer 4 — Tests

- `web/server/assign-job.db.test.mjs` (DB-gated, `describe.skipIf(!dbAvailable)`
  against `127.0.0.1:5433`): winner → job created (`status = ASSIGNED`);
  non-winner → `insufficient_privilege`; second accept → returns same job (no
  duplicate); non-`AWARDED` order → rejected.
- `web/server/bff.test.mjs` (or the vendor suite): the accept route is mounted
  and rejects an unauthenticated caller.
- RTL: Field jobs page renders the "awaiting" section and calls `acceptAward`
  with the order id on click.

## Out of scope

- Team/technician management (assigning someone other than the owner).
- Reassigning or unassigning a job once accepted.
- Changes to the shared remote schema.
