# Award → Job Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a vendor that wins a tender accept the award from the app, creating the field job (owner becomes technician) so check-in → result → certificate → payment is fully self-service.

**Architecture:** A new `SECURITY DEFINER` function `eworks.assign_job` performs the gated `test_jobs` insert (app users only have SELECT on `test_jobs`). A BFF accept route calls it; the vendor Field-jobs page and order-detail page surface an "Accept & start job" action. The migration is applied and tested against the local Docker Postgres only.

**Tech Stack:** PostgreSQL (PostGIS) via Docker on `127.0.0.1:5433`; Node + Express 5 BFF with `pg`; React 19 + TypeScript, TanStack Query, react-i18next; Vitest + RTL. Working dir for `npm`/`node` commands: `web/`.

## Global Constraints

- **Local Docker Postgres only** (`docker start eworks-pg`, `127.0.0.1:5433/eworks`, user/pass `postgres`). Do NOT touch the shared remote Supabase schema.
- **Owner self-assigns:** the accepting user becomes the job's `technician_id`. No team/technician picker.
- App users have `grant select` only on `eworks.test_jobs`; inserts MUST go through a `SECURITY DEFINER` function.
- Integrity is already enforced by `test_jobs_award_trg` (AWARDED + winner) and `unique (order_id)` (one job per order). Do not duplicate those checks beyond what the function needs for good error messages.
- All user-facing strings in `en.json` and `ta.json`, keys identical.
- DoD: `npm run test`, `npm run lint`, `npx tsc -b` green; DB-gated tests pass with the local cluster up; the accept flow works in the running app.

## File Structure

- `supabase/migrations/20260721000100_assign_job.sql` *(create)* — the `assign_job` function + grant.
- `web/server/assign-job.db.test.mjs` *(create)* — DB-gated function behavior.
- `web/server/bff.mjs` *(modify)* — accept route; `jobId` on vendor order detail; `awaiting` on vendor jobs list.
- `web/src/types/domain.ts` *(modify)* — `jobId` on `VendorOrderDetail`; `AwaitingJob` type; jobs-list response shape.
- `web/src/features/jobs/api.ts` + `useJobs.ts` *(modify)* — `acceptAward`, `useAcceptAward`, jobs-list returns `{ jobs, awaiting }`.
- `web/src/features/jobs/JobsPage.tsx` *(modify)* — "Awarded — ready to start" section.
- `web/src/features/jobs/JobsPage.test.tsx` *(create)* — RTL for the awaiting section + accept.
- `web/src/features/orders/OrderDetailPage.tsx` *(modify)* — AWARDED accept/go-to-job block.
- `web/src/features/orders/api.ts` + `useOrders.ts` *(modify)* — reuse `acceptAward` (import from jobs) or add a thin wrapper; invalidate order + jobs queries.
- `web/src/i18n/en.json`, `web/src/i18n/ta.json` *(modify)* — `jobs.awaitingTitle`, `jobs.acceptStart`, `jobs.accepting`, `jobs.goToJob`, `orders.youWon`.

---

## Task 1: `assign_job` migration + DB-gated test

**Files:**
- Create: `supabase/migrations/20260721000100_assign_job.sql`
- Create: `web/server/assign-job.db.test.mjs`

**Interfaces:**
- Produces SQL function: `eworks.assign_job(p_order_id uuid) returns eworks.test_jobs`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260721000100_assign_job.sql`:

```sql
-- Self-service award acceptance. Awarding an order records a winner in
-- order_award but does not create the field job, and app users hold only
-- SELECT on test_jobs -- so the winning lab could never start work. This lets
-- the winner's owner accept the award, creating the job with themselves as the
-- technician (MVP: a vendor is effectively its owner).
--
-- SECURITY DEFINER because the insert needs privileges the caller lacks, but it
-- re-derives the winner from order_award and checks ownership against the
-- caller -- it never trusts a passed-in vendor or technician. The award-check
-- trigger and unique(order_id) still backstop it.
create or replace function eworks.assign_job(p_order_id uuid)
returns eworks.test_jobs
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_order  eworks.test_orders;
  v_vendor uuid;
  v_owns   boolean;
  v_job    eworks.test_jobs;
begin
  select * into v_order from eworks.test_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.status <> 'AWARDED' then
    raise exception 'order % is % and has no award to accept', p_order_id, v_order.status;
  end if;

  select vendor_id into v_vendor from eworks.order_award where order_id = p_order_id;
  if v_vendor is null then
    raise exception 'order % has no recorded award', p_order_id;
  end if;

  select exists (
    select 1 from eworks.vendors v
     where v.id = v_vendor and v.owner_user_id = eworks.current_user_id()
  ) into v_owns;
  if not v_owns then
    raise exception 'only the winning vendor''s owner may accept order %', p_order_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into eworks.test_jobs (order_id, vendor_id, technician_id)
  values (p_order_id, v_vendor, eworks.current_user_id())
  returning * into v_job;

  return v_job;
end;
$$;

grant execute on function eworks.assign_job(uuid) to eworks_authenticated;
```

- [ ] **Step 2: Apply the migration to the local cluster**

Run:
```bash
docker exec -i eworks-pg psql -U postgres -d eworks < supabase/migrations/20260721000100_assign_job.sql
```
Expected: `CREATE FUNCTION` then `GRANT`.

- [ ] **Step 3: Write the DB-gated test**

Create `web/server/assign-job.db.test.mjs`. It reuses the local seed: pick an AWARDED order that has an `order_award` winner and no `test_jobs` row yet, resolve that vendor's owner, and drive `assign_job` under RLS via `withUserSession`.

```js
// @vitest-environment node
// assign_job against the REAL local Postgres (scripts/db-test.sh: 127.0.0.1:5433).
// Skips cleanly when the local cluster is down.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

process.env.EWORKS_USE_LOCAL_PG = process.env.EWORKS_USE_LOCAL_PG || '1';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5433';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'eworks';

const probe = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE, connectionTimeoutMillis: 1500, max: 2,
});

let dbAvailable = false;
let target = null; // { orderId, vendorId, ownerId }
let hasFn = false;
try {
  const fn = await probe.query(`select 1 from pg_proc where proname = 'assign_job'`);
  hasFn = fn.rowCount === 1;
  const q = await probe.query(`
    select o.id as "orderId", oa.vendor_id as "vendorId", v.owner_user_id as "ownerId"
      from eworks.test_orders o
      join eworks.order_award oa on oa.order_id = o.id
      join eworks.vendors v on v.id = oa.vendor_id
     where o.status = 'AWARDED'
       and not exists (select 1 from eworks.test_jobs j where j.order_id = o.id)
       and v.owner_user_id is not null
     limit 1`);
  target = q.rows[0] ?? null;
  dbAvailable = hasFn && Boolean(target);
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('assign_job against real Postgres', () => {
  let withUserSession, pool, otherOwner;

  beforeAll(async () => {
    ({ withUserSession, pool } = await import('./db.mjs'));
    // An owner of a DIFFERENT vendor, to prove the non-winner path.
    const o = await probe.query(
      `select owner_user_id from eworks.vendors
        where owner_user_id is not null and id <> $1 limit 1`, [target.vendorId]);
    otherOwner = o.rows[0].owner_user_id;
  });

  afterAll(async () => { await probe.end(); await pool.end(); });

  it('lets the winning owner create the job with themselves as technician', async () => {
    const job = await withUserSession(target.ownerId, async (client) => {
      const r = await client.query(`select * from eworks.assign_job($1)`, [target.orderId]);
      return r.rows[0];
    });
    expect(job.order_id).toBe(target.orderId);
    expect(job.vendor_id).toBe(target.vendorId);
    expect(job.technician_id).toBe(target.ownerId);
    expect(job.status).toBe('ASSIGNED');
  });

  it('rejects a second accept (one job per order)', async () => {
    await expect(withUserSession(target.ownerId, (client) =>
      client.query(`select * from eworks.assign_job($1)`, [target.orderId]),
    )).rejects.toThrow(/test_jobs_one_per_order|duplicate key/);
  });

  it('rejects an owner who did not win the order', async () => {
    // Use a fresh AWARDED-unstarted order for a clean check.
    const fresh = await probe.query(`
      select o.id from eworks.test_orders o
        join eworks.order_award oa on oa.order_id = o.id
       where o.status = 'AWARDED'
         and not exists (select 1 from eworks.test_jobs j where j.order_id = o.id)
       limit 1`);
    if (fresh.rowCount === 0) return; // nothing left to assert against
    await expect(withUserSession(otherOwner, (client) =>
      client.query(`select * from eworks.assign_job($1)`, [fresh.rows[0].id]),
    )).rejects.toThrow(/only the winning vendor|insufficient/i);
  });
});
```

- [ ] **Step 4: Run the DB-gated test**

Run: `npx vitest run server/assign-job.db.test.mjs`
Expected: PASS (3 tests). Note: the first test creates a real job row in the local DB; that is fine (local, disposable). If it was already run, the "second accept" invariant still holds. If you need a clean slate, re-seed with `bash scripts/db-test.sh` from repo root.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721000100_assign_job.sql web/server/assign-job.db.test.mjs
git commit -m "feat(jobs): assign_job function to accept an award into a field job"
```

---

## Task 2: BFF accept route + order/jobs extensions

**Files:**
- Modify: `web/server/bff.mjs`

**Interfaces:**
- Produces: `POST /api/vendor/orders/:id/accept` → `{ jobId, status }`.
- Modifies: `GET /api/vendor/orders/:id` adds `jobId`; `GET /api/vendor/jobs` returns `{ jobs, awaiting }`.

- [ ] **Step 1: Add the accept route**

In `web/server/bff.mjs`, immediately after the `POST /api/vendor/orders/:id/bid/reveal` handler closes (near line 512), add:

```js
  app.post('/api/vendor/orders/:id/accept', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const row = await withUserSession(userId, async (client) => {
        try {
          const q = await client.query(
            `select id, status from eworks.assign_job($1)`,
            [req.params.id],
          );
          return q.rows[0];
        } catch (err) {
          // Already accepted (unique(order_id)) -> return the existing job so
          // the client can just route to it. Any other error propagates.
          if (err.code === '23505') {
            const existing = await client.query(
              `select id, status from eworks.test_jobs where order_id = $1`,
              [req.params.id],
            );
            if (existing.rowCount > 0) return existing.rows[0];
          }
          throw err;
        }
      });
      res.status(201).json({ jobId: row.id, status: row.status });
    } catch (err) {
      res.status(400).json({ error: 'accept_failed', detail: err.message });
    }
  });
```

- [ ] **Step 2: Add `jobId` to the vendor order detail**

In the `GET /api/vendor/orders/:id` handler, after the `bidQ` query and before the `return { ...orderQ.rows[0], ... }`, add a job lookup and include it:

```js
        const jobQ = await client.query(
          `select j.id from eworks.test_jobs j
             join eworks.vendors v on v.id = j.vendor_id
            where j.order_id = $1 and v.owner_user_id = eworks.current_user_id()
            limit 1`,
          [req.params.id],
        );
```

Then change the return object to include `jobId: jobQ.rows[0]?.id ?? null`:

```js
        return {
          ...orderQ.rows[0],
          items: itemsQ.rows,
          myBid: bidQ.rows[0] ?? null,
          jobId: jobQ.rows[0]?.id ?? null,
        };
```

- [ ] **Step 3: Return awarded-unstarted orders from the jobs list**

Replace the body of `GET /api/vendor/jobs` so it returns both existing jobs and awaited acceptances. The awaiting query relies on `eworks.user_won_order(id)` (migration `20260716000100`) so only the winner sees them:

```js
      const data = await withUserSession(userId, async (client) => {
        const jobsQ = await client.query(
          `select
             j.id,
             j.status,
             j.order_id      as "orderId",
             o.milestone,
             o.required_by   as "requiredBy",
             st_y(o.site::geometry) as lat,
             st_x(o.site::geometry) as lng,
             (select count(*)::int from eworks.samples s where s.job_id = j.id) as "sampleCount"
           from eworks.test_jobs j
           join eworks.test_orders o on o.id = j.order_id
          order by j.created_at desc`,
        );
        const awaitingQ = await client.query(
          `select
             o.id            as "orderId",
             o.milestone,
             o.required_by   as "requiredBy"
           from eworks.test_orders o
          where o.status = 'AWARDED'
            and eworks.user_won_order(o.id)
            and not exists (select 1 from eworks.test_jobs j where j.order_id = o.id)
          order by o.required_by asc nulls last`,
        );
        return { jobs: jobsQ.rows, awaiting: awaitingQ.rows };
      });
      res.json(data);
```

- [ ] **Step 4: Restart the BFF and smoke-test the route wiring**

Run (kill any listener on 8787 first, then):
```bash
node server/bff.mjs & sleep 3
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8787/api/vendor/orders/x/accept -H 'content-type: application/json' -d '{}'
```
Expected: `401` (no session) — proves the route is mounted and guarded. (A full functional check happens in Task 5.)

- [ ] **Step 5: Run server tests + lint**

Run: `npx vitest run server/bff.test.mjs && npx oxlint server/bff.mjs`
Expected: PASS; no new lint errors.

- [ ] **Step 6: Commit**

```bash
git add web/server/bff.mjs
git commit -m "feat(jobs): accept-award route + jobId on order detail + awaiting on jobs list"
```

---

## Task 3: Frontend types, api, hooks

**Files:**
- Modify: `web/src/types/domain.ts`
- Modify: `web/src/features/jobs/api.ts`, `web/src/features/jobs/useJobs.ts`
- Modify: `web/src/features/orders/api.ts`, `web/src/features/orders/useOrders.ts`

**Interfaces:**
- Produces types: `AwaitingJob`, `FieldJobsResponse`; `VendorOrderDetail.jobId`.
- Produces api: `acceptAward(orderId)`; `fetchFieldJobs()` returns `FieldJobsResponse`.
- Produces hooks: `useAcceptAward()`.

- [ ] **Step 1: Update types in `web/src/types/domain.ts`**

Add `jobId` to `VendorOrderDetail`:

```ts
export interface VendorOrderDetail extends Omit<VendorOrderSummary, 'itemCount'> {
  evalMethod: string;
  orgName: string;
  items: OrderItemDTO[];
  myBid: VendorBidDTO | null;
  jobId: string | null;
}
```

Add near `FieldJobSummary`:

```ts
export interface AwaitingJob {
  orderId: string;
  milestone: string;
  requiredBy: string;
}

export interface FieldJobsResponse {
  jobs: FieldJobSummary[];
  awaiting: AwaitingJob[];
}
```

- [ ] **Step 2: Update `web/src/features/jobs/api.ts`**

Change the jobs fetch return type and add accept:

```ts
import type { AwaitingJob, CustodyEvent, FieldJobDetail, FieldJobsResponse } from '@/types/domain';
```
(keep the other imports; add `AwaitingJob`, `FieldJobsResponse`, drop the now-unused `FieldJobSummary` import only if TypeScript flags it.)

```ts
export function fetchFieldJobs() {
  return apiClient.get<FieldJobsResponse>('/api/vendor/jobs');
}

export function acceptAward(orderId: string) {
  return apiClient.post<{ jobId: string; status: string }>(`/api/vendor/orders/${orderId}/accept`, {});
}
```

- [ ] **Step 3: Update `web/src/features/jobs/useJobs.ts`**

`useFieldJobs` now returns `FieldJobsResponse`. Add `useAcceptAward`:

```ts
import { acceptAward, /* …existing… */ } from './api';

export function useAcceptAward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: acceptAward,
    onSuccess: (_data, orderId) => {
      void qc.invalidateQueries({ queryKey: jobKeys.all });
      void qc.invalidateQueries({ queryKey: ['vendor', 'orders', orderId] });
    },
  });
}
```

- [ ] **Step 4: Order-detail invalidation (orders feature)**

In `web/src/features/orders/useOrders.ts`, add a hook the order page can use (reuses the jobs api accept):

```ts
import { acceptAward } from '@/features/jobs/api';

export function useAcceptOrderAward(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => acceptAward(orderId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vendor', 'orders', orderId] });
      void qc.invalidateQueries({ queryKey: ['vendor', 'jobs'] });
    },
  });
}
```
(If `useOrders.ts` does not already import `useMutation`/`useQueryClient` from `@tanstack/react-query`, add them.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b`
Expected: errors ONLY where `JobsPage` still treats `useFieldJobs().data` as an array — those are fixed in Task 4. If other files consume `fetchFieldJobs`, update them to read `.jobs`. Resolve until `tsc -b` is clean after Task 4.

- [ ] **Step 6: Commit**

```bash
git add web/src/types/domain.ts web/src/features/jobs/api.ts web/src/features/jobs/useJobs.ts web/src/features/orders/useOrders.ts
git commit -m "feat(jobs): accept-award api, hooks, and response types"
```

---

## Task 4: Field-jobs "accept & start" UI + order-detail block + i18n + test

**Files:**
- Modify: `web/src/features/jobs/JobsPage.tsx`
- Create: `web/src/features/jobs/JobsPage.test.tsx`
- Modify: `web/src/features/orders/OrderDetailPage.tsx`
- Modify: `web/src/i18n/en.json`, `web/src/i18n/ta.json`

**Interfaces:**
- Consumes: `useFieldJobs` (now `FieldJobsResponse`), `useAcceptAward`, `useAcceptOrderAward`.

- [ ] **Step 1: i18n keys (en.json)**

Under the existing `jobs` block add:

```json
"awaitingTitle": "Awarded — ready to start",
"acceptStart": "Accept & start job",
"accepting": "Starting…",
"goToJob": "Go to job"
```

Under the `orders` block add:

```json
"youWon": "You won this tender"
```

- [ ] **Step 2: i18n keys (ta.json)** — same keys:

```json
"awaitingTitle": "ஒப்படைக்கப்பட்டது — தொடங்கத் தயார்",
"acceptStart": "ஏற்று வேலையைத் தொடங்கு",
"accepting": "தொடங்குகிறது…",
"goToJob": "வேலைக்குச் செல்"
```
and under `orders`:
```json
"youWon": "இந்த டெண்டரில் நீங்கள் வென்றீர்கள்"
```

- [ ] **Step 3: Write the failing RTL test `web/src/features/jobs/JobsPage.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { FieldJobsResponse } from '@/types/domain';
import { JobsPage } from './JobsPage';
import * as api from './api';

vi.mock('./api', async (o) => ({
  ...(await o<typeof api>()),
  fetchFieldJobs: vi.fn(),
  acceptAward: vi.fn(async () => ({ jobId: 'job-new', status: 'ASSIGNED' })),
}));

const resp: FieldJobsResponse = {
  jobs: [],
  awaiting: [{ orderId: 'ord-1', milestone: 'Cube pour', requiredBy: '2026-08-20' }],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter><JobsPage /></MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(api.fetchFieldJobs).mockResolvedValue(resp));
afterEach(cleanup);

describe('JobsPage — accept award', () => {
  it('shows awarded-ready-to-start orders with an accept button', async () => {
    renderPage();
    expect(await screen.findByText('Cube pour')).toBeInTheDocument();
    expect(screen.getByText(/Awarded — ready to start/)).toBeInTheDocument();
  });

  it('calls acceptAward with the order id when accepted', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: /Accept & start job/ });
    await userEvent.click(btn);
    await waitFor(() => expect(api.acceptAward).toHaveBeenCalledWith('ord-1'));
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/features/jobs/JobsPage.test.tsx`
Expected: FAIL — page still reads `data` as an array; no awaiting section.

- [ ] **Step 5: Update `web/src/features/jobs/JobsPage.tsx`**

```tsx
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { JobStatusPill } from './JobStatusPill';
import { useAcceptAward, useFieldJobs } from './useJobs';
import { formatDate } from '@/lib/time';
import type { AwaitingJob } from '@/types/domain';

export function JobsPage() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useFieldJobs();

  if (isPending) return <FeedSkeleton />;

  if (isError) {
    return (
      <div className="gov-card border-l-4 border-l-danger p-8 text-center">
        <p className="font-semibold text-danger">{t('states.errorTitle')}</p>
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
          {t('states.retry')}
        </button>
      </div>
    );
  }

  const jobs = data?.jobs ?? [];
  const awaiting = data?.awaiting ?? [];

  if (jobs.length === 0 && awaiting.length === 0) {
    return (
      <div className="gov-card p-12 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-surface-2 text-2xl text-ink-3">
          ◉
        </div>
        <p className="mt-4 font-display text-lg font-bold">{t('jobs.emptyTitle')}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">{t('jobs.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {awaiting.length > 0 && (
        <section>
          <h3 className="gov-label mb-3">{t('jobs.awaitingTitle')}</h3>
          <ul className="flex flex-col gap-3">
            {awaiting.map((a) => (
              <li key={a.orderId}>
                <AwaitingCard awaiting={a} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {jobs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                to={`/vendor/jobs/${job.id}`}
                className="gov-card block border-l-4 border-l-green p-0 transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-navy"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 p-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg font-bold text-ink">{job.milestone}</p>
                    <p className="mt-1 font-mono text-xs text-ink-3">
                      {job.id.slice(0, 8).toUpperCase()} · {job.sampleCount} {t('jobs.samples')}
                    </p>
                  </div>
                  <JobStatusPill status={job.status} />
                </div>
                <div className="grid grid-cols-2 gap-px border-t border-hair bg-hair">
                  <div className="bg-surface-2 px-4 py-3">
                    <p className="gov-label">{t('orders.requiredBy')}</p>
                    <p className="mt-0.5 text-sm font-semibold">{formatDate(job.requiredBy)}</p>
                  </div>
                  <div className="bg-surface px-4 py-3">
                    <p className="text-xs font-semibold text-navy">{t('jobs.viewDetail')} →</p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AwaitingCard({ awaiting }: { awaiting: AwaitingJob }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accept = useAcceptAward();
  return (
    <div className="gov-card border-l-4 border-l-accent p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold text-ink">{awaiting.milestone}</p>
          <p className="mt-1 text-xs text-ink-3">
            {t('orders.requiredBy')}: {formatDate(awaiting.requiredBy)}
          </p>
        </div>
        <button
          type="button"
          className="gov-btn-primary"
          disabled={accept.isPending}
          onClick={() =>
            accept.mutate(awaiting.orderId, {
              onSuccess: (r) => navigate(`/vendor/jobs/${r.jobId}`),
            })
          }
        >
          {accept.isPending ? t('jobs.accepting') : t('jobs.acceptStart')}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the RTL test to green**

Run: `npx vitest run src/features/jobs/JobsPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Add the AWARDED block to `web/src/features/orders/OrderDetailPage.tsx`**

Add imports at the top:
```tsx
import { Link, useNavigate } from 'react-router-dom';
import { useAcceptOrderAward } from './useOrders';
```
(Adjust the existing `react-router-dom` import to include `useNavigate`; keep `Link`.)

Immediately after the `</header>` closes (before the stats grid), insert:

```tsx
      {order.status === 'AWARDED' && <AwardBlock order={order} />}
```

And add this component at the bottom of the file:

```tsx
function AwardBlock({ order }: { order: VendorOrderDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accept = useAcceptOrderAward(order.id);
  return (
    <div className="mt-6 gov-card border-l-4 border-l-accent p-5">
      <p className="font-display text-lg font-bold text-ink">{t('orders.youWon')}</p>
      <div className="mt-3">
        {order.jobId ? (
          <Link to={`/vendor/jobs/${order.jobId}`} className="gov-btn-primary inline-flex">
            {t('jobs.goToJob')}
          </Link>
        ) : (
          <button
            type="button" className="gov-btn-primary" disabled={accept.isPending}
            onClick={() => accept.mutate(undefined, { onSuccess: (r) => navigate(`/vendor/jobs/${r.jobId}`) })}
          >
            {accept.isPending ? t('jobs.accepting') : t('jobs.acceptStart')}
          </button>
        )}
      </div>
    </div>
  );
}
```
Add `import type { VendorOrderDetail } from '@/types/domain';` if not already present, and ensure `useTranslation` is imported.

- [ ] **Step 8: Typecheck, lint, and full jobs/orders tests**

Run: `npx tsc -b && npx oxlint src/features/jobs src/features/orders && npx vitest run src/features/jobs src/features/orders`
Expected: clean; all pass.

- [ ] **Step 9: Commit**

```bash
git add web/src/features/jobs/JobsPage.tsx web/src/features/jobs/JobsPage.test.tsx web/src/features/orders/OrderDetailPage.tsx web/src/i18n/en.json web/src/i18n/ta.json
git commit -m "feat(jobs): accept-award UI on field jobs + order detail"
```

---

## Task 5: Full green + live verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite, lint, typecheck**

Run: `npm run test && npm run lint && npx tsc -b`
Expected: all green (DB-gated `assign-job.db.test.mjs` passes with the local cluster up).

- [ ] **Step 2: i18n parity**

Run: `node -e "const a=require('./src/i18n/en.json'),b=require('./src/i18n/ta.json');const k=o=>Object.keys(o).flatMap(x=>o[x]&&typeof o[x]==='object'?k(o[x]).map(y=>x+'.'+y):[x]);const ka=new Set(k(a)),kb=new Set(k(b));const miss=[...ka].filter(x=>!kb.has(x)).concat([...kb].filter(x=>!ka.has(x)));console.log(miss.length?('MISMATCH: '+miss.join(', ')):'i18n keys match');"`
Expected: `i18n keys match`.

- [ ] **Step 3: Live check against the LOCAL cluster**

The remote lacks `assign_job`, so run the app against the local DB for this check: start the BFF with `EWORKS_USE_LOCAL_PG=1 node server/bff.mjs` and Vite. As a winning vendor (find one via the awaiting query), open Field jobs → confirm an "Awarded — ready to start" card → click "Accept & start job" → lands on the job detail ready for check-in. Then confirm re-opening the order shows "Go to job".

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git add -A && git commit -m "chore(jobs): award-acceptance verification"
```

---

## Self-Review

**Spec coverage:**
- assign_job SECURITY DEFINER (winner-owner gate, AWARDED, insert) → Task 1. ✅
- Accept route with idempotent already-accepted handling → Task 2 Step 1. ✅
- `jobId` on order detail → Task 2 Step 2 + Task 3 Step 1. ✅
- Awaiting list via `user_won_order` → Task 2 Step 3. ✅
- Field-jobs accept UI + order-detail accept/go-to-job → Task 4. ✅
- i18n en/ta → Task 4 Steps 1–2. ✅
- DB-gated + RTL tests → Tasks 1, 4. ✅
- Local-DB-only, no remote schema change → Global Constraints + Task 5 Step 3. ✅

**Placeholder scan:** No TBD/TODO; every code step is complete. "Adjust the existing import" notes name the exact file and symbol to reconcile — deliberate, since the surrounding imports already exist.

**Type consistency:** `acceptAward` returns `{ jobId, status }` in api, hooks, and both call sites. `FieldJobsResponse = { jobs, awaiting }` is produced by the BFF (Task 2 Step 3), typed in Task 3 Step 1, and consumed in Task 4 Step 5. `VendorOrderDetail.jobId` is added server-side (Task 2 Step 2) and in the type (Task 3 Step 1) before use (Task 4 Step 7). `useAcceptAward` (jobs) vs `useAcceptOrderAward` (orders) are distinct hooks with the names used consistently at their call sites.
