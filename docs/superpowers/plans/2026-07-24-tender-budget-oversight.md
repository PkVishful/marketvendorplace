# Tender & Budget Oversight — Implementation Plan (Cycle A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give HEAD_ADMIN and (scoped) DISTRICT_OFFICER a read-only "Tenders & budget" screen showing every tender's money end to end — floated → bids → award → payment — at four zoom levels, with sealed-bid confidentiality and finance anomaly flags.

**Architecture:** Money rollups live in a new server query module (`oversight-queries.mjs`) plus a pure helper module (`oversight-finance.mjs`), mirroring the existing `area-queries.mjs`/`area.db.test.mjs` split. Thin BFF endpoints wrap them inside `withUserSession` (RLS enforces `in_scope()` automatically). A new `web/src/features/gov/oversight/` React feature renders the screens, reusing `apiClient`, `Pagination`, `formatInr`, and `StatusPill`.

**Tech Stack:** Node/Express (`.mjs`), PostgreSQL + PostGIS (`eworks` schema), Vite + React 19 + TypeScript, TanStack Query, Tailwind, vitest, i18next (en + ta).

## Global Constraints

- **Scope is enforced by RLS, not by hand.** Every query runs inside `withUserSession(userId, …)`, which does `set local role eworks_authenticated` + sets `app.user_id`. A plain `SELECT` already returns only in-scope rows; do **not** add manual org filters.
- **Permission gate:** finance/oversight endpoints require the caller to hold `order.read`. Reuse `requireUser(req, res)` for auth; there is no per-permission middleware — gating is by nav visibility + RLS (a user without in-scope orders simply sees zero rows).
- **Sealed-bid rule (absolute):** bid amounts may be returned ONLY when `order.status IN ('REVEALING','AWARDED','FAILED','CANCELLED')` AND `revealed_price_paise IS NOT NULL`. For `FLOATED`/`DRAFT`, return `sealed: true` + a commitment count, never an amount. Applies to HEAD_ADMIN too.
- **Money is always `*_paise` (bigint).** `pg` returns bigint as a string — always wrap with `Number(...)` before returning JSON, exactly as `/api/gov/analytics` does.
- **One migration only:** the additive `estimated_amount_paise` column. No other schema changes.
- **i18n:** every user-facing string uses a `t('…')` key present in BOTH `web/src/i18n/en.json` and `web/src/i18n/ta.json`.
- **DB tests** carry `// @vitest-environment node`, self-skip when local Postgres is down, and import query modules directly (see `web/server/area.db.test.mjs`). Local DB: `127.0.0.1:5433`, user `postgres`, db `eworks` (`docker start eworks-pg`).
- **Commands:** from `web/`: `npm test` (vitest), `npm run lint` (oxlint), `npx tsc -b` (typecheck). All must be green at the end.

---

## File Structure

**Create:**
- `supabase/migrations/20260724000100_order_estimate.sql` — the estimate column.
- `web/server/oversight-finance.mjs` — pure helpers: `computeSavings`, `isBiddingClosed`, `toCsv`. No DB, no imports from `db.mjs`.
- `web/server/oversight-queries.mjs` — DB query functions: `financeSummary`, `financeDistricts`, `financeOrders`, `financeOrderDetail`, `financeVendors`, `oversightFlags`. Each takes a `client`.
- `web/server/oversight-finance.test.mjs` — pure unit tests.
- `web/server/oversight.db.test.mjs` — DB integration tests.
- `web/src/features/gov/oversight/oversightApi.ts` — fetch functions + `oversightKeys`.
- `web/src/features/gov/oversight/useOversight.ts` — TanStack Query hooks.
- `web/src/features/gov/oversight/financeModel.ts` — pure client helpers (paise formatting wrappers, sealed labels).
- `web/src/features/gov/oversight/financeModel.test.ts` — unit tests.
- `web/src/features/gov/oversight/OversightPage.tsx` — shell + tab strip.
- `web/src/features/gov/oversight/FinanceOverview.tsx` — summary strip + district table + flags.
- `web/src/features/gov/oversight/FlagsPanel.tsx` — "Needs attention" list.
- `web/src/features/gov/oversight/OrderLedger.tsx` — paginated ledger + detail pane.
- `web/src/features/gov/oversight/OrderFinanceDetail.tsx` — one order's money chain.
- `web/src/features/gov/oversight/VendorEarningsLens.tsx` — per-vendor totals.

**Modify:**
- `web/server/bff.mjs` — register 7 oversight endpoints; accept estimate in the float route.
- `web/server/seed-dev.mjs` — backfill estimates on a subset of awarded orders.
- `web/src/App.tsx` — add `<Route path="oversight" …>`.
- `web/src/lib/navConfig.ts` — nav item + `GOV_NAV_TAB_KEYS` entry.
- `web/src/features/gov/rfq/RfqPipelineView.tsx` — optional estimate input on the float action.
- `web/src/features/gov/GovOrdersPage.tsx` — thread estimate through `onFloat`.
- `web/src/features/gov/api.ts` + `useGov.ts` — `floatGovOrder` accepts an estimate.
- `web/src/types/domain.ts` — oversight DTO types.
- `web/src/i18n/en.json`, `web/src/i18n/ta.json` — `oversight.*` keys.

---

## Task 1: Estimate column + seed backfill

**Files:**
- Create: `supabase/migrations/20260724000100_order_estimate.sql`
- Modify: `web/server/seed-dev.mjs`
- Test: manual SQL assertions (no vitest — this is schema+seed)

**Interfaces:**
- Produces: `eworks.test_orders.estimated_amount_paise bigint` (nullable); a seeded mix of orders with and without estimates.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260724000100_order_estimate.sql`:

```sql
-- Officer's pre-tender cost estimate, set when an order is floated. Nullable:
-- older orders and orders floated without an estimate simply have none, and the
-- savings rollup excludes them (never treats a missing estimate as zero).
alter table eworks.test_orders
  add column estimated_amount_paise bigint;

comment on column eworks.test_orders.estimated_amount_paise is
  'Officer cost estimate at float time (paise). NULL = not estimated; excluded from savings.';
```

- [ ] **Step 2: Apply the migration to the local DB**

Run:
```bash
docker exec -i eworks-pg psql -U postgres -d eworks < supabase/migrations/20260724000100_order_estimate.sql
```
Expected: `ALTER TABLE` then `COMMENT`.

- [ ] **Step 3: Verify the column exists**

Run:
```bash
docker exec eworks-pg psql -U postgres -d eworks -tAc "select data_type from information_schema.columns where table_schema='eworks' and table_name='test_orders' and column_name='estimated_amount_paise';"
```
Expected: `bigint`

- [ ] **Step 4: Add the seed backfill function**

In `web/server/seed-dev.mjs`, add this function near the other seed helpers (after `ensureDevIdentity`):

```js
// Backfill officer estimates on ~70% of awarded orders so the savings rollup has
// signal; the rest stay NULL on purpose, to prove missing estimates are excluded
// (not zeroed). Deterministic (seq parity), so re-running is idempotent.
async function seedOrderEstimates(client) {
  await client.query(`
    update eworks.test_orders o
       set estimated_amount_paise = round(oa.price_paise * (1.05 + (('x'||substr(md5(o.id::text),1,4))::bit(16)::int % 21) / 100.0))
      from eworks.order_award oa
     where oa.order_id = o.id
       and o.status = 'AWARDED'
       and (('x'||substr(md5(o.id::text),1,2))::bit(8)::int % 10) < 7
  `);
}
```

- [ ] **Step 5: Call it from the seed's main run**

In `web/server/seed-dev.mjs`, find where `ensureDevIdentity(client)` is awaited inside the main seeding transaction and add, right after it:

```js
  await seedOrderEstimates(client);
```

- [ ] **Step 6: Run the seed and verify a mix exists**

Run:
```bash
cd web && node server/seed-dev.mjs
docker exec eworks-pg psql -U postgres -d eworks -tAc "select count(*) filter (where estimated_amount_paise is not null) as with_est, count(*) filter (where estimated_amount_paise is null and status='AWARDED') as awarded_without from eworks.test_orders;"
```
Expected: `with_est` > 0 AND `awarded_without` > 0 (a genuine mix).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260724000100_order_estimate.sql web/server/seed-dev.mjs
git commit -m "feat(oversight): add order estimate column + seed backfill"
```

---

## Task 2: Float route + planner UI accept an estimate

**Files:**
- Modify: `web/server/bff.mjs:1448-1469` (float route)
- Modify: `web/src/features/gov/api.ts` (`floatGovOrder`), `web/src/features/gov/useGov.ts` (`useFloatGovOrder`)
- Modify: `web/src/features/gov/GovOrdersPage.tsx`, `web/src/features/gov/rfq/RfqPipelineView.tsx`
- Test: `web/server/oversight.db.test.mjs` (one test; file created here, extended later)

**Interfaces:**
- Produces: `POST /api/gov/orders/:id/float` accepts optional `{ estimatedAmountPaise?: number }` and persists it before floating. `floatGovOrder(orderId, estimatedAmountPaise?)`.

- [ ] **Step 1: Write the failing DB test**

Create `web/server/oversight.db.test.mjs`:

```js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { withUserSession, pool } from './db.mjs';

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
let headAdmin = null;
try {
  headAdmin = (await probe.query(
    `select user_id as "userId" from eworks.user_roles where role_code='HEAD_ADMIN' limit 1`)).rows[0] ?? null;
  dbAvailable = Boolean(headAdmin);
} catch { dbAvailable = false; }
const maybe = dbAvailable ? describe : describe.skip;

afterAll(async () => { await probe.end(); await pool.end(); });

maybe('order estimate persistence', () => {
  it('an UPDATE to estimated_amount_paise sticks and reads back', async () => {
    const order = (await probe.query(
      `select id from eworks.test_orders where status='AWARDED' limit 1`)).rows[0];
    const readBack = await withUserSession(headAdmin.userId, async (client) => {
      await client.query(
        `update eworks.test_orders set estimated_amount_paise=$2 where id=$1`,
        [order.id, 12345600]);
      const q = await client.query(
        `select estimated_amount_paise as est from eworks.test_orders where id=$1`, [order.id]);
      return Number(q.rows[0].est);
    });
    expect(readBack).toBe(12345600);
  });
});
```

- [ ] **Step 2: Run it to verify it passes** (this proves the column + RLS write path before wiring the endpoint)

Run: `cd web && npx vitest run server/oversight.db.test.mjs`
Expected: PASS (1 test). If local DB is down it SKIPS — start it with `docker start eworks-pg`.

- [ ] **Step 3: Make the float route accept an estimate**

In `web/server/bff.mjs`, replace the body of the float route (lines ~1448-1469) so it persists the estimate before floating:

```js
  app.post('/api/gov/orders/:id/float', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const raw = req.body?.estimatedAmountPaise;
    const estimate = raw === undefined || raw === null || raw === '' ? null : Number(raw);
    if (estimate !== null && (!Number.isFinite(estimate) || estimate < 0)) {
      return res.status(400).json({ error: 'bad_estimate' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        if (estimate !== null) {
          await client.query(
            `update eworks.test_orders set estimated_amount_paise = $2 where id = $1`,
            [req.params.id, estimate]);
        }
        const q = await client.query(
          `select
             id,
             status,
             floated_at        as "floatedAt",
             bid_close_at      as "bidCloseAt",
             reveal_close_at   as "revealCloseAt"
           from eworks.float_order($1)`,
          [req.params.id],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(400).json({ error: 'float_failed', detail: err.message });
    }
  });
```

- [ ] **Step 4: Thread the estimate through the client fetcher**

In `web/src/features/gov/api.ts`, find `floatGovOrder` and change it to accept an optional estimate:

```ts
export function floatGovOrder(orderId: string, estimatedAmountPaise?: number) {
  return apiClient.post<GovOrderSummary>(`/api/gov/orders/${orderId}/float`, {
    estimatedAmountPaise,
  });
}
```

- [ ] **Step 5: Thread it through the hook**

In `web/src/features/gov/useGov.ts`, find `useFloatGovOrder` and change its `mutationFn` to pass an object `{ orderId, estimatedAmountPaise }`:

```ts
export function useFloatGovOrder(projectId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, estimatedAmountPaise }: { orderId: string; estimatedAmountPaise?: number }) =>
      floatGovOrder(orderId, estimatedAmountPaise),
    onSuccess: (_data, { orderId }) => {
      void qc.invalidateQueries({ queryKey: govKeys.orders(projectId) });
      void qc.invalidateQueries({ queryKey: govKeys.orders() });
      void qc.invalidateQueries({ queryKey: govKeys.orderDetail(orderId) });
    },
  });
}
```

- [ ] **Step 6: Update the caller signature in `GovOrdersPage.tsx`**

In `web/src/features/gov/GovOrdersPage.tsx`, change `onFloat` to take an estimate and pass the object shape:

```tsx
  async function onFloat(orderId: string, estimatedAmountPaise?: number) {
    setMessage(null);
    try {
      const row = await floatOrder.mutateAsync({ orderId, estimatedAmountPaise });
      setMessage({ tone: 'good', text: t('govOrders.floatedOk', { close: formatDeadline(row.bidCloseAt) }) });
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof Error ? err.message : t('govOrders.floatFailed') });
    }
  }
```

And update the prop passed to `RfqPipelineView`:

```tsx
      onFloat={(id, est) => void onFloat(id, est)}
```

- [ ] **Step 7: Add the estimate input to the float action in `RfqPipelineView.tsx`**

In `web/src/features/gov/rfq/RfqPipelineView.tsx`, change the `onFloat` prop type to `(orderId: string, estimatedAmountPaise?: number) => void`. Add local state near the top of the component:

```tsx
  const [estimateRupees, setEstimateRupees] = useState<Record<string, string>>({});
```

Replace the DRAFT-row float button (`canFloat` branch) with an inline estimate field + button:

```tsx
                        {canFloat ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              min="0"
                              inputMode="numeric"
                              placeholder={t('govOrders.estimatePlaceholder')}
                              aria-label={t('govOrders.estimateLabel')}
                              className="gov-input w-24 text-xs"
                              value={estimateRupees[o.id] ?? ''}
                              onChange={(e) =>
                                setEstimateRupees((m) => ({ ...m, [o.id]: e.target.value }))
                              }
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              type="button"
                              className="gov-btn-primary text-xs"
                              disabled={floatPending}
                              onClick={(e) => {
                                e.stopPropagation();
                                const rupees = estimateRupees[o.id];
                                const paise = rupees ? Math.round(Number(rupees) * 100) : undefined;
                                onFloat(o.id, paise);
                              }}
                            >
                              {floatPending ? t('govOrders.floating') : t('govOrders.float')}
                            </button>
                          </div>
                        ) : canOpen ? (
```

Add `useState` to the React import at the top of the file if not present, and add the two i18n keys in Step 8.

- [ ] **Step 8: Add i18n keys**

In `web/src/i18n/en.json` under `govOrders`, add:
```json
    "estimatePlaceholder": "Est. ₹",
    "estimateLabel": "Officer estimate in rupees",
```
Add the same two keys under `govOrders` in `web/src/i18n/ta.json`.

- [ ] **Step 9: Typecheck + test**

Run: `cd web && npx tsc -b && npx vitest run server/oversight.db.test.mjs`
Expected: tsc exit 0; test PASS.

- [ ] **Step 10: Commit**

```bash
git add web/server/bff.mjs web/src/features/gov/api.ts web/src/features/gov/useGov.ts web/src/features/gov/GovOrdersPage.tsx web/src/features/gov/rfq/RfqPipelineView.tsx web/src/i18n/en.json web/src/i18n/ta.json web/server/oversight.db.test.mjs
git commit -m "feat(oversight): float an order with an optional officer estimate"
```

---

## Task 3: Pure finance helpers

**Files:**
- Create: `web/server/oversight-finance.mjs`
- Test: `web/server/oversight-finance.test.mjs`

**Interfaces:**
- Produces:
  - `computeSavings(rows)` — `rows: {estimatePaise: number|null, awardPaise: number|null}[]` → `{ estimatedPaise, awardedPaise, savingsPaise }` summing ONLY rows where both are present.
  - `isBiddingClosed(status)` — `true` for `REVEALING|AWARDED|FAILED|CANCELLED`.
  - `toCsv(headers, rows)` — `headers: string[]`, `rows: (string|number|null)[][]` → RFC-4180 CSV string.

- [ ] **Step 1: Write failing unit tests**

Create `web/server/oversight-finance.test.mjs`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computeSavings, isBiddingClosed, toCsv } from './oversight-finance.mjs';

describe('computeSavings', () => {
  it('sums only rows with both estimate and award; ignores nulls (not zeroed)', () => {
    const r = computeSavings([
      { estimatePaise: 100, awardPaise: 80 },
      { estimatePaise: null, awardPaise: 50 }, // excluded
      { estimatePaise: 200, awardPaise: null }, // excluded
      { estimatePaise: 300, awardPaise: 250 },
    ]);
    expect(r).toEqual({ estimatedPaise: 400, awardedPaise: 330, savingsPaise: 70 });
  });
  it('is zero savings, not NaN, when no row has both', () => {
    expect(computeSavings([{ estimatePaise: null, awardPaise: 10 }]))
      .toEqual({ estimatedPaise: 0, awardedPaise: 0, savingsPaise: 0 });
  });
});

describe('isBiddingClosed', () => {
  it('is false while sealed', () => {
    expect(isBiddingClosed('FLOATED')).toBe(false);
    expect(isBiddingClosed('DRAFT')).toBe(false);
  });
  it('is true once closed', () => {
    for (const s of ['REVEALING', 'AWARDED', 'FAILED', 'CANCELLED']) {
      expect(isBiddingClosed(s)).toBe(true);
    }
  });
});

describe('toCsv', () => {
  it('quotes fields containing comma, quote, or newline and doubles quotes', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'he said "hi"'], [1, null]]);
    expect(csv).toBe('a,b\r\n"x,y","he said ""hi"""\r\n1,\r\n');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run server/oversight-finance.test.mjs`
Expected: FAIL — cannot find module `./oversight-finance.mjs`.

- [ ] **Step 3: Implement the helpers**

Create `web/server/oversight-finance.mjs`:

```js
// Pure finance helpers — no DB, no I/O — so they unit-test without Postgres.

const CLOSED = new Set(['REVEALING', 'AWARDED', 'FAILED', 'CANCELLED']);

// Bidding is closed (bid amounts may be revealed) once the order leaves FLOATED.
export function isBiddingClosed(status) {
  return CLOSED.has(status);
}

// Savings = Σ(estimate) − Σ(award), counting only orders that have BOTH. A
// missing estimate is excluded from the sums entirely — never coerced to 0.
export function computeSavings(rows) {
  let estimatedPaise = 0;
  let awardedPaise = 0;
  for (const r of rows) {
    if (r.estimatePaise != null && r.awardPaise != null) {
      estimatedPaise += Number(r.estimatePaise);
      awardedPaise += Number(r.awardPaise);
    }
  }
  return { estimatedPaise, awardedPaise, savingsPaise: estimatedPaise - awardedPaise };
}

// Minimal RFC-4180 CSV. Fields with comma/quote/newline are quoted; embedded
// quotes are doubled. Rows are CRLF-terminated including the last.
export function toCsv(headers, rows) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const row of rows) lines.push(row.map(esc).join(','));
  return lines.join('\r\n') + '\r\n';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run server/oversight-finance.test.mjs`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add web/server/oversight-finance.mjs web/server/oversight-finance.test.mjs
git commit -m "feat(oversight): pure finance helpers (savings, sealed gate, csv)"
```

---

## Task 4: Summary + districts query module & endpoints

**Files:**
- Create: `web/server/oversight-queries.mjs`
- Modify: `web/server/bff.mjs` (register endpoints; import module)
- Test: `web/server/oversight.db.test.mjs` (extend)

**Interfaces:**
- Consumes: `computeSavings` from `oversight-finance.mjs`.
- Produces:
  - `financeSummary(client)` → `{ floatedCount, floatedEstimatePaise, bidsReceived, awardedValuePaise, estimatedPaise, awardedPaise, savingsPaise, paymentsHeldPaise, paymentsReleasedPaise, failedValuePaise, openEscalations }`
  - `financeDistricts(client)` → `{ districtId, district, floatedCount, awardedValuePaise, savingsPaise, paymentsHeldPaise, paymentsReleasedPaise, failedValuePaise }[]`
  - Endpoints `GET /api/gov/oversight/finance/summary`, `/finance/districts`.

- [ ] **Step 1: Write failing DB tests** (append inside `oversight.db.test.mjs`)

Add these imports at the top of `web/server/oversight.db.test.mjs`:
```js
import { financeSummary, financeDistricts } from './oversight-queries.mjs';
```
Add a new block:
```js
maybe('finance summary + districts', () => {
  it('summary numbers are coherent and savings never counts NULL estimates', async () => {
    const s = await withUserSession(headAdmin.userId, (c) => financeSummary(c));
    expect(typeof s.awardedValuePaise).toBe('number');
    expect(s.savingsPaise).toBe(s.estimatedPaise - s.awardedPaise);
    expect(s.awardedPaise).toBeLessThanOrEqual(s.awardedValuePaise); // savings subset ⊆ all awards
    expect(s.floatedCount).toBeGreaterThanOrEqual(0);
  });
  it('districts roll up to a non-empty, scoped list for head admin', async () => {
    const rows = await withUserSession(headAdmin.userId, (c) => financeDistricts(c));
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(typeof r.district).toBe('string');
      expect(typeof r.awardedValuePaise).toBe('number');
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run server/oversight.db.test.mjs`
Expected: FAIL — cannot find module `./oversight-queries.mjs`.

- [ ] **Step 3: Implement `financeSummary` + `financeDistricts`**

Create `web/server/oversight-queries.mjs`:

```js
// Money rollups for the Tenders & Budget oversight screen. Every function takes
// a `client` already inside withUserSession(), so RLS scopes the rows — no manual
// org filtering. bigints are returned as JS numbers (paise fit in a double for
// this app's magnitudes).
import { computeSavings } from './oversight-finance.mjs';

const n = (v) => (v == null ? 0 : Number(v));

export async function financeSummary(client) {
  const totalsQ = await client.query(`
    select
      count(*) filter (where o.status in ('FLOATED','REVEALING'))::int          as "floatedCount",
      coalesce(sum(o.estimated_amount_paise)
        filter (where o.status in ('FLOATED','REVEALING')), 0)::bigint          as "floatedEstimatePaise",
      (select count(*)::int from eworks.order_bids)                             as "bidsReceived",
      coalesce(sum(oa.price_paise), 0)::bigint                                  as "awardedValuePaise",
      coalesce((select sum(amount_paise) from eworks.payments where status='HELD'), 0)::bigint     as "paymentsHeldPaise",
      coalesce((select sum(amount_paise) from eworks.payments where status='RELEASED'), 0)::bigint as "paymentsReleasedPaise",
      coalesce(sum(coalesce(oa.price_paise, o.estimated_amount_paise))
        filter (where o.status in ('FAILED','CANCELLED')), 0)::bigint          as "failedValuePaise",
      (select count(*)::int from eworks.escalations where status='OPEN')        as "openEscalations"
    from eworks.test_orders o
    left join eworks.order_award oa on oa.order_id = o.id
  `);
  const savingsQ = await client.query(`
    select o.estimated_amount_paise as "estimatePaise", oa.price_paise as "awardPaise"
      from eworks.test_orders o
      join eworks.order_award oa on oa.order_id = o.id
     where o.estimated_amount_paise is not null
  `);
  const t = totalsQ.rows[0];
  const savings = computeSavings(savingsQ.rows);
  return {
    floatedCount: n(t.floatedCount),
    floatedEstimatePaise: n(t.floatedEstimatePaise),
    bidsReceived: n(t.bidsReceived),
    awardedValuePaise: n(t.awardedValuePaise),
    estimatedPaise: savings.estimatedPaise,
    awardedPaise: savings.awardedPaise,
    savingsPaise: savings.savingsPaise,
    paymentsHeldPaise: n(t.paymentsHeldPaise),
    paymentsReleasedPaise: n(t.paymentsReleasedPaise),
    failedValuePaise: n(t.failedValuePaise),
    openEscalations: n(t.openEscalations),
  };
}

export async function financeDistricts(client) {
  // Group each order under its DISTRICT-level ancestor. RLS already limits which
  // org_units / orders are visible, so a district officer sees only their row.
  const q = await client.query(`
    select
      d.id                                                          as "districtId",
      d.name                                                        as "district",
      count(*) filter (where o.status in ('FLOATED','REVEALING'))::int as "floatedCount",
      coalesce(sum(oa.price_paise), 0)::bigint                      as "awardedValuePaise",
      coalesce(sum(o.estimated_amount_paise)
        filter (where oa.price_paise is not null), 0)::bigint       as "estimatedForAwardedPaise",
      coalesce(sum(oa.price_paise)
        filter (where o.estimated_amount_paise is not null), 0)::bigint as "awardedWithEstPaise",
      coalesce((sum(pay.amount_paise) filter (where pay.status='HELD')), 0)::bigint     as "paymentsHeldPaise",
      coalesce((sum(pay.amount_paise) filter (where pay.status='RELEASED')), 0)::bigint as "paymentsReleasedPaise",
      coalesce(sum(coalesce(oa.price_paise, o.estimated_amount_paise))
        filter (where o.status in ('FAILED','CANCELLED')), 0)::bigint as "failedValuePaise"
    from eworks.test_orders o
    join eworks.org_units d
      on d.level = 'DISTRICT' and d.path @> (select ou.path from eworks.org_units ou where ou.id = o.org_unit_id)
    left join eworks.order_award oa on oa.order_id = o.id
    left join eworks.payments pay on pay.order_id = o.id
    group by d.id, d.name
    order by d.name
  `);
  return q.rows.map((r) => ({
    districtId: r.districtId,
    district: r.district,
    floatedCount: n(r.floatedCount),
    awardedValuePaise: n(r.awardedValuePaise),
    savingsPaise: n(r.estimatedForAwardedPaise) - n(r.awardedWithEstPaise),
    paymentsHeldPaise: n(r.paymentsHeldPaise),
    paymentsReleasedPaise: n(r.paymentsReleasedPaise),
    failedValuePaise: n(r.failedValuePaise),
  }));
}
```

- [ ] **Step 4: Register the endpoints**

In `web/server/bff.mjs`, add the import near the other server-module imports at the top:
```js
import { financeSummary, financeDistricts } from './oversight-queries.mjs';
```
Add the endpoints next to the other `/api/gov/*` routes (e.g. just after the `/api/gov/analytics` route):
```js
  app.get('/api/gov/oversight/finance/summary', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const payload = await withUserSession(userId, (client) => financeSummary(client));
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/oversight/finance/districts', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, (client) => financeDistricts(client));
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });
```

- [ ] **Step 5: Run to verify pass**

Run: `cd web && npx vitest run server/oversight.db.test.mjs`
Expected: PASS (all blocks).

- [ ] **Step 6: Commit**

```bash
git add web/server/oversight-queries.mjs web/server/bff.mjs web/server/oversight.db.test.mjs
git commit -m "feat(oversight): finance summary + districts rollups and endpoints"
```

---

## Task 5: Order ledger + order detail (sealed-bid enforcement)

**Files:**
- Modify: `web/server/oversight-queries.mjs` (add `financeOrders`, `financeOrderDetail`)
- Modify: `web/server/bff.mjs` (two endpoints)
- Test: `web/server/oversight.db.test.mjs` (extend — the sealed-bid test is the critical one)

**Interfaces:**
- Consumes: `isBiddingClosed` from `oversight-finance.mjs`.
- Produces:
  - `financeOrders(client, { limit, offset })` → `{ rows, total }`, `rows: { id, code, milestone, orgName, status, estimatePaise, bidCount, awardPaise, awardedVendor, paymentStatus }[]`
  - `financeOrderDetail(client, orderId)` → `{ id, milestone, status, estimatePaise, sealed, bidCount, bids, award, payment, certificateId }` where `bids` is `[]` when `sealed` and `[{ vendorName, pricePaise, revealedAt }]` otherwise.
  - Endpoints `GET /api/gov/oversight/finance/orders?limit&offset`, `/finance/orders/:id`.

- [ ] **Step 1: Write the failing sealed-bid tests** (append to `oversight.db.test.mjs`)

Add import:
```js
import { financeOrders, financeOrderDetail } from './oversight-queries.mjs';
```
Add block:
```js
maybe('order ledger + sealed-bid confidentiality', () => {
  it('a FLOATED order returns sealed:true, a bid count, and ZERO amounts', async () => {
    const floated = (await probe.query(
      `select id from eworks.test_orders where status='FLOATED' limit 1`)).rows[0];
    const d = await withUserSession(headAdmin.userId, (c) => financeOrderDetail(c, floated.id));
    expect(d.sealed).toBe(true);
    expect(d.bids).toEqual([]);            // never any amounts
    expect(d.award).toBeNull();
    expect(typeof d.bidCount).toBe('number');
  });
  it('an AWARDED order reveals bid amounts with vendor names', async () => {
    const awarded = (await probe.query(
      `select id from eworks.test_orders where status='AWARDED' limit 1`)).rows[0];
    const d = await withUserSession(headAdmin.userId, (c) => financeOrderDetail(c, awarded.id));
    expect(d.sealed).toBe(false);
    expect(d.award).not.toBeNull();
    expect(typeof d.award.pricePaise).toBe('number');
    for (const b of d.bids) {
      expect(typeof b.vendorName).toBe('string');
      expect(typeof b.pricePaise).toBe('number');
    }
  });
  it('ledger paginates and hides amounts for sealed rows', async () => {
    const { rows, total } = await withUserSession(headAdmin.userId, (c) => financeOrders(c, { limit: 10, offset: 0 }));
    expect(total).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(10);
    for (const r of rows) {
      if (!['REVEALING','AWARDED','FAILED','CANCELLED'].includes(r.status)) {
        expect(r.awardPaise).toBeNull();
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run server/oversight.db.test.mjs`
Expected: FAIL — `financeOrders`/`financeOrderDetail` not exported.

- [ ] **Step 3: Implement the two functions** (append to `oversight-queries.mjs`; add `isBiddingClosed` to the import)

Change the import line to:
```js
import { computeSavings, isBiddingClosed } from './oversight-finance.mjs';
```
Append:
```js
export async function financeOrders(client, { limit = 20, offset = 0 } = {}) {
  const totalQ = await client.query(`select count(*)::int as total from eworks.test_orders`);
  const q = await client.query(`
    select
      o.id, o.milestone, o.status,
      ou.name                          as "orgName",
      o.estimated_amount_paise         as "estimatePaise",
      (select count(*)::int from eworks.order_bids b where b.order_id = o.id) as "bidCount",
      oa.price_paise                   as "awardPaise",
      av.legal_name                    as "awardedVendor",
      (select pay.status from eworks.payments pay where pay.order_id = o.id order by pay.created_at desc limit 1) as "paymentStatus"
    from eworks.test_orders o
    join eworks.org_units ou on ou.id = o.org_unit_id
    left join eworks.order_award oa on oa.order_id = o.id
    left join eworks.vendors av on av.id = oa.vendor_id
    order by o.created_at desc
    limit $1 offset $2
  `, [limit, offset]);
  const rows = q.rows.map((r) => {
    const closed = isBiddingClosed(r.status);
    return {
      id: r.id,
      milestone: r.milestone,
      orgName: r.orgName,
      status: r.status,
      estimatePaise: r.estimatePaise == null ? null : Number(r.estimatePaise),
      bidCount: Number(r.bidCount),
      // Award only ever exists post-close, but gate defensively anyway.
      awardPaise: closed && r.awardPaise != null ? Number(r.awardPaise) : null,
      awardedVendor: closed ? r.awardedVendor : null,
      paymentStatus: r.paymentStatus ?? null,
    };
  });
  return { rows, total: totalQ.rows[0].total };
}

export async function financeOrderDetail(client, orderId) {
  const oQ = await client.query(`
    select o.id, o.milestone, o.status, o.estimated_amount_paise as "estimatePaise"
      from eworks.test_orders o where o.id = $1
  `, [orderId]);
  if (oQ.rowCount === 0) return null;
  const o = oQ.rows[0];
  const sealed = !isBiddingClosed(o.status);

  const bidCount = Number((await client.query(
    `select count(*)::int as c from eworks.order_bids where order_id = $1`, [orderId])).rows[0].c);

  // Amounts ONLY when bidding has closed. When sealed we never even SELECT the
  // revealed column — the contract is "no plaintext exists yet".
  let bids = [];
  let award = null;
  let payment = null;
  let certificateId = null;
  if (!sealed) {
    const bidsQ = await client.query(`
      select v.legal_name as "vendorName", b.revealed_price_paise as "pricePaise", b.revealed_at as "revealedAt"
        from eworks.order_bids b
        join eworks.vendors v on v.id = b.vendor_id
       where b.order_id = $1 and b.revealed_price_paise is not null
       order by b.revealed_price_paise asc
    `, [orderId]);
    bids = bidsQ.rows.map((r) => ({
      vendorName: r.vendorName, pricePaise: Number(r.pricePaise), revealedAt: r.revealedAt,
    }));
    const awQ = await client.query(`
      select v.legal_name as "vendorName", oa.price_paise as "pricePaise", oa.awarded_at as "awardedAt",
             oa.qualified_bid_count as "qualifiedBidCount"
        from eworks.order_award oa join eworks.vendors v on v.id = oa.vendor_id
       where oa.order_id = $1
    `, [orderId]);
    if (awQ.rowCount) {
      const a = awQ.rows[0];
      award = { vendorName: a.vendorName, pricePaise: Number(a.pricePaise), awardedAt: a.awardedAt, qualifiedBidCount: Number(a.qualifiedBidCount) };
    }
    const payQ = await client.query(`
      select status, amount_paise as "amountPaise", released_at as "releasedAt", created_at as "createdAt"
        from eworks.payments where order_id = $1 order by created_at desc limit 1
    `, [orderId]);
    if (payQ.rowCount) {
      const p = payQ.rows[0];
      payment = { status: p.status, amountPaise: Number(p.amountPaise), releasedAt: p.releasedAt, heldSince: p.createdAt };
    }
    certificateId = (await client.query(
      `select id from eworks.certificates c
         join eworks.test_jobs j on j.id = c.job_id
        where j.order_id = $1 limit 1`, [orderId])).rows[0]?.id ?? null;
  }
  return {
    id: o.id, milestone: o.milestone, status: o.status,
    estimatePaise: o.estimatePaise == null ? null : Number(o.estimatePaise),
    sealed, bidCount, bids, award, payment, certificateId,
  };
}
```
> Note: if the `certificates → test_jobs` join column differs, the implementer must check `\d eworks.certificates` and adjust; the join to `order_id` is the intent.

- [ ] **Step 4: Register the endpoints**

Update the import in `bff.mjs`:
```js
import { financeSummary, financeDistricts, financeOrders, financeOrderDetail } from './oversight-queries.mjs';
```
Add:
```js
  app.get('/api/gov/oversight/finance/orders', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    try {
      const payload = await withUserSession(userId, (c) => financeOrders(c, { limit, offset }));
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });

  app.get('/api/gov/oversight/finance/orders/:id', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const payload = await withUserSession(userId, (c) => financeOrderDetail(c, req.params.id));
      if (!payload) return res.status(404).json({ error: 'not_found' });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });
```

- [ ] **Step 5: Run to verify pass**

Run: `cd web && npx vitest run server/oversight.db.test.mjs`
Expected: PASS — including the sealed-bid tests.

- [ ] **Step 6: Commit**

```bash
git add web/server/oversight-queries.mjs web/server/bff.mjs web/server/oversight.db.test.mjs
git commit -m "feat(oversight): order ledger + detail with sealed-bid confidentiality"
```

---

## Task 6: Vendor earnings + anomaly flags

**Files:**
- Modify: `web/server/oversight-queries.mjs` (add `financeVendors`, `oversightFlags`)
- Modify: `web/server/bff.mjs` (two endpoints)
- Test: `web/server/oversight.db.test.mjs` (extend)

**Interfaces:**
- Produces:
  - `financeVendors(client)` → `{ vendorId, vendorName, awardedPaise, paidPaise, pendingPaise }[]`
  - `oversightFlags(client)` → `{ kind, severity, orderId, label }[]` where `severity` is `'warn'|'integrity'`.
  - Endpoints `GET /api/gov/oversight/finance/vendors`, `/oversight/flags`.

- [ ] **Step 1: Write failing tests** (append to `oversight.db.test.mjs`)

```js
import { financeVendors, oversightFlags } from './oversight-queries.mjs';

maybe('vendors + flags', () => {
  it('vendor earnings are non-negative and paid ≤ awarded', async () => {
    const rows = await withUserSession(headAdmin.userId, (c) => financeVendors(c));
    for (const v of rows) {
      expect(v.awardedPaise).toBeGreaterThanOrEqual(0);
      expect(v.paidPaise).toBeLessThanOrEqual(v.awardedPaise + v.pendingPaise + 1);
    }
  });
  it('flags each carry a kind, severity, and orderId', async () => {
    const flags = await withUserSession(headAdmin.userId, (c) => oversightFlags(c));
    expect(Array.isArray(flags)).toBe(true);
    for (const f of flags) {
      expect(['warn', 'integrity']).toContain(f.severity);
      expect(typeof f.kind).toBe('string');
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run server/oversight.db.test.mjs`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the functions** (append to `oversight-queries.mjs`)

```js
export async function financeVendors(client) {
  const q = await client.query(`
    select
      v.id                       as "vendorId",
      v.legal_name               as "vendorName",
      coalesce(sum(oa.price_paise), 0)::bigint as "awardedPaise",
      coalesce((select sum(p.amount_paise) from eworks.payments p
                 where p.vendor_id = v.id and p.status='RELEASED'), 0)::bigint as "paidPaise",
      coalesce((select sum(p.amount_paise) from eworks.payments p
                 where p.vendor_id = v.id and p.status='HELD'), 0)::bigint as "pendingPaise"
    from eworks.vendors v
    join eworks.order_award oa on oa.vendor_id = v.id
    group by v.id, v.legal_name
    order by "awardedPaise" desc
  `);
  return q.rows.map((r) => ({
    vendorId: r.vendorId, vendorName: r.vendorName,
    awardedPaise: n(r.awardedPaise), paidPaise: n(r.paidPaise), pendingPaise: n(r.pendingPaise),
  }));
}

// Advisory flags only. Threshold for "award over estimate" comes from
// eworks.settings (key 'oversight.award_over_estimate_pct'), default 15.
export async function oversightFlags(client) {
  const flags = [];

  const single = await client.query(`
    select oa.order_id as "orderId", o.milestone
      from eworks.order_award oa join eworks.test_orders o on o.id = oa.order_id
     where oa.qualified_bid_count = 1
  `);
  for (const r of single.rows) {
    flags.push({ kind: 'single_bidder', severity: 'warn', orderId: r.orderId, label: r.milestone });
  }

  const pctRow = await client.query(
    `select coalesce((select value from eworks.settings where key='oversight.award_over_estimate_pct'), '15') as pct`);
  const pct = Number(pctRow.rows[0].pct) || 15;
  const over = await client.query(`
    select o.id as "orderId", o.milestone
      from eworks.test_orders o join eworks.order_award oa on oa.order_id = o.id
     where o.estimated_amount_paise is not null
       and oa.price_paise > o.estimated_amount_paise * (1 + $1/100.0)
  `, [pct]);
  for (const r of over.rows) {
    flags.push({ kind: 'award_over_estimate', severity: 'warn', orderId: r.orderId, label: r.milestone });
  }

  // Integrity: a released payment with no verified certificate for its order.
  // DB constraints should make this impossible, so any hit is a red alert.
  const integrity = await client.query(`
    select p.order_id as "orderId", o.milestone
      from eworks.payments p join eworks.test_orders o on o.id = p.order_id
     where p.status = 'RELEASED'
       and not exists (
         select 1 from eworks.certificates c join eworks.test_jobs j on j.id = c.job_id
          where j.order_id = p.order_id and c.signature_verified)
  `);
  for (const r of integrity.rows) {
    flags.push({ kind: 'payment_without_certificate', severity: 'integrity', orderId: r.orderId, label: r.milestone });
  }

  return flags;
}
```
> Note: verify `eworks.settings` column names (`key`/`value`) with `\d eworks.settings`; adjust the two settings sub-selects if they differ.

- [ ] **Step 4: Register the endpoints**

Update the import and add:
```js
  app.get('/api/gov/oversight/finance/vendors', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      res.json(await withUserSession(userId, (c) => financeVendors(c)));
    } catch (err) { res.status(500).json({ error: 'query_failed', detail: err.message }); }
  });

  app.get('/api/gov/oversight/flags', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      res.json(await withUserSession(userId, (c) => oversightFlags(c)));
    } catch (err) { res.status(500).json({ error: 'query_failed', detail: err.message }); }
  });
```

- [ ] **Step 5: Run to verify pass**

Run: `cd web && npx vitest run server/oversight.db.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/server/oversight-queries.mjs web/server/bff.mjs web/server/oversight.db.test.mjs
git commit -m "feat(oversight): vendor earnings + advisory anomaly flags"
```

---

## Task 7: CSV export endpoint

**Files:**
- Modify: `web/server/bff.mjs` (one endpoint, using `toCsv` + existing query fns)
- Test: `web/server/oversight.db.test.mjs` (extend — assert CSV matches the JSON numbers)

**Interfaces:**
- Consumes: `toCsv` from `oversight-finance.mjs`; `financeDistricts`, `financeOrders`, `financeVendors`.
- Produces: `GET /api/gov/oversight/finance/export.csv?table=districts|orders|vendors` → `text/csv`.

- [ ] **Step 1: Write the failing test**

```js
import { toCsv } from './oversight-finance.mjs';

maybe('csv export shape', () => {
  it('district CSV header + first data row match the JSON rollup', async () => {
    const rows = await withUserSession(headAdmin.userId, (c) => financeDistricts(c));
    const csv = toCsv(['District', 'Floated', 'Awarded (paise)'],
      rows.map((r) => [r.district, r.floatedCount, r.awardedValuePaise]));
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('District,Floated,Awarded (paise)');
    if (rows.length) {
      expect(lines[1]).toContain(String(rows[0].awardedValuePaise));
    }
  });
});
```

- [ ] **Step 2: Run to verify pass** (this test exercises `toCsv` + `financeDistricts`, both already present)

Run: `cd web && npx vitest run server/oversight.db.test.mjs`
Expected: PASS.

- [ ] **Step 3: Implement the export endpoint**

In `web/server/bff.mjs`, ensure `toCsv` is imported:
```js
import { toCsv } from './oversight-finance.mjs';
```
Add:
```js
  app.get('/api/gov/oversight/finance/export.csv', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const table = String(req.query.table || 'districts');
    try {
      const csv = await withUserSession(userId, async (client) => {
        if (table === 'districts') {
          const rows = await financeDistricts(client);
          return toCsv(
            ['District', 'Floated', 'Awarded (paise)', 'Savings (paise)', 'Held (paise)', 'Released (paise)', 'Failed (paise)'],
            rows.map((r) => [r.district, r.floatedCount, r.awardedValuePaise, r.savingsPaise, r.paymentsHeldPaise, r.paymentsReleasedPaise, r.failedValuePaise]));
        }
        if (table === 'vendors') {
          const rows = await financeVendors(client);
          return toCsv(['Vendor', 'Awarded (paise)', 'Paid (paise)', 'Pending (paise)'],
            rows.map((r) => [r.vendorName, r.awardedPaise, r.paidPaise, r.pendingPaise]));
        }
        // orders
        const { rows } = await financeOrders(client, { limit: 1000, offset: 0 });
        return toCsv(['Milestone', 'Org', 'Status', 'Estimate (paise)', 'Bids', 'Award (paise)', 'Awarded vendor', 'Payment'],
          rows.map((r) => [r.milestone, r.orgName, r.status, r.estimatePaise, r.bidCount, r.awardPaise, r.awardedVendor, r.paymentStatus]));
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="oversight-${table}.csv"`);
      res.send(csv);
    } catch (err) {
      res.status(500).json({ error: 'export_failed', detail: err.message });
    }
  });
```
Ensure `financeVendors` is in the `oversight-queries.mjs` import line in `bff.mjs`.

- [ ] **Step 4: Manual endpoint smoke** (BFF must be restarted — node has no hot reload)

Run:
```bash
powershell -Command "Get-NetTCPConnection -LocalPort 8787 -State Listen | %{ Stop-Process -Id \$_.OwningProcess -Force }"
cd web && EWORKS_USE_LOCAL_PG=1 npm run bff &
```
(then, in the browser session, sign-in already holds a cookie — verified in Task 13). For now assert the route file parses: `node --check server/bff.mjs` → no output = OK.

- [ ] **Step 5: Commit**

```bash
git add web/server/bff.mjs web/server/oversight.db.test.mjs
git commit -m "feat(oversight): scope-respecting CSV export endpoint"
```

---

## Task 8: Types + client API + hooks

**Files:**
- Modify: `web/src/types/domain.ts`
- Create: `web/src/features/gov/oversight/oversightApi.ts`, `web/src/features/gov/oversight/useOversight.ts`

**Interfaces:**
- Produces DTO types + `oversightKeys` + fetchers + hooks: `useFinanceSummary`, `useFinanceDistricts`, `useFinanceOrders(limit, offset)`, `useFinanceOrder(id)`, `useFinanceVendors`, `useOversightFlags`.

- [ ] **Step 1: Add DTO types** to `web/src/types/domain.ts`:

```ts
export interface FinanceSummary {
  floatedCount: number; floatedEstimatePaise: number; bidsReceived: number;
  awardedValuePaise: number; estimatedPaise: number; awardedPaise: number; savingsPaise: number;
  paymentsHeldPaise: number; paymentsReleasedPaise: number; failedValuePaise: number; openEscalations: number;
}
export interface FinanceDistrictRow {
  districtId: string; district: string; floatedCount: number; awardedValuePaise: number;
  savingsPaise: number; paymentsHeldPaise: number; paymentsReleasedPaise: number; failedValuePaise: number;
}
export interface FinanceOrderRow {
  id: string; milestone: string; orgName: string; status: string;
  estimatePaise: number | null; bidCount: number; awardPaise: number | null;
  awardedVendor: string | null; paymentStatus: string | null;
}
export interface FinanceOrdersPage { rows: FinanceOrderRow[]; total: number; }
export interface FinanceOrderDetail {
  id: string; milestone: string; status: string; estimatePaise: number | null;
  sealed: boolean; bidCount: number;
  bids: { vendorName: string; pricePaise: number; revealedAt: string | null }[];
  award: { vendorName: string; pricePaise: number; awardedAt: string; qualifiedBidCount: number } | null;
  payment: { status: string; amountPaise: number; releasedAt: string | null; heldSince: string } | null;
  certificateId: string | null;
}
export interface VendorEarningRow { vendorId: string; vendorName: string; awardedPaise: number; paidPaise: number; pendingPaise: number; }
export interface OversightFlag { kind: string; severity: 'warn' | 'integrity'; orderId: string; label: string; }
```

- [ ] **Step 2: Write the fetchers**

Create `web/src/features/gov/oversight/oversightApi.ts`:

```ts
import { apiClient } from '@/lib/apiClient';
import type {
  FinanceSummary, FinanceDistrictRow, FinanceOrdersPage, FinanceOrderDetail,
  VendorEarningRow, OversightFlag,
} from '@/types/domain';

export const oversightKeys = {
  summary: ['gov', 'oversight', 'summary'] as const,
  districts: ['gov', 'oversight', 'districts'] as const,
  orders: (limit: number, offset: number) => ['gov', 'oversight', 'orders', limit, offset] as const,
  order: (id: string) => ['gov', 'oversight', 'order', id] as const,
  vendors: ['gov', 'oversight', 'vendors'] as const,
  flags: ['gov', 'oversight', 'flags'] as const,
};

export const financeExportUrl = (table: 'districts' | 'orders' | 'vendors') =>
  `/api/gov/oversight/finance/export.csv?table=${table}`;

export const fetchFinanceSummary = () => apiClient.get<FinanceSummary>('/api/gov/oversight/finance/summary');
export const fetchFinanceDistricts = () => apiClient.get<FinanceDistrictRow[]>('/api/gov/oversight/finance/districts');
export const fetchFinanceOrders = (limit: number, offset: number) =>
  apiClient.get<FinanceOrdersPage>(`/api/gov/oversight/finance/orders?limit=${limit}&offset=${offset}`);
export const fetchFinanceOrder = (id: string) => apiClient.get<FinanceOrderDetail>(`/api/gov/oversight/finance/orders/${id}`);
export const fetchFinanceVendors = () => apiClient.get<VendorEarningRow[]>('/api/gov/oversight/finance/vendors');
export const fetchOversightFlags = () => apiClient.get<OversightFlag[]>('/api/gov/oversight/flags');
```

- [ ] **Step 3: Write the hooks**

Create `web/src/features/gov/oversight/useOversight.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import {
  oversightKeys, fetchFinanceSummary, fetchFinanceDistricts, fetchFinanceOrders,
  fetchFinanceOrder, fetchFinanceVendors, fetchOversightFlags,
} from './oversightApi';

export const useFinanceSummary = () =>
  useQuery({ queryKey: oversightKeys.summary, queryFn: fetchFinanceSummary });
export const useFinanceDistricts = () =>
  useQuery({ queryKey: oversightKeys.districts, queryFn: fetchFinanceDistricts });
export const useFinanceOrders = (limit: number, offset: number) =>
  useQuery({ queryKey: oversightKeys.orders(limit, offset), queryFn: () => fetchFinanceOrders(limit, offset) });
export const useFinanceOrder = (id: string | null) =>
  useQuery({ queryKey: oversightKeys.order(id ?? ''), queryFn: () => fetchFinanceOrder(id as string), enabled: Boolean(id) });
export const useFinanceVendors = () =>
  useQuery({ queryKey: oversightKeys.vendors, queryFn: fetchFinanceVendors });
export const useOversightFlags = () =>
  useQuery({ queryKey: oversightKeys.flags, queryFn: fetchOversightFlags });
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc -b`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/types/domain.ts web/src/features/gov/oversight/oversightApi.ts web/src/features/gov/oversight/useOversight.ts
git commit -m "feat(oversight): client types, api fetchers, and query hooks"
```

---

## Task 9: Nav, route, and Oversight shell

**Files:**
- Modify: `web/src/lib/navConfig.ts`, `web/src/App.tsx`, `web/src/i18n/en.json`, `web/src/i18n/ta.json`
- Create: `web/src/features/gov/oversight/OversightPage.tsx`, `web/src/features/gov/oversight/financeModel.ts`, `web/src/features/gov/oversight/financeModel.test.ts`

**Interfaces:**
- Consumes: nothing new. Produces: `/gov/oversight` route rendering a tab strip (Tenders active, Field disabled); `financeModel.formatPaise(paise)`.

- [ ] **Step 1: Write the financeModel test**

Create `web/src/features/gov/oversight/financeModel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatPaise } from './financeModel';

describe('formatPaise', () => {
  it('renders paise as INR rupees', () => {
    expect(formatPaise(2500000)).toContain('25,000');
  });
  it('renders a dash for null', () => {
    expect(formatPaise(null)).toBe('—');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npx vitest run src/features/gov/oversight/financeModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement financeModel**

Create `web/src/features/gov/oversight/financeModel.ts`:

```ts
import { formatInr } from '@/lib/time';

// Money for this screen is always paise; formatInr expects paise already.
export function formatPaise(paise: number | null | undefined): string {
  if (paise == null) return '—';
  return formatInr(paise);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npx vitest run src/features/gov/oversight/financeModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Add nav item + tab key**

In `web/src/lib/navConfig.ts`, add to `GOV_NAV_TAB_KEYS` (after `analytics`):
```ts
  { key: 'oversight', labelKey: 'oversight.nav' },
```
And add to `GOV_ALL` (after the `analytics` item):
```ts
  { to: '/gov/oversight', labelKey: 'oversight.nav', navKey: 'oversight', requiresPermission: 'order.read' },
```

- [ ] **Step 6: Add i18n keys**

In BOTH `web/src/i18n/en.json` and `web/src/i18n/ta.json`, add a new top-level `"oversight"` object (place it alphabetically near `officers`):
```json
  "oversight": {
    "nav": "Oversight",
    "title": "Tenders & budget",
    "subtitle": "Every tender's money, floated to paid, within your scope.",
    "tabFinance": "Tenders & budget",
    "tabField": "Field work",
    "tabFieldSoon": "Coming soon",
    "kpiFloated": "Floated (est. value)",
    "kpiBids": "Bids received",
    "kpiAwarded": "Awarded value",
    "kpiSavings": "Savings vs estimate",
    "kpiHeld": "Payments held",
    "kpiReleased": "Payments released",
    "kpiFailed": "Failed / disputed value",
    "colDistrict": "District",
    "colFloated": "Floated",
    "colAwarded": "Awarded",
    "colSavings": "Savings",
    "colHeld": "Held",
    "colReleased": "Released",
    "district": "District",
    "allDistricts": "All districts",
    "ledgerTitle": "Order ledger",
    "colOrder": "Order",
    "colStatus": "Status",
    "colEstimate": "Estimate",
    "colBids": "Bids",
    "colAward": "L1 award",
    "colVendor": "Awarded vendor",
    "colPayment": "Payment",
    "sealed": "Sealed — opens after close",
    "sealedCount": "{{count}} sealed commitments",
    "detailBids": "Revealed bids",
    "detailAward": "Award (L1)",
    "detailPayment": "Payment",
    "heldSince": "Held since {{when}}",
    "releasedOn": "Released {{when}}",
    "viewCertificate": "View certificate",
    "vendorsTitle": "Vendor earnings",
    "colVendorName": "Vendor",
    "colVendorAwarded": "Awarded",
    "colVendorPaid": "Paid",
    "colVendorPending": "Pending",
    "flagsTitle": "Needs attention",
    "flagsEmpty": "No anomalies in scope.",
    "flagSingleBidder": "Single-bidder award",
    "flagAwardOverEstimate": "Award over estimate",
    "flagIntegrity": "Integrity alert: payment without certificate",
    "exportCsv": "Export CSV",
    "empty": "No tenders in scope yet."
  },
```

- [ ] **Step 7: Build the Oversight shell**

Create `web/src/features/gov/oversight/OversightPage.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FinanceOverview } from './FinanceOverview';

type Tab = 'finance' | 'field';

export function OversightPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('finance');

  return (
    <section className="space-y-6">
      <header>
        <h2 className="font-display text-xl font-bold">{t('oversight.title')}</h2>
        <p className="mt-1 text-sm text-ink-2">{t('oversight.subtitle')}</p>
      </header>

      <div className="flex gap-2 border-b border-line">
        <button
          type="button"
          onClick={() => setTab('finance')}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
            tab === 'finance' ? 'border-brand text-brand' : 'border-transparent text-slate hover:text-ink'
          }`}
        >
          {t('oversight.tabFinance')}
        </button>
        <button
          type="button"
          disabled
          title={t('oversight.tabFieldSoon')}
          className="-mb-px cursor-not-allowed border-b-2 border-transparent px-4 py-2 text-sm font-semibold text-ink-3"
        >
          {t('oversight.tabField')} · {t('oversight.tabFieldSoon')}
        </button>
      </div>

      {tab === 'finance' && <FinanceOverview />}
    </section>
  );
}
```

- [ ] **Step 8: Register the route**

In `web/src/App.tsx`, add near the other gov routes (after the `analytics` route) — and add the import at the top with the other feature imports:
```tsx
import { OversightPage } from '@/features/gov/oversight/OversightPage';
```
```tsx
            <Route path="oversight" element={<OversightPage />} />
```

- [ ] **Step 9: Typecheck** (will fail until `FinanceOverview` exists — create a stub to keep the build green)

Create a temporary stub inside `web/src/features/gov/oversight/FinanceOverview.tsx`:
```tsx
export function FinanceOverview() {
  return null;
}
```
Run: `cd web && npx tsc -b`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/navConfig.ts web/src/App.tsx web/src/i18n/en.json web/src/i18n/ta.json web/src/features/gov/oversight/OversightPage.tsx web/src/features/gov/oversight/FinanceOverview.tsx web/src/features/gov/oversight/financeModel.ts web/src/features/gov/oversight/financeModel.test.ts
git commit -m "feat(oversight): nav entry, route, shell tab strip, money formatter"
```

---

## Task 10: Finance overview (summary strip + district table + flags)

**Files:**
- Modify: `web/src/features/gov/oversight/FinanceOverview.tsx` (replace the stub)
- Create: `web/src/features/gov/oversight/FlagsPanel.tsx`

**Interfaces:**
- Consumes: `useFinanceSummary`, `useFinanceDistricts`, `useOversightFlags`, `formatPaise`, `Pagination` (not needed here), `financeExportUrl`.
- Produces: `FinanceOverview` renders the summary KPI strip, the district table (each row links its order ledger filtered by district via `?district=`), and `FlagsPanel`. Renders `OrderLedger` and `VendorEarningsLens` below (added in Tasks 11–12).

- [ ] **Step 1: Build `FlagsPanel`**

Create `web/src/features/gov/oversight/FlagsPanel.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useOversightFlags } from './useOversight';
import type { OversightFlag } from '@/types/domain';

const LABEL_KEY: Record<string, string> = {
  single_bidder: 'oversight.flagSingleBidder',
  award_over_estimate: 'oversight.flagAwardOverEstimate',
  payment_without_certificate: 'oversight.flagIntegrity',
};

export function FlagsPanel({ onSelectOrder }: { onSelectOrder: (id: string) => void }) {
  const { t } = useTranslation();
  const { data: flags = [] } = useOversightFlags();

  return (
    <div className="gov-card p-4">
      <h3 className="font-display text-base font-bold text-ink">{t('oversight.flagsTitle')}</h3>
      {flags.length === 0 ? (
        <p className="mt-2 text-sm text-slate">{t('oversight.flagsEmpty')}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {flags.map((f: OversightFlag, i) => (
            <li key={`${f.kind}-${f.orderId}-${i}`}>
              <button
                type="button"
                onClick={() => onSelectOrder(f.orderId)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm ${
                  f.severity === 'integrity'
                    ? 'border-danger/40 bg-danger-bg text-danger'
                    : 'border-warn/40 bg-warn-bg text-ink'
                }`}
              >
                <span className="font-medium">{t(LABEL_KEY[f.kind] ?? 'oversight.flagsTitle')}</span>
                <span className="truncate text-xs text-slate">{f.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```
> If `warn-bg`/`danger-bg` utility classes are absent, reuse the message-banner classes already used in `RfqPipelineView` (`bg-success-bg`, `bg-danger-bg`) and a neutral `bg-surface-2` for warnings.

- [ ] **Step 2: Build `FinanceOverview`**

Replace `web/src/features/gov/oversight/FinanceOverview.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { useFinanceSummary, useFinanceDistricts } from './useOversight';
import { formatPaise } from './financeModel';
import { financeExportUrl } from './oversightApi';
import { FlagsPanel } from './FlagsPanel';
import { OrderLedger } from './OrderLedger';
import { VendorEarningsLens } from './VendorEarningsLens';

export function FinanceOverview() {
  const { t } = useTranslation();
  const { data: summary, isPending } = useFinanceSummary();
  const { data: districts = [] } = useFinanceDistricts();
  const [districtFilter, setDistrictFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);

  if (isPending || !summary) return <FeedSkeleton />;

  const kpis: [string, string][] = [
    [t('oversight.kpiFloated'), `${summary.floatedCount} · ${formatPaise(summary.floatedEstimatePaise)}`],
    [t('oversight.kpiBids'), String(summary.bidsReceived)],
    [t('oversight.kpiAwarded'), formatPaise(summary.awardedValuePaise)],
    [t('oversight.kpiSavings'), formatPaise(summary.savingsPaise)],
    [t('oversight.kpiHeld'), formatPaise(summary.paymentsHeldPaise)],
    [t('oversight.kpiReleased'), formatPaise(summary.paymentsReleasedPaise)],
    [t('oversight.kpiFailed'), formatPaise(summary.failedValuePaise)],
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map(([label, value]) => (
          <div key={label} className="gov-card p-4">
            <p className="gov-label">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <FlagsPanel onSelectOrder={setSelectedOrder} />

      <div className="gov-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-display text-base font-bold text-ink">{t('oversight.colDistrict')}</h3>
          <a className="gov-btn-secondary text-xs" href={financeExportUrl('districts')} download>
            {t('oversight.exportCsv')}
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-6 py-3">{t('oversight.colDistrict')}</th>
                <th className="px-6 py-3">{t('oversight.colFloated')}</th>
                <th className="px-6 py-3">{t('oversight.colAwarded')}</th>
                <th className="px-6 py-3">{t('oversight.colSavings')}</th>
                <th className="px-6 py-3">{t('oversight.colHeld')}</th>
                <th className="px-6 py-3">{t('oversight.colReleased')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hair">
              {districts.map((d) => (
                <tr
                  key={d.districtId}
                  className={`cursor-pointer ${districtFilter === d.district ? 'bg-brand-tint/30' : 'hover:bg-surface-2'}`}
                  onClick={() => setDistrictFilter((cur) => (cur === d.district ? '' : d.district))}
                >
                  <td className="px-6 py-3 font-medium text-ink">{d.district}</td>
                  <td className="px-6 py-3 tabular-nums">{d.floatedCount}</td>
                  <td className="px-6 py-3 tabular-nums">{formatPaise(d.awardedValuePaise)}</td>
                  <td className="px-6 py-3 tabular-nums">{formatPaise(d.savingsPaise)}</td>
                  <td className="px-6 py-3 tabular-nums">{formatPaise(d.paymentsHeldPaise)}</td>
                  <td className="px-6 py-3 tabular-nums">{formatPaise(d.paymentsReleasedPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <OrderLedger
        districtFilter={districtFilter}
        selectedOrder={selectedOrder}
        onSelectOrder={setSelectedOrder}
      />

      <VendorEarningsLens />
    </div>
  );
}
```
> The district table row toggles a client-side `districtFilter` string passed to the ledger (which filters its already-fetched rows by `orgName` containing the district, consistent with the vendor-registry district filter). Full server-side district scoping is available by signing in as that district's officer — matching how `/gov/area` drill works.

- [ ] **Step 3: Create stubs for the two children so tsc passes**

Create `web/src/features/gov/oversight/OrderLedger.tsx`:
```tsx
export function OrderLedger(_props: { districtFilter: string; selectedOrder: string | null; onSelectOrder: (id: string) => void }) {
  return null;
}
```
Create `web/src/features/gov/oversight/VendorEarningsLens.tsx`:
```tsx
export function VendorEarningsLens() {
  return null;
}
```

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc -b`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/gov/oversight/FinanceOverview.tsx web/src/features/gov/oversight/FlagsPanel.tsx web/src/features/gov/oversight/OrderLedger.tsx web/src/features/gov/oversight/VendorEarningsLens.tsx
git commit -m "feat(oversight): finance overview — KPI strip, district table, flags"
```

---

## Task 11: Order ledger + order finance detail

**Files:**
- Modify: `web/src/features/gov/oversight/OrderLedger.tsx` (replace stub)
- Create: `web/src/features/gov/oversight/OrderFinanceDetail.tsx`

**Interfaces:**
- Consumes: `useFinanceOrders`, `useFinanceOrder`, `Pagination`, `formatPaise`, `OrderStatusPill`.
- Produces: paginated ledger (20/page) with a detail pane; sealed rows show a dash for award; the detail shows the money chain or the sealed placeholder.

- [ ] **Step 1: Build `OrderFinanceDetail`**

Create `web/src/features/gov/oversight/OrderFinanceDetail.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useFinanceOrder } from './useOversight';
import { formatPaise } from './financeModel';
import { formatDeadline } from '@/lib/time';

export function OrderFinanceDetail({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const { data: d, isPending } = useFinanceOrder(orderId);
  if (isPending || !d) return <div className="gov-card p-6 text-sm text-slate">…</div>;

  return (
    <article className="gov-card space-y-4 p-5">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">{d.milestone}</h3>
        <p className="mt-0.5 text-xs text-slate">{d.status}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rfq-meta-cell"><dt>{t('oversight.colEstimate')}</dt><dd>{formatPaise(d.estimatePaise)}</dd></div>
        <div className="rfq-meta-cell"><dt>{t('oversight.colBids')}</dt><dd>{d.bidCount}</dd></div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-ink">{t('oversight.detailBids')}</h4>
        {d.sealed ? (
          <p className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-slate">
            {t('oversight.sealed')} · {t('oversight.sealedCount', { count: d.bidCount })}
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {d.bids.map((b, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span>{b.vendorName}</span>
                <span className="tabular-nums">{formatPaise(b.pricePaise)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {d.award && (
        <div>
          <h4 className="text-sm font-semibold text-ink">{t('oversight.detailAward')}</h4>
          <p className="mt-1 flex justify-between text-sm">
            <span>{d.award.vendorName}</span>
            <span className="font-semibold tabular-nums">{formatPaise(d.award.pricePaise)}</span>
          </p>
        </div>
      )}

      {d.payment && (
        <div>
          <h4 className="text-sm font-semibold text-ink">{t('oversight.detailPayment')}</h4>
          <p className="mt-1 text-sm">
            {d.payment.status} · {formatPaise(d.payment.amountPaise)}<br />
            {d.payment.releasedAt
              ? t('oversight.releasedOn', { when: formatDeadline(d.payment.releasedAt) })
              : t('oversight.heldSince', { when: formatDeadline(d.payment.heldSince) })}
          </p>
        </div>
      )}

      {d.certificateId && (
        <Link to={`/verify/${d.certificateId}`} className="text-sm font-semibold text-brand hover:underline">
          {t('oversight.viewCertificate')} →
        </Link>
      )}
    </article>
  );
}
```

- [ ] **Step 2: Build `OrderLedger`**

Replace `web/src/features/gov/oversight/OrderLedger.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pagination } from '@/components/Pagination';
import { OrderStatusPill } from '@/features/orders/OrderStatusPill';
import { useFinanceOrders } from './useOversight';
import { formatPaise } from './financeModel';
import { financeExportUrl } from './oversightApi';
import { OrderFinanceDetail } from './OrderFinanceDetail';

const PAGE_SIZE = 20;

export function OrderLedger({
  districtFilter, selectedOrder, onSelectOrder,
}: { districtFilter: string; selectedOrder: string | null; onSelectOrder: (id: string) => void }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, isPending } = useFinanceOrders(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const all = data?.rows ?? [];
  const rows = districtFilter ? all.filter((r) => r.orgName.includes(districtFilter)) : all;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start">
      <div className="gov-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-display text-base font-bold text-ink">{t('oversight.ledgerTitle')}</h3>
          <a className="gov-btn-secondary text-xs" href={financeExportUrl('orders')} download>
            {t('oversight.exportCsv')}
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-6 py-3">{t('oversight.colOrder')}</th>
                <th className="px-6 py-3">{t('oversight.colStatus')}</th>
                <th className="px-6 py-3">{t('oversight.colEstimate')}</th>
                <th className="px-6 py-3">{t('oversight.colBids')}</th>
                <th className="px-6 py-3">{t('oversight.colAward')}</th>
                <th className="px-6 py-3">{t('oversight.colPayment')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hair">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`cursor-pointer ${selectedOrder === r.id ? 'bg-brand-tint/30' : 'hover:bg-surface-2'}`}
                  onClick={() => onSelectOrder(r.id)}
                >
                  <td className="px-6 py-3">
                    <span className="font-medium text-ink">{r.milestone}</span>
                    <span className="mt-0.5 block text-xs text-slate">{r.orgName}</span>
                  </td>
                  <td className="px-6 py-3"><OrderStatusPill status={r.status} /></td>
                  <td className="px-6 py-3 tabular-nums">{formatPaise(r.estimatePaise)}</td>
                  <td className="px-6 py-3 tabular-nums">{r.bidCount}</td>
                  <td className="px-6 py-3 tabular-nums">{r.awardPaise == null ? t('oversight.sealed') : formatPaise(r.awardPaise)}</td>
                  <td className="px-6 py-3 text-xs text-slate">{r.paymentStatus ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4">
          <Pagination total={data?.total ?? 0} page={page} pageSize={PAGE_SIZE} onPage={setPage} />
        </div>
      </div>

      <aside className="lg:sticky lg:top-4">
        {selectedOrder ? (
          <OrderFinanceDetail orderId={selectedOrder} />
        ) : (
          <div className="gov-card p-6 text-center text-sm text-slate">{t('oversight.empty')}</div>
        )}
      </aside>
    </div>
  );
}
```
> `OrderStatusPill` accepts the order status string; confirm it accepts the finance statuses (`FLOATED`, `AWARDED`, etc.) — it is the same component the RFQ pipeline uses, so it does.

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/features/gov/oversight/OrderLedger.tsx web/src/features/gov/oversight/OrderFinanceDetail.tsx
git commit -m "feat(oversight): order ledger + finance detail with sealed display"
```

---

## Task 12: Vendor earnings lens

**Files:**
- Modify: `web/src/features/gov/oversight/VendorEarningsLens.tsx` (replace stub)

**Interfaces:**
- Consumes: `useFinanceVendors`, `formatPaise`, `financeExportUrl`.

- [ ] **Step 1: Build `VendorEarningsLens`**

Replace `web/src/features/gov/oversight/VendorEarningsLens.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useFinanceVendors } from './useOversight';
import { formatPaise } from './financeModel';
import { financeExportUrl } from './oversightApi';

export function VendorEarningsLens() {
  const { t } = useTranslation();
  const { data: vendors = [] } = useFinanceVendors();

  return (
    <div className="gov-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h3 className="font-display text-base font-bold text-ink">{t('oversight.vendorsTitle')}</h3>
        <a className="gov-btn-secondary text-xs" href={financeExportUrl('vendors')} download>
          {t('oversight.exportCsv')}
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
            <tr>
              <th className="px-6 py-3">{t('oversight.colVendorName')}</th>
              <th className="px-6 py-3">{t('oversight.colVendorAwarded')}</th>
              <th className="px-6 py-3">{t('oversight.colVendorPaid')}</th>
              <th className="px-6 py-3">{t('oversight.colVendorPending')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hair">
            {vendors.map((v) => (
              <tr key={v.vendorId} className="hover:bg-surface-2">
                <td className="px-6 py-3 font-medium text-ink">{v.vendorName}</td>
                <td className="px-6 py-3 tabular-nums">{formatPaise(v.awardedPaise)}</td>
                <td className="px-6 py-3 tabular-nums">{formatPaise(v.paidPaise)}</td>
                <td className="px-6 py-3 tabular-nums">{formatPaise(v.pendingPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc -b`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/src/features/gov/oversight/VendorEarningsLens.tsx
git commit -m "feat(oversight): vendor earnings lens"
```

---

## Task 13: Full verification + manual demo

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `cd web && npm test`
Expected: all pass (oversight DB tests included; if local DB down, they SKIP — start it first with `docker start eworks-pg`).

- [ ] **Step 2: Lint**

Run: `cd web && npm run lint`
Expected: no errors. Fix any oxlint findings inline (unused imports, etc.).

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc -b`
Expected: exit 0.

- [ ] **Step 4: Restart the BFF and Vite, then manual demo**

Restart the BFF (node has no hot reload) and open the app:
```bash
powershell -Command "Get-NetTCPConnection -LocalPort 8787 -State Listen | %{ Stop-Process -Id \$_.OwningProcess -Force }"
cd web && EWORKS_USE_LOCAL_PG=1 npm run bff &   # :8787
npm run dev &                                   # :5173
```
As HEAD_ADMIN, open `http://localhost:5173/gov/oversight`:
- summary strip shows non-zero awarded value + a savings figure;
- a district row is clickable and filters the ledger;
- an AWARDED order's detail shows estimate → revealed bids → L1 award → payment;
- a FLOATED order's detail shows "sealed — opens after close" and NO amounts;
- the "Needs attention" panel lists at least the single-bidder flags;
- the three Export CSV links download files whose numbers match the screen.

- [ ] **Step 5: i18n parity check**

Run:
```bash
cd web && node -e "const en=require('./src/i18n/en.json').oversight, ta=require('./src/i18n/ta.json').oversight; const miss=Object.keys(en).filter(k=>!(k in ta)); console.log(miss.length?('MISSING in ta: '+miss):'ta parity OK');"
```
Expected: `ta parity OK`.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "test(oversight): full suite green + i18n parity"
```

---

## Self-Review

**Spec coverage:**
- Migration + planner input + seed backfill → Tasks 1–2. ✅
- Finance endpoints (summary, districts, orders, order detail, vendors, flags, export.csv) → Tasks 4–7. ✅
- Sealed-bid confidentiality + both-sides test → Task 5 (Steps 1, 3, 5). ✅
- Four zoom levels (state summary → district table → order ledger → order line detail) → Tasks 4, 10, 11. ✅
- Vendor earnings lens → Tasks 6, 12. ✅
- Anomaly flags (single-bidder, award-over-estimate, integrity) → Task 6 + FlagsPanel (Task 10). ✅
- CSV export matching screen → Tasks 7, 13. ✅
- Nav + tab-visibility for HEAD_ADMIN/DISTRICT_OFFICER/AUDITOR (gate `order.read`) → Task 9. ✅
- Savings math excludes NULL estimates, unit-tested → Task 3. ✅
- Scope isolation (RLS) → Global Constraints + relied on throughout; district scoping demonstrated by signing in as a district officer (Task 13 note). ✅
- en + ta, tsc/lint/test green, mobile-usable → Task 13. ✅

**Deferred (Cycle B, out of scope by design):** field feed, jobs-today, evidence sheet, map overlay, geofence/custody flags.

**Known verification-time checks flagged for the implementer:** the `certificates → test_jobs` join column, and the `eworks.settings` key/value column names — both called out inline where used (Tasks 5, 6). These are `\d`-and-adjust confirmations, not design gaps.

**Placeholder scan:** no TBD/TODO; every code step carries real code. ✅
**Type consistency:** `FinanceOrderDetail`, `FinanceOrderRow`, `OversightFlag` field names match between `oversight-queries.mjs`, `domain.ts`, and the components (`sealed`, `bids`, `award`, `payment`, `estimatePaise`, `awardPaise`). ✅
