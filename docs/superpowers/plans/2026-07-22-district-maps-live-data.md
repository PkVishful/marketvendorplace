# District Dashboards — Resolution + Live Data (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every gov user's dashboard shows the correct map for their own scope, with regions (= PWD org units) colored by real, RLS-scoped live data — no Coimbatore fallback and no fabricated scores.

**Architecture:** Fix client-side map resolution (`registry.ts`) and stop passing `roles[0]` (`RoleDashboard.tsx`); add a new RLS-scoped BFF endpoint `GET /api/gov/dashboard/map` that returns the caller's immediate child org units with a rollup score (from the existing `computeMilestoneHealth`) and 5 KPIs; the map component fetches it, builds a data-driven grid, and shows a KPI sheet. Real geographic geometry is out of scope (subsystem 1).

**Tech Stack:** React 19 + TanStack Query + Vite (frontend), Express 5 + `pg` (BFF), Postgres + ltree + RLS, Vitest (tests), i18next (en + ta).

## Global Constraints

- Never render another district's map on an unresolved key — unresolved → Tamil Nadu state map. (spec §2)
- Never fabricate a score — a region with no completed/failed orders returns `score: null` → neutral gray "no activity yet". (spec §3)
- All new user-facing strings added to both `web/src/i18n/en.json` and `web/src/i18n/ta.json`.
- Endpoint reads run inside `withUserSession(userId, …)` so RLS enforces scope isolation; never bypass with `pool.query` for scoped data.
- Score formula (verbatim): `round(100 × (green + 0.5·amber) / (green + amber + red))`, `neutral` excluded, denominator 0 → `null`.
- `npm run test`, `npm run lint`, `tsc -b` must stay green.
- Reuse existing helpers: `computeMilestoneHealth` (bff.mjs), `performanceFromScore` (types.ts), `withUserSession` (db.mjs). Do not duplicate quality math.

---

## File Structure

- `web/src/types/domain.ts` — add `primaryGovRole(session)` pure helper.
- `web/src/components/dashboard/districtMaps/registry.ts` — fallback → `tamilnadu`; add `resolveMapScope()`.
- `web/src/components/dashboard/districtMaps/talukaData.ts` — no code change expected (resolution derives keys from path); touched only if an alias gap surfaces in Task 2.
- `web/server/bff.mjs` — export `scoreFromHealthCounts()`; add `GET /api/gov/dashboard/map`.
- `web/src/components/dashboard/DistrictMap.tsx` — live query, data-driven grid, skeleton, KPI sheet.
- `web/src/features/gov/RoleDashboard.tsx` — pass `primaryGovRole` + district switcher.
- `web/src/i18n/{en,ta}.json` — new `dashboard.districtMap.*` strings.
- Tests: `web/src/types/domain.test.ts` (new or extend), `web/src/components/dashboard/districtMaps/registry.test.ts` (new), `web/server/dashboard-map.db.test.mjs` (new), `web/src/components/dashboard/DistrictMap.test.tsx` (new).

---

## Task 1: `primaryGovRole()` — pick the highest-priority gov role

**Files:**
- Modify: `web/src/types/domain.ts`
- Test: `web/src/types/domain.test.ts` (create if absent)

**Interfaces:**
- Consumes: `Session`, `UserRole` (existing, `web/src/types/domain.ts:28`), `OrgLevel`.
- Produces: `export function primaryGovRole(session: Session | undefined): UserRole | undefined` — the gov role anchored highest in the hierarchy (STATE before DISTRICT before DIVISION …); ties broken by array order; returns `undefined` if the user has no gov role.

- [ ] **Step 1: Write the failing test**

```ts
// web/src/types/domain.test.ts
import { describe, it, expect } from 'vitest';
import { primaryGovRole } from './domain';
import type { Session, UserRole } from './domain';

const role = (code: string, orgLevel: UserRole['orgLevel'], orgPath: string): UserRole =>
  ({ code, orgLevel, orgPath, orgName: orgPath });

describe('primaryGovRole', () => {
  it('picks the most senior gov role, not roles[0]', () => {
    const s = { authenticated: true, roles: [
      role('SITE_ENGINEER', 'SECTION', 'TN.MADURAI.DIV1.SEC1'),
      role('DISTRICT_OFFICER', 'DISTRICT', 'TN.MADURAI'),
    ] } as Session;
    expect(primaryGovRole(s)?.code).toBe('DISTRICT_OFFICER');
  });

  it('returns undefined when there is no gov role', () => {
    const s = { authenticated: true, roles: [role('LAB_VENDOR', 'DISTRICT', 'TN.SALEM')] } as Session;
    expect(primaryGovRole(s)).toBeUndefined();
  });

  it('returns undefined for an empty session', () => {
    expect(primaryGovRole(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node node_modules/vitest/vitest.mjs run src/types/domain.test.ts`
Expected: FAIL — `primaryGovRole is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Add near the other role helpers in `web/src/types/domain.ts` (after `resolvePortal`):

```ts
const GOV_ROLE_CODES = new Set([
  'SITE_ENGINEER', 'EXECUTIVE_ENGINEER', 'DISTRICT_OFFICER',
  'SUPERINTENDING_ENGINEER', 'AUDITOR', 'HEAD_ADMIN',
]);

const ORG_LEVEL_ORDER: OrgLevel[] = [
  'STATE', 'DISTRICT', 'DIVISION', 'CIRCLE', 'SUBDIVISION', 'SECTION',
];

/** The user's highest-anchored gov role (STATE before DISTRICT before …). */
export function primaryGovRole(session: Session | undefined): UserRole | undefined {
  const gov = (session?.roles ?? []).filter((r) => GOV_ROLE_CODES.has(r.code));
  if (gov.length === 0) return undefined;
  return gov.reduce((best, r) =>
    ORG_LEVEL_ORDER.indexOf(r.orgLevel) < ORG_LEVEL_ORDER.indexOf(best.orgLevel) ? r : best,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node node_modules/vitest/vitest.mjs run src/types/domain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/types/domain.ts web/src/types/domain.test.ts
git commit -m "feat(dashboard): primaryGovRole helper (highest-anchored gov role)"
```

---

## Task 2: Resolution fix — fallback to state map + scope resolver + guard test

**Files:**
- Modify: `web/src/components/dashboard/districtMaps/registry.ts:109` (fallback), add `resolveMapScope()`
- Test: `web/src/components/dashboard/districtMaps/registry.test.ts` (create)

**Interfaces:**
- Consumes: `DISTRICT_TALUKAS` (talukaData.ts), `resolveDistrictKey` (existing).
- Produces:
  - `resolveDistrictKey()` unchanged signature but unresolved → `'tamilnadu'` (was `'coimbatore'`).
  - `export interface MapScope { level: 'state' | 'district'; key: string; unavailable: boolean }`
  - `export function resolveMapScope(orgName?: string, orgPath?: string): MapScope`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/components/dashboard/districtMaps/registry.test.ts
import { describe, it, expect } from 'vitest';
import { resolveDistrictKey, resolveMapScope } from './registry';
import { DISTRICT_TALUKAS } from './talukaData';

describe('district map resolution', () => {
  it('resolves every seeded district path to its own key (no Coimbatore fallback)', () => {
    for (const key of Object.keys(DISTRICT_TALUKAS)) {
      const path = `TN.${key.toUpperCase()}`; // seed codes are UPPER(registry key)
      expect(resolveDistrictKey(undefined, path)).toBe(key);
    }
  });

  it('falls back to the state map (never coimbatore) for an unknown path', () => {
    expect(resolveDistrictKey(undefined, 'TN.NOWHERE_DISTRICT')).toBe('tamilnadu');
  });

  it('resolveMapScope flags unavailable only on a real miss', () => {
    expect(resolveMapScope(undefined, 'TN.MADURAI')).toEqual(
      { level: 'district', key: 'madurai', unavailable: false });
    expect(resolveMapScope(undefined, 'TN')).toEqual(
      { level: 'state', key: 'tamilnadu', unavailable: false });
    expect(resolveMapScope(undefined, 'TN.NOWHERE_DISTRICT')).toEqual(
      { level: 'state', key: 'tamilnadu', unavailable: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node node_modules/vitest/vitest.mjs run src/components/dashboard/districtMaps/registry.test.ts`
Expected: FAIL — `resolveMapScope` not exported, and the unknown-path case returns `'coimbatore'`.

- [ ] **Step 3: Write minimal implementation**

In `registry.ts`, change the final fallback (line ~109) from `return 'coimbatore';` to `return 'tamilnadu';`, then append:

```ts
export interface MapScope {
  level: 'state' | 'district';
  key: string;
  unavailable: boolean;
}

/** Resolve which map to show and whether we had to fall back. */
export function resolveMapScope(orgName?: string, orgPath?: string): MapScope {
  const key = resolveDistrictKey(orgName, orgPath);
  if (key === 'tamilnadu') {
    const wasStateInput = isStateScope(orgName, orgPath);
    return { level: 'state', key, unavailable: !wasStateInput };
  }
  return { level: 'district', key, unavailable: false };
}
```

(`isStateScope` already exists in this file, `registry.ts:77`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node node_modules/vitest/vitest.mjs run src/components/dashboard/districtMaps/registry.test.ts`
Expected: PASS. If any `DISTRICT_TALUKAS` key fails to resolve, add that key → `ORG_PATH_ALIASES` in `talukaData.ts` and re-run.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dashboard/districtMaps/registry.ts web/src/components/dashboard/districtMaps/registry.test.ts web/src/components/dashboard/districtMaps/talukaData.ts
git commit -m "fix(dashboard): unknown district resolves to state map; add resolveMapScope + guard test"
```

---

## Task 3: `scoreFromHealthCounts()` — the pure score formula

**Files:**
- Modify: `web/server/bff.mjs` (add + export near `computeMilestoneHealth`, bff.mjs:168)
- Test: `web/server/dashboard-score.test.mjs` (create)

**Interfaces:**
- Produces: `export function scoreFromHealthCounts(counts: { green:number, amber:number, red:number, neutral:number }): number | null`

- [ ] **Step 1: Write the failing test**

```js
// web/server/dashboard-score.test.mjs
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { scoreFromHealthCounts } from './bff.mjs';

describe('scoreFromHealthCounts', () => {
  it('weights amber at half and rounds', () => {
    expect(scoreFromHealthCounts({ green: 3, amber: 1, red: 1, neutral: 9 })).toBe(70); // (3+0.5)/5=0.7
  });
  it('is null when there is no completed/failed signal', () => {
    expect(scoreFromHealthCounts({ green: 0, amber: 0, red: 0, neutral: 4 })).toBeNull();
  });
  it('is 100 when all green', () => {
    expect(scoreFromHealthCounts({ green: 2, amber: 0, red: 0, neutral: 0 })).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node node_modules/vitest/vitest.mjs run server/dashboard-score.test.mjs`
Expected: FAIL — `scoreFromHealthCounts` not exported.

- [ ] **Step 3: Write minimal implementation**

Add after `computeMilestoneHealth` in `web/server/bff.mjs` and export it (bff.mjs uses ESM `export function`):

```js
// Region score = weighted pass ratio over settled orders (neutral = no signal).
export function scoreFromHealthCounts({ green, amber, red }) {
  const denom = green + amber + red;
  if (denom === 0) return null;
  return Math.round((100 * (green + 0.5 * amber)) / denom);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node node_modules/vitest/vitest.mjs run server/dashboard-score.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/server/bff.mjs web/server/dashboard-score.test.mjs
git commit -m "feat(dashboard): pure region score formula from order health counts"
```

---

## Task 4: `GET /api/gov/dashboard/map` endpoint

**Files:**
- Modify: `web/server/bff.mjs` (add route near `/api/gov/quality`, bff.mjs:1702)
- Test: `web/server/dashboard-map.db.test.mjs` (create)

**Interfaces:**
- Consumes: `withUserSession` (db.mjs), `computeMilestoneHealth`, `scoreFromHealthCounts` (Task 3), `requireUser` (bff.mjs).
- Produces: `GET /api/gov/dashboard/map` → `{ level, key, regions: [{ id, name, score, kpis }] }` where `kpis = { openOrders, activeJobs, failedTests30d, certificates30d, vendorsActive }`; `score: number | null`.

- [ ] **Step 1: Write the failing test** (skip-if-DB-down pattern, mirrors `vendor-job-detail.db.test.mjs`)

```js
// web/server/dashboard-map.db.test.mjs
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { loadConfig } from './env.mjs';
import { createApp } from './bff.mjs';

process.env.EWORKS_USE_LOCAL_PG = process.env.EWORKS_USE_LOCAL_PG || '1';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5433';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'eworks';

const probe = new pg.Pool({ host: process.env.PGHOST, port: Number(process.env.PGPORT),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE, connectionTimeoutMillis: 1500, max: 2 });

let dbAvailable = false;
let officer = null; // { userId }
try {
  const q = await probe.query(`
    select ur.user_id as "userId"
      from eworks.user_roles ur
     where ur.role_code = 'DISTRICT_OFFICER' limit 1`);
  officer = q.rows[0] ?? null;
  dbAvailable = Boolean(officer);
} catch { dbAvailable = false; }

const provider = { async send() { return { delivered: true }; } };
const config = loadConfig({});

async function login(port, userId) {
  const r = await fetch(`http://127.0.0.1:${port}/api/dev/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }) });
  return r.headers.get('set-cookie');
}

describe.skipIf(!dbAvailable)('GET /api/gov/dashboard/map', () => {
  let srv, port;
  beforeAll(async () => {
    const app = createApp(config, { provider });
    await new Promise((res) => { srv = app.listen(0, () => { port = srv.address().port; res(); }); });
  });
  afterAll(async () => { await new Promise((r) => (srv ? srv.close(r) : r())); await probe.end(); });

  it('returns the officer district scope with shaped regions', async () => {
    const cookie = await login(port, officer.userId);
    const r = await fetch(`http://127.0.0.1:${port}/api/gov/dashboard/map`, { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.level).toBe('district');
    expect(Array.isArray(body.regions)).toBe(true);
    for (const region of body.regions) {
      expect(typeof region.id).toBe('string');
      expect(region.score === null || typeof region.score === 'number').toBe(true);
      expect(region.kpis).toEqual(expect.objectContaining({
        openOrders: expect.any(Number), activeJobs: expect.any(Number),
        failedTests30d: expect.any(Number), certificates30d: expect.any(Number),
        vendorsActive: expect.any(Number),
      }));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && EWORKS_USE_LOCAL_PG=1 node node_modules/vitest/vitest.mjs run server/dashboard-map.db.test.mjs`
Expected: FAIL — 404 (route not mounted). If it SKIPS, seed the local DB first (`docker start eworks-pg`, then a district officer must exist — the dev identity seed provides `DISTRICT_OFFICER`).

- [ ] **Step 3: Write minimal implementation**

Add this route in `createApp`, alongside `/api/gov/quality` (after bff.mjs:1756). It (a) finds the caller's anchor org unit, (b) fetches all in-scope orders tagged with their immediate-child region, computing health per order, (c) fetches the 5 KPIs per region, (d) merges.

```js
  app.get('/api/gov/dashboard/map', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const payload = await withUserSession(userId, async (client) => {
        // Anchor = caller's most senior gov org unit.
        const anchorQ = await client.query(
          `select ou.id, ou.name, ou.path::text as path, ou.level,
                  eworks.org_level_ordinal(ou.level) as ord
             from eworks.user_roles ur
             join eworks.org_units ou on ou.id = ur.org_unit_id
            where ur.user_id = eworks.current_user_id()
              and ur.role_code in ('SITE_ENGINEER','EXECUTIVE_ENGINEER','DISTRICT_OFFICER',
                                   'SUPERINTENDING_ENGINEER','AUDITOR','HEAD_ADMIN')
            order by ord asc limit 1`);
        const anchor = anchorQ.rows[0];
        if (!anchor) return { level: 'state', key: 'tamilnadu', regions: [] };
        const level = anchor.level === 'STATE' ? 'state' : 'district';
        const key = level === 'state'
          ? 'tamilnadu'
          : anchor.path.split('.')[1].toLowerCase();

        // Orders in the subtree, tagged with their immediate-child region path.
        const ordersQ = await client.query(
          `select
             child.id   as "regionId",
             child.name as "regionName",
             o.status, o.required_by as "requiredBy",
             (select count(*)::int from eworks.escalations e
               where e.order_id = o.id and e.status = 'OPEN') as "openEscalations",
             pay.status as "paymentStatus",
             coalesce(cert.signature_verified, false) as "certVerified",
             (select count(*)::int from eworks.samples s
                join eworks.test_jobs j on j.id = s.job_id where j.order_id = o.id) as "sampleCount",
             (select count(*)::int from eworks.test_results r
                join eworks.test_jobs j on j.id = r.job_id where j.order_id = o.id) as "resultCount",
             (select bool_and(r.passed) from eworks.test_results r
                join eworks.test_jobs j on j.id = r.job_id where j.order_id = o.id) as "allPassed"
           from eworks.test_orders o
           join eworks.org_units ou on ou.id = o.org_unit_id
           join eworks.org_units child
             on child.path = subltree(ou.path, 0, nlevel($1::ltree) + 1)
           left join eworks.test_jobs j on j.order_id = o.id
           left join eworks.payments pay on pay.order_id = o.id
           left join eworks.certificates cert on cert.job_id = j.id
          where o.status <> 'CANCELLED'
            and ou.path <@ $1::ltree
            and nlevel(ou.path) > nlevel($1::ltree)`,
          [anchor.path]);

        // Roll up health → score per region.
        const buckets = new Map(); // regionId -> {id,name,green,amber,red,neutral}
        for (const row of ordersQ.rows) {
          const b = buckets.get(row.regionId) ??
            { id: row.regionId, name: row.regionName, green: 0, amber: 0, red: 0, neutral: 0 };
          b[computeMilestoneHealth(row)] += 1;
          buckets.set(row.regionId, b);
        }

        // KPIs per region (subtree-scoped, 30d window).
        const kpiQ = await client.query(
          `select
             child.id as "regionId",
             count(*) filter (where o.status not in ('COMPLETE','CANCELLED'))::int as "openOrders",
             count(distinct j.id) filter (where j.status is not null
                and j.status <> 'COMPLETE')::int as "activeJobs",
             count(distinct r.id) filter (where r.passed = false
                and r.entered_at >= now() - interval '30 days')::int as "failedTests30d",
             count(distinct c.id) filter (where c.issued_at >= now() - interval '30 days')::int as "certificates30d",
             count(distinct oa.vendor_id)::int as "vendorsActive"
           from eworks.test_orders o
           join eworks.org_units ou on ou.id = o.org_unit_id
           join eworks.org_units child
             on child.path = subltree(ou.path, 0, nlevel($1::ltree) + 1)
           left join eworks.test_jobs j on j.order_id = o.id
           left join eworks.test_results r on r.job_id = j.id
           left join eworks.certificates c on c.job_id = j.id
           left join eworks.order_award oa on oa.order_id = o.id
          where o.status <> 'CANCELLED'
            and ou.path <@ $1::ltree
            and nlevel(ou.path) > nlevel($1::ltree)
          group by child.id`,
          [anchor.path]);
        const kpiById = new Map(kpiQ.rows.map((k) => [k.regionId, k]));

        const regions = [...buckets.values()].map((b) => {
          const k = kpiById.get(b.id) ?? {};
          return {
            id: b.id,
            name: b.name,
            score: scoreFromHealthCounts(b),
            kpis: {
              openOrders: k.openOrders ?? 0,
              activeJobs: k.activeJobs ?? 0,
              failedTests30d: k.failedTests30d ?? 0,
              certificates30d: k.certificates30d ?? 0,
              vendorsActive: k.vendorsActive ?? 0,
            },
          };
        });
        return { level, key, regions };
      });
      res.json(payload);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });
```

Note: `computeMilestoneHealth` returns one of `green|amber|red|neutral`, matching the bucket keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && EWORKS_USE_LOCAL_PG=1 node node_modules/vitest/vitest.mjs run server/dashboard-map.db.test.mjs`
Expected: PASS. If `subltree`/`nlevel` errors, confirm the `ltree` extension is enabled (it is — `org_units.path` is `ltree`).

- [ ] **Step 5: Commit**

```bash
git add web/server/bff.mjs web/server/dashboard-map.db.test.mjs
git commit -m "feat(dashboard): GET /api/gov/dashboard/map — RLS-scoped region scores + KPIs"
```

---

## Task 5: Map component — live data, data-driven grid, KPI sheet

**Files:**
- Modify: `web/src/components/dashboard/DistrictMap.tsx`
- Modify: `web/src/i18n/en.json`, `web/src/i18n/ta.json`
- Test: `web/src/components/dashboard/DistrictMap.test.tsx` (create)

**Interfaces:**
- Consumes: `apiClient` (`@/lib/apiClient`), `useQuery`, `performanceFromScore` (types.ts), the endpoint from Task 4.
- Produces: `DistrictMapResponse` type `{ level: 'state'|'district'; key: string; regions: MapRegion[] }`, `MapRegion = { id:string; name:string; score:number|null; kpis:{openOrders:number;activeJobs:number;failedTests30d:number;certificates30d:number;vendorsActive:number} }`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/dashboard/DistrictMap.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { DistrictPerformanceMap } from './DistrictMap';

vi.mock('@/lib/apiClient', () => ({
  apiClient: { get: vi.fn(async () => ({
    level: 'district', key: 'madurai',
    regions: [
      { id: 'r1', name: 'Melur Division', score: 82,
        kpis: { openOrders: 3, activeJobs: 2, failedTests30d: 1, certificates30d: 12, vendorsActive: 5 } },
      { id: 'r2', name: 'Quiet Division', score: null,
        kpis: { openOrders: 0, activeJobs: 0, failedTests30d: 0, certificates30d: 0, vendorsActive: 0 } },
    ],
  })) },
  ApiError: class extends Error {},
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><I18nextProvider i18n={i18n}>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nextProvider></QueryClientProvider>);
}

afterEach(cleanup);

describe('DistrictPerformanceMap live data', () => {
  it('renders live regions and marks no-data regions neutral', async () => {
    wrap(<DistrictPerformanceMap districtName="Madurai" orgPath="TN.MADURAI" />);
    await waitFor(() => expect(screen.getByText('Melur Division')).toBeInTheDocument());
    expect(screen.getByText('Quiet Division')).toBeInTheDocument();
    expect(screen.getByText('82%')).toBeInTheDocument();
    // no-data region shows a dash, not a fabricated number
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node node_modules/vitest/vitest.mjs run src/components/dashboard/DistrictMap.test.tsx`
Expected: FAIL — component still renders static registry regions ("Melur Division" from live data absent).

- [ ] **Step 3: Write minimal implementation**

In `DistrictMap.tsx`: add the fetch + type, and drive the region list/grid from the response (fall back to the static `mapDef` only while loading or on error). Add at top of `DistrictPerformanceMap`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { performanceFromScore } from './districtMaps/types';

export interface MapRegion {
  id: string; name: string; score: number | null;
  kpis: { openOrders: number; activeJobs: number; failedTests30d: number;
          certificates30d: number; vendorsActive: number };
}
export interface DistrictMapResponse { level: 'state' | 'district'; key: string; regions: MapRegion[] }
```

Inside the component body:

```tsx
  const { data: live, isPending } = useQuery<DistrictMapResponse>({
    queryKey: ['dashboard-map'],
    queryFn: () => apiClient.get<DistrictMapResponse>('/api/gov/dashboard/map'),
    staleTime: 30_000,
  });
```

Render the region list from `live?.regions`: for each region show `region.name` and, for the score, `region.score == null ? '—' : `${region.score}%`` with color `region.score == null ? PERFORMANCE_COLORS.watch : PERFORMANCE_COLORS[performanceFromScore(region.score)]`. While `isPending`, render a skeleton block (`<div className="animate-pulse …" aria-hidden />`) in place of the region list. Keep the existing SVG `mapDef` grid as the visual backdrop; overlay live scores by index for now (geometry stays schematic per the spec). Tapping a region opens the existing bottom-sheet/detail block, populated from `region.kpis` (openOrders, activeJobs, failedTests30d, certificates30d, vendorsActive) with deep links `/gov/orders?orgUnit=${region.id}` and `/gov/quality`.

Add i18n keys to **both** `en.json` and `ta.json` under `dashboard.districtMap`:

```jsonc
// en.json
"noActivity": "No activity yet",
"mapUnavailable": "District map unavailable — showing state view",
"kpi": { "openOrders": "Open orders", "activeJobs": "Active jobs",
  "failedTests30d": "Failed tests (30d)", "certificates30d": "Certificates (30d)",
  "vendorsActive": "Active vendors" }
```

```jsonc
// ta.json — Tamil translations of the same keys
"noActivity": "இன்னும் செயல்பாடு இல்லை",
"mapUnavailable": "மாவட்ட வரைபடம் கிடைக்கவில்லை — மாநில பார்வை",
"kpi": { "openOrders": "திறந்த ஆர்டர்கள்", "activeJobs": "செயலில் உள்ள பணிகள்",
  "failedTests30d": "தோல்வி சோதனைகள் (30நா)", "certificates30d": "சான்றிதழ்கள் (30நா)",
  "vendorsActive": "செயலில் உள்ள விற்பனையாளர்கள்" }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && node node_modules/vitest/vitest.mjs run src/components/dashboard/DistrictMap.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/dashboard/DistrictMap.tsx web/src/i18n/en.json web/src/i18n/ta.json web/src/components/dashboard/DistrictMap.test.tsx
git commit -m "feat(dashboard): map renders live region scores + KPI sheet; no-data neutral"
```

---

## Task 6: Wire dashboard to primaryGovRole + multi-district switcher

**Files:**
- Modify: `web/src/features/gov/RoleDashboard.tsx:498-501`
- Test: extend `web/src/components/dashboard/DistrictMap.test.tsx`

**Interfaces:**
- Consumes: `primaryGovRole` (Task 1), `resolveMapScope` (Task 2).
- Produces: dashboard passes the highest-priority gov role's `orgName`/`orgPath`; switcher shown when >1 district.

- [ ] **Step 1: Write the failing test** (add to `DistrictMap.test.tsx`)

```tsx
  it('shows a district switcher when the user holds gov roles in multiple districts', async () => {
    wrap(<DistrictPerformanceMap districtName="Madurai" orgPath="TN.MADURAI"
            districtOptions={[{ key: 'madurai', label: 'Madurai' }, { key: 'salem', label: 'Salem' }]} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && node node_modules/vitest/vitest.mjs run src/components/dashboard/DistrictMap.test.tsx`
Expected: FAIL — `districtOptions` prop unknown; no combobox.

- [ ] **Step 3: Write minimal implementation**

Add an optional `districtOptions?: { key: string; label: string }[]` prop to `DistrictPerformanceMapProps`; when its length > 1, render a `<select aria-label={t('dashboard.districtMap.switcher')}>` above the map that sets a local `activeKey` (default = resolved key). In `RoleDashboard.tsx` replace lines 498-501:

```tsx
            <DistrictPerformanceMap
              districtName={primaryGovRole(session)?.orgName ?? session?.roles?.[0]?.orgName}
              orgPath={primaryGovRole(session)?.orgPath ?? session?.roles?.[0]?.orgPath}
              districtOptions={govDistrictOptions(session)}
            />
```

Add a small `govDistrictOptions(session)` helper in `RoleDashboard.tsx` that maps the user's distinct gov-role districts (via `resolveMapScope(r.orgName, r.orgPath)`) to `{ key, label }[]` (empty/one → switcher hidden). Add `switcher: "Switch district"` to both i18n files.

- [ ] **Step 4: Run tests + full gates**

Run:
```
cd web && node node_modules/vitest/vitest.mjs run src/components/dashboard/DistrictMap.test.tsx
cd web && node node_modules/vitest/vitest.mjs run src/
cd web && node node_modules/typescript/bin/tsc -b
cd web && node node_modules/oxlint/bin/oxlint .
```
Expected: all PASS / green.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/gov/RoleDashboard.tsx web/src/components/dashboard/DistrictMap.tsx web/src/i18n/en.json web/src/i18n/ta.json web/src/components/dashboard/DistrictMap.test.tsx
git commit -m "feat(dashboard): resolve map from primaryGovRole; multi-district switcher"
```

---

## Final verification (definition of done)

- `cd web && node node_modules/vitest/vitest.mjs run` (frontend + `.db.test.mjs` with local PG) — green.
- `tsc -b` and `oxlint` — green.
- Manual demo: sign in as Salem district officer → Salem's org-unit grid colored from live data (not Coimbatore); HEAD_ADMIN → TN map; a no-activity region shows "no activity yet" (gray), not a number; strings render in en + ta.
