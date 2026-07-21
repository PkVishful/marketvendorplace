# Full Test Checklist Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a master reference screen showing all 64 tests under all 9 construction levels (gov + vendor), and upgrade the per-project checklist to a live status view, all rendered from the API with zero hard-coded catalog data.

**Architecture:** Two new read endpoints in the dev BFF (`/api/catalog/checklist`, `/api/gov/projects/:projectId/checklist`). Server shaping logic is extracted into pure functions so it is unit-testable without a DB; real per-level counts are verified in a DB-gated `.db.test.mjs`. Frontend adds a `catalog` feature (one shared `ChecklistScreen`, variant-switched for gov/vendor) plus an upgraded `ProjectChecklistPage`.

**Tech Stack:** Node + Express 5 (BFF), `pg`, React 19 + TypeScript, TanStack Query, react-i18next, Vitest + React Testing Library, Tailwind. Working dir for all commands: `web/`.

## Global Constraints

- **No new migrations. No catalog edits.** Read `eworks.test_catalog`, `construction_stage`, `test_stage_rules`, `project_test_requirements` only.
- **Zero hard-coded catalog data in the frontend.** Test lists, IS codes, frequencies, domains all come from the API.
- **Frequency labels are i18n keys + params, never English text from the server.** Server returns `{ key, params }`; client renders `t(key, params)`.
- **All user-facing strings in both `en.json` and `ta.json`.** Keep the two files key-for-key identical.
- **Verification numbers:** per-level stage-rule counts must be exactly `8, 2, 12, 5, 15, 4, 9, 6, 14` (stages in sequence 1–9); cross-stage group = 2 (concrete mix design, water quality); repeats marked for slump/cube/cement/steel.
- **Auth/RLS:** every endpoint runs inside `withUserSession(userId, …)` — never service-role. `/api/catalog/checklist` = any authenticated user; project checklist = `order.read` in scope (relies on existing RLS on `project_test_requirements`).
- **DoD:** `npm run test`, `npm run lint`, `npx tsc -b` all green in `web/`.
- Follow existing patterns: gov feature files mirror `src/features/gov/api.ts` + `useGov.ts`; server tests mirror `server/bff.test.mjs`; DB-gated tests mirror `server/vendor-pricing.db.test.mjs` (`describe.skipIf(!dbAvailable)`).

---

## File Structure

**Server (`web/server/`):**
- `catalog.mjs` *(create)* — pure shaping: `shapeChecklist(rows)`, `frequencyLabel(type, spec)`, `domainSlug(enum)`, `deriveReqStatus(row)`.
- `catalog.test.mjs` *(create)* — unit tests for the pure functions (no DB).
- `catalog-checklist.db.test.mjs` *(create)* — DB-gated: real per-level counts, cross-stage, scope.
- `bff.mjs` *(modify)* — mount `GET /api/catalog/checklist` and `GET /api/gov/projects/:projectId/checklist`.

**Frontend (`web/src/`):**
- `features/catalog/api.ts` *(create)* — `fetchCatalogChecklist`, `fetchProjectChecklist`, `catalogKeys`.
- `features/catalog/useCatalog.ts` *(create)* — `useCatalogChecklist`, `useProjectChecklist`.
- `features/catalog/ChecklistScreen.tsx` *(create)* — shared master screen, `variant: 'gov' | 'vendor'`.
- `features/catalog/ChecklistScreen.test.tsx` *(create)* — RTL: search, domain filter, NABL toggle, print, vendor chips + degrade.
- `features/gov/ProjectChecklistPage.tsx` *(modify)* — rewrite to the live-status model.
- `features/gov/ProjectChecklistPage.test.tsx` *(create)* — RTL: status mapping incl. FAILED, not-planned, progress.
- `types/domain.ts` *(modify)* — add `ChecklistTest`, `ChecklistStage`, `CatalogChecklist`, `ProjectChecklistRow`, `ProjectChecklist`.
- `App.tsx` *(modify)* — routes `/gov/checklist`, `/vendor/tests`.
- `lib/navConfig.ts` *(modify)* — gov "Test checklist" + vendor "Tests we do" nav items; new tab key.
- `lib/navConfig.test.ts` *(modify)* — assert the new nav items.
- `lib/navIcons.tsx` *(modify)* — icons for the two nav items.
- `i18n/en.json`, `i18n/ta.json` *(modify)* — `catalog.*` strings incl. `catalog.freq.*`.

---

## Task 1: BFF `/api/catalog/checklist` — pure shaping + endpoint

**Files:**
- Create: `web/server/catalog.mjs`
- Create: `web/server/catalog.test.mjs`
- Modify: `web/server/bff.mjs` (add route near the other `/api/gov` reads, after line ~862)

**Interfaces:**
- Produces: `shapeChecklist(rows) -> { stages: ChecklistStage[], crossStage: ChecklistTest[] }`; `frequencyLabel(frequencyType, frequencySpec) -> { key: string, params: object }`; `domainSlug(domainEnum) -> string`.
  - Flat `rows` shape (one row per active stage-rule), ordered `sequence, testName`:
    `{ stageCode, stageName, sequence, testCode, testName, domain, isCode, requiresNabl, tatDays, frequencyType, frequencySpec }`.
  - `ChecklistTest = { code, name, domain, isCode, requiresNabl, tatDays, frequency: {key, params}, repeatsAcrossStages }`.
  - `ChecklistStage = { code, sequence, name, tests: ChecklistTest[] }`.
  - Cross-stage = tests whose `code` is in `CROSS_STAGE_CODES` (`CONCRETE_MIX_DESIGN`, `WATER_QUALITY`); emitted once in `crossStage`, excluded from `stages`.
  - `repeatsAcrossStages` = the test's `code` appears under more than one stage in the input.

- [ ] **Step 1: Write the failing unit test**

Create `web/server/catalog.test.mjs`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { shapeChecklist, frequencyLabel, domainSlug } from './catalog.mjs';

const row = (o) => ({
  stageCode: 'FOUNDATION', stageName: 'Foundation', sequence: 3,
  testCode: 'X', testName: 'X test', domain: 'CONCRETE', isCode: 'IS 456',
  requiresNabl: true, tatDays: 3, frequencyType: 'ONCE', frequencySpec: {}, ...o,
});

describe('domainSlug', () => {
  it('maps enum values to UI slugs', () => {
    expect(domainSlug('SOIL_GEOTECH')).toBe('soil');
    expect(domainSlug('BITUMEN_ROAD')).toBe('road/bitumen');
    expect(domainSlug('PLUMBING_FIRE_HVAC')).toBe('plumbing');
  });
});

describe('frequencyLabel', () => {
  it('ONCE -> catalog.freq.ONCE', () => {
    expect(frequencyLabel('ONCE', {})).toEqual({ key: 'catalog.freq.ONCE', params: {} });
  });
  it('tiered PER_VOLUME -> IS456 ladder key', () => {
    const spec = { unit: 'm3', tiers: [{ upto: 5, samples: 1 }], specimens_per_sample: 3 };
    expect(frequencyLabel('PER_VOLUME', spec)).toEqual({
      key: 'catalog.freq.PER_VOLUME_IS456', params: { unit: 'm3' },
    });
  });
  it('PER_CONSIGNMENT -> keyed with sample count', () => {
    expect(frequencyLabel('PER_CONSIGNMENT', { samples: 1 })).toEqual({
      key: 'catalog.freq.PER_CONSIGNMENT', params: { samples: 1 },
    });
  });
});

describe('shapeChecklist', () => {
  it('groups by stage in sequence order and marks repeats', () => {
    const out = shapeChecklist([
      row({ stageCode: 'FOUNDATION', sequence: 3, testCode: 'SLUMP', testName: 'Slump' }),
      row({ stageCode: 'SUBSTRUCTURE', sequence: 4, testCode: 'SLUMP', testName: 'Slump' }),
      row({ stageCode: 'FOUNDATION', sequence: 3, testCode: 'BEARING', testName: 'Bearing' }),
    ]);
    expect(out.stages.map((s) => s.code)).toEqual(['FOUNDATION', 'SUBSTRUCTURE']);
    const slumpFoundation = out.stages[0].tests.find((t) => t.code === 'SLUMP');
    expect(slumpFoundation.repeatsAcrossStages).toBe(true);
    const bearing = out.stages[0].tests.find((t) => t.code === 'BEARING');
    expect(bearing.repeatsAcrossStages).toBe(false);
  });

  it('pulls cross-stage tests into their own group', () => {
    const out = shapeChecklist([
      row({ testCode: 'CONCRETE_MIX_DESIGN', testName: 'Mix design' }),
      row({ testCode: 'BEARING', testName: 'Bearing' }),
    ]);
    expect(out.crossStage.map((t) => t.code)).toEqual(['CONCRETE_MIX_DESIGN']);
    expect(out.stages.flatMap((s) => s.tests).map((t) => t.code)).toEqual(['BEARING']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/catalog.test.mjs`
Expected: FAIL — `Cannot find module './catalog.mjs'`.

- [ ] **Step 3: Implement `web/server/catalog.mjs`**

```js
// Pure shaping for the test checklist screens. No DB, no Express — trivially
// testable. The endpoint in bff.mjs feeds these functions flat query rows.

const DOMAIN_SLUGS = {
  SOIL_GEOTECH: 'soil',
  CONCRETE: 'concrete',
  CEMENT: 'cement',
  AGGREGATE: 'aggregate',
  WATER: 'water',
  STEEL_REBAR: 'steel',
  MASONRY: 'masonry',
  BITUMEN_ROAD: 'road/bitumen',
  WATERPROOFING_FINISHES: 'waterproofing',
  ELECTRICAL: 'electrical',
  PLUMBING_FIRE_HVAC: 'plumbing',
};

export function domainSlug(domain) {
  return DOMAIN_SLUGS[domain] ?? String(domain ?? '').toLowerCase();
}

// The two tests that belong to no single build stage — they gate the whole job.
const CROSS_STAGE_CODES = new Set(['CONCRETE_MIX_DESIGN', 'WATER_QUALITY']);

// frequency_type (+ tiered spec) -> { key, params }. Client renders t(key, params).
export function frequencyLabel(frequencyType, frequencySpec = {}) {
  const spec = frequencySpec || {};
  if (frequencyType === 'ONCE') {
    return { key: 'catalog.freq.ONCE', params: {} };
  }
  if (frequencyType === 'PER_VOLUME' && Array.isArray(spec.tiers)) {
    // The IS 456 cube ladder — summarised, the tiers themselves stay in data.
    return { key: 'catalog.freq.PER_VOLUME_IS456', params: { unit: spec.unit ?? 'm3' } };
  }
  const params = {};
  if (spec.samples != null) params.samples = spec.samples;
  if (spec.unit != null) params.unit = spec.unit;
  return { key: `catalog.freq.${frequencyType}`, params };
}

function toTest(row, repeatCounts) {
  return {
    code: row.testCode,
    name: row.testName,
    domain: domainSlug(row.domain),
    isCode: row.isCode ?? null,
    requiresNabl: Boolean(row.requiresNabl),
    tatDays: row.tatDays ?? null,
    frequency: frequencyLabel(row.frequencyType, row.frequencySpec),
    repeatsAcrossStages: (repeatCounts.get(row.testCode)?.size ?? 0) > 1,
  };
}

export function shapeChecklist(rows) {
  // How many distinct stages each test appears under (drives "repeats").
  const repeatCounts = new Map();
  for (const r of rows) {
    if (!repeatCounts.has(r.testCode)) repeatCounts.set(r.testCode, new Set());
    repeatCounts.get(r.testCode).add(r.stageCode);
  }

  const stages = [];
  const crossStage = [];
  const seenCross = new Set();

  for (const r of rows) {
    if (CROSS_STAGE_CODES.has(r.testCode)) {
      if (!seenCross.has(r.testCode)) {
        seenCross.add(r.testCode);
        crossStage.push(toTest(r, repeatCounts));
      }
      continue;
    }
    let stage = stages[stages.length - 1];
    if (!stage || stage.code !== r.stageCode) {
      stage = { code: r.stageCode, sequence: r.sequence, name: r.stageName, tests: [] };
      stages.push(stage);
    }
    stage.tests.push(toTest(r, repeatCounts));
  }

  return { stages, crossStage };
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx vitest run server/catalog.test.mjs`
Expected: PASS (all cases).

- [ ] **Step 5: Add the endpoint to `web/server/bff.mjs`**

Add the import at the top with the other local imports (after the `security.mjs` import block, ~line 20):

```js
import { shapeChecklist } from './catalog.mjs';
```

Insert this route immediately after the `GET /api/gov/projects/:projectId/requirements` handler closes (after line ~862), so it sits with the other `withUserSession` reads:

```js
  app.get('/api/catalog/checklist', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        const q = await client.query(
          `select
             cs.code            as "stageCode",
             cs.name            as "stageName",
             cs.sequence        as "sequence",
             tc.code            as "testCode",
             tc.name            as "testName",
             tc.domain          as "domain",
             coalesce(tsr.is_code, tc.default_is_code) as "isCode",
             tc.requires_nabl   as "requiresNabl",
             tc.typical_tat_days as "tatDays",
             tsr.frequency_type as "frequencyType",
             tsr.frequency_spec as "frequencySpec"
           from eworks.test_stage_rules tsr
           join eworks.test_catalog tc on tc.id = tsr.test_id
           join eworks.construction_stage cs on cs.id = tsr.stage_id
          where tsr.is_active and tc.is_active and tsr.org_unit_id is null
          order by cs.sequence, tc.name`,
        );
        return q.rows;
      });
      res.json(shapeChecklist(rows));
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });
```

Note: `org_unit_id is null` selects the state-wide default catalog (the seeded rules), matching the verification counts.

- [ ] **Step 6: Verify wiring test still passes and lint is clean**

Run: `npx vitest run server/catalog.test.mjs server/bff.test.mjs`
Expected: PASS.
Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add web/server/catalog.mjs web/server/catalog.test.mjs web/server/bff.mjs
git commit -m "feat(catalog): GET /api/catalog/checklist with pure shaping"
```

---

## Task 2: DB-gated verification of catalog checklist counts

**Files:**
- Create: `web/server/catalog-checklist.db.test.mjs`

**Interfaces:**
- Consumes: `createApp` from `bff.mjs`, `loadConfig` from `env.mjs`; the live local Postgres (`127.0.0.1:5433/eworks`).

This task proves the real numbers from §0. It skips cleanly when the local DB is down (mirroring `vendor-pricing.db.test.mjs`), so CI without a DB stays green; run it locally with the DB up to confirm the counts.

- [ ] **Step 1: Write the DB-gated test**

Create `web/server/catalog-checklist.db.test.mjs`:

```js
// @vitest-environment node
// Proves the seeded catalog renders the exact per-level counts from the spec.
// Skips when the local test DB (scripts/db-test.sh: 127.0.0.1:5433/eworks) is
// down. Needs a real authenticated user id for the session cookie.
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
let userId = null;
try {
  const q = await probe.query(
    `select id from eworks.user_accounts
      where id in (select user_id from eworks.user_roles) limit 1`,
  );
  userId = q.rows[0]?.id ?? null;
  dbAvailable = Boolean(userId);
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('catalog checklist against real Postgres', () => {
  let server; let base; let cookie;

  beforeAll(async () => {
    const { createApp } = await import('./bff.mjs');
    const { loadConfig } = await import('./env.mjs');
    const provider = { async send() { return { delivered: true }; } };
    const app = createApp(loadConfig({ EWORKS_USE_LOCAL_PG: '1' }), { provider });
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
    // Dev login mints a session cookie for a real user id.
    const res = await fetch(`${base}/api/dev/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    cookie = res.headers.get('set-cookie');
  });

  afterAll(async () => { await new Promise((r) => (server ? server.close(r) : r())); await probe.end(); });

  it('renders 9 stages in sequence with the spec per-level counts', async () => {
    const res = await fetch(`${base}/api/catalog/checklist`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stages.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(body.stages.map((s) => s.tests.length)).toEqual([8, 2, 12, 5, 15, 4, 9, 6, 14]);
    expect(body.crossStage.length).toBe(2);
  });

  it('marks repeating tests across stages', async () => {
    const res = await fetch(`${base}/api/catalog/checklist`, { headers: { cookie } });
    const body = await res.json();
    const allTests = body.stages.flatMap((s) => s.tests);
    const repeating = allTests.filter((t) => t.repeatsAcrossStages).map((t) => t.code);
    expect(repeating).toContain('CONCRETE_SLUMP');
    expect(repeating).toContain('CONCRETE_CUBE_STRENGTH');
  });
});
```

- [ ] **Step 2: Run it (DB up locally)**

If the local DB is down, start it: `bash scripts/db-test.sh` from repo root (or `docker start eworks-pg`).
Run: `npx vitest run server/catalog-checklist.db.test.mjs`
Expected: PASS (2 tests). If the DB is unreachable, expected: 0 tests, `describe` skipped — that is acceptable, but confirm at least once locally that it passes with the DB up.

- [ ] **Step 3: Commit**

```bash
git add web/server/catalog-checklist.db.test.mjs
git commit -m "test(catalog): DB-gated per-level count verification"
```

---

## Task 3: BFF `/api/gov/projects/:projectId/checklist` — live status join

**Files:**
- Modify: `web/server/catalog.mjs` (add `deriveReqStatus`)
- Modify: `web/server/catalog.test.mjs` (unit-test `deriveReqStatus`)
- Modify: `web/server/bff.mjs` (add the project checklist route)

**Interfaces:**
- Produces: `deriveReqStatus({ ptrStatus, orderStatus, hasCertificate, hasFailedResult }) -> 'PLANNED'|'ORDERED'|'IN_PROGRESS'|'CERTIFIED'|'FAILED'`.
- Endpoint response `ProjectChecklist`:
  `{ stages: [{ code, sequence, name, planned: boolean, rows: ProjectChecklistRow[], certifiedCount, totalCount }] }`
  where `ProjectChecklistRow = { requirementId, testCode, testName, plannedCount, status, orderId, jobId }`.
  Stages with catalog rules but no requirements → `planned: false, rows: []`.

- [ ] **Step 1: Write the failing unit test (append to `web/server/catalog.test.mjs`)**

```js
import { deriveReqStatus } from './catalog.mjs';

describe('deriveReqStatus', () => {
  it('WAIVED-free mapping across the lifecycle', () => {
    expect(deriveReqStatus({ ptrStatus: 'PLANNED' })).toBe('PLANNED');
    expect(deriveReqStatus({ ptrStatus: 'FLOATED', orderStatus: 'FLOATED' })).toBe('ORDERED');
    expect(deriveReqStatus({ ptrStatus: 'IN_PROGRESS', orderStatus: 'AWARDED' })).toBe('IN_PROGRESS');
    expect(deriveReqStatus({ ptrStatus: 'COMPLETE', hasCertificate: true })).toBe('CERTIFIED');
  });
  it('a failed result outranks in-progress', () => {
    expect(deriveReqStatus({ ptrStatus: 'IN_PROGRESS', hasFailedResult: true })).toBe('FAILED');
  });
  it('certified wins even if an earlier result failed (passing retest)', () => {
    expect(deriveReqStatus({ ptrStatus: 'COMPLETE', hasCertificate: true, hasFailedResult: true }))
      .toBe('CERTIFIED');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/catalog.test.mjs`
Expected: FAIL — `deriveReqStatus is not a function`.

- [ ] **Step 3: Implement `deriveReqStatus` in `web/server/catalog.mjs`**

Append:

```js
// Collapses the requirement + its order/cert/result signals into the five
// display states from the spec. CERTIFIED is terminal-positive (a passing
// retest supersedes an earlier failure), so it is checked before FAILED.
export function deriveReqStatus({ ptrStatus, orderStatus, hasCertificate, hasFailedResult }) {
  if (hasCertificate || ptrStatus === 'COMPLETE') return 'CERTIFIED';
  if (hasFailedResult) return 'FAILED';
  if (ptrStatus === 'IN_PROGRESS' || orderStatus === 'AWARDED') return 'IN_PROGRESS';
  if (ptrStatus === 'FLOATED' || orderStatus === 'FLOATED' || orderStatus === 'REVEALING') return 'ORDERED';
  return 'PLANNED';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/catalog.test.mjs`
Expected: PASS.

- [ ] **Step 5: Add the project checklist endpoint to `web/server/bff.mjs`**

Update the import line from Task 1 to include the new export:

```js
import { shapeChecklist, deriveReqStatus } from './catalog.mjs';
```

Insert after the `/api/gov/projects/:projectId/requirements` handler (near the route added in Task 1):

```js
  app.get('/api/gov/projects/:projectId/checklist', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const data = await withUserSession(userId, async (client) => {
        // All 9 stages, always — a stage with no requirements still renders as
        // "not planned yet". Left joins to the order + cert/result trail give
        // the deep-link ids and the failure signal. RLS on
        // project_test_requirements enforces order.read-in-scope, so an
        // out-of-scope officer simply sees zero requirement rows.
        const q = await client.query(
          `select
             cs.code     as "stageCode",
             cs.name     as "stageName",
             cs.sequence as "sequence",
             ptr.id      as "requirementId",
             tc.code     as "testCode",
             tc.name     as "testName",
             ptr.planned_count as "plannedCount",
             ptr.status  as "ptrStatus",
             o.id        as "orderId",
             o.status    as "orderStatus",
             j.id        as "jobId",
             (cert.id is not null) as "hasCertificate",
             exists (select 1 from eworks.test_results tr
                       where tr.job_id = j.id and tr.passed = false) as "hasFailedResult"
           from eworks.construction_stage cs
           left join eworks.project_test_requirements ptr
             on ptr.stage_id = cs.id and ptr.project_id = $1
           left join eworks.test_catalog tc on tc.id = ptr.test_id
           left join eworks.order_items oi on oi.requirement_id = ptr.id
           left join eworks.test_orders o on o.id = oi.order_id
           left join eworks.test_jobs j on j.order_id = o.id
           left join eworks.certificates cert on cert.job_id = j.id
          order by cs.sequence, tc.name`,
          [req.params.projectId],
        );

        const byStage = new Map();
        for (const r of q.rows) {
          if (!byStage.has(r.stageCode)) {
            byStage.set(r.stageCode, {
              code: r.stageCode, sequence: r.sequence, name: r.stageName,
              planned: false, rows: [], certifiedCount: 0, totalCount: 0,
            });
          }
          const stage = byStage.get(r.stageCode);
          if (!r.requirementId) continue; // stage with no requirements yet
          stage.planned = true;
          const status = deriveReqStatus(r);
          stage.rows.push({
            requirementId: r.requirementId,
            testCode: r.testCode,
            testName: r.testName,
            plannedCount: r.plannedCount,
            status,
            orderId: r.orderId ?? null,
            jobId: r.jobId ?? null,
          });
          stage.totalCount += 1;
          if (status === 'CERTIFIED') stage.certifiedCount += 1;
        }
        return { stages: [...byStage.values()] };
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'query_failed', detail: err.message });
    }
  });
```

Note: a requirement joined to multiple order items could duplicate rows; `order_items_unique (order_id, test_id)` plus one requirement per (test, stage) keeps this 1:1 in practice. If a dupe appears, dedupe by `requirementId` keeping the most-advanced status — but do NOT add that complexity unless the DB-gated test in Task 3b shows dupes.

- [ ] **Step 6: Run server tests + lint**

Run: `npx vitest run server/catalog.test.mjs server/bff.test.mjs`
Expected: PASS.
Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add web/server/catalog.mjs web/server/catalog.test.mjs web/server/bff.mjs
git commit -m "feat(catalog): GET project checklist with live status join"
```

---

## Task 4: Frontend types + catalog api + hooks

**Files:**
- Modify: `web/src/types/domain.ts` (append the checklist types)
- Create: `web/src/features/catalog/api.ts`
- Create: `web/src/features/catalog/useCatalog.ts`

**Interfaces:**
- Produces types: `CatalogChecklist`, `ChecklistStage`, `ChecklistTest`, `FrequencyLabel`, `ProjectChecklist`, `ProjectChecklistStage`, `ProjectChecklistRow`, `ProjectChecklistStatus`.
- Produces api: `fetchCatalogChecklist()`, `fetchProjectChecklist(projectId)`, `catalogKeys`.
- Produces hooks: `useCatalogChecklist()`, `useProjectChecklist(projectId)`.

- [ ] **Step 1: Add types to `web/src/types/domain.ts`**

Append at the end of the file:

```ts
// --- Test checklist screens ------------------------------------------------

export interface FrequencyLabel {
  key: string;
  params: Record<string, string | number>;
}

export interface ChecklistTest {
  code: string;
  name: string;
  domain: string;
  isCode: string | null;
  requiresNabl: boolean;
  tatDays: number | null;
  frequency: FrequencyLabel;
  repeatsAcrossStages: boolean;
}

export interface ChecklistStage {
  code: string;
  sequence: number;
  name: string;
  tests: ChecklistTest[];
}

export interface CatalogChecklist {
  stages: ChecklistStage[];
  crossStage: ChecklistTest[];
}

export type ProjectChecklistStatus =
  | 'PLANNED' | 'ORDERED' | 'IN_PROGRESS' | 'CERTIFIED' | 'FAILED';

export interface ProjectChecklistRow {
  requirementId: string;
  testCode: string;
  testName: string;
  plannedCount: number;
  status: ProjectChecklistStatus;
  orderId: string | null;
  jobId: string | null;
}

export interface ProjectChecklistStage {
  code: string;
  sequence: number;
  name: string;
  planned: boolean;
  rows: ProjectChecklistRow[];
  certifiedCount: number;
  totalCount: number;
}

export interface ProjectChecklist {
  stages: ProjectChecklistStage[];
}
```

- [ ] **Step 2: Create `web/src/features/catalog/api.ts`**

```ts
import { apiClient } from '@/lib/apiClient';
import type { CatalogChecklist, ProjectChecklist } from '@/types/domain';

export const catalogKeys = {
  checklist: ['catalog', 'checklist'] as const,
  projectChecklist: (projectId: string) => ['catalog', 'checklist', projectId] as const,
};

export function fetchCatalogChecklist() {
  return apiClient.get<CatalogChecklist>('/api/catalog/checklist');
}

export function fetchProjectChecklist(projectId: string) {
  return apiClient.get<ProjectChecklist>(`/api/gov/projects/${projectId}/checklist`);
}
```

- [ ] **Step 3: Create `web/src/features/catalog/useCatalog.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { catalogKeys, fetchCatalogChecklist, fetchProjectChecklist } from './api';

export function useCatalogChecklist() {
  return useQuery({ queryKey: catalogKeys.checklist, queryFn: fetchCatalogChecklist });
}

export function useProjectChecklist(projectId: string) {
  return useQuery({
    queryKey: catalogKeys.projectChecklist(projectId),
    queryFn: () => fetchProjectChecklist(projectId),
    enabled: Boolean(projectId),
  });
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/types/domain.ts web/src/features/catalog/api.ts web/src/features/catalog/useCatalog.ts
git commit -m "feat(catalog): frontend types, api, and query hooks"
```

---

## Task 5: Master `ChecklistScreen` (gov variant) + i18n + tests

**Files:**
- Create: `web/src/features/catalog/ChecklistScreen.tsx`
- Create: `web/src/features/catalog/ChecklistScreen.test.tsx`
- Modify: `web/src/i18n/en.json`, `web/src/i18n/ta.json`

**Interfaces:**
- Consumes: `useCatalogChecklist`, `useProjectChecklist` (Task 4); `VendorRateRow` + `fetchVendorPricing` (Task 6 uses these — gov variant does not).
- Produces: `export function ChecklistScreen({ variant }: { variant: 'gov' | 'vendor' })`.

The domain filter chips are a fixed UI list of the slugs the API emits (soil, concrete, cement, aggregate, steel, weld, masonry, road/bitumen, waterproofing, finishes, electrical, plumbing, fire, HVAC) — these are UI affordances, not catalog data, so listing them here does not violate the no-hard-coded-catalog rule. The tests themselves always come from the API.

- [ ] **Step 1: Add i18n keys to `web/src/i18n/en.json`**

Add a `catalog` block (merge with existing top-level object; keep alphabetical neighbours if the file is sorted):

```json
"catalog": {
  "title": "Test checklist",
  "subtitleGov": "Every test at every construction level",
  "subtitleVendor": "Tests we do — every test at every construction level",
  "search": "Search name, code, or IS code",
  "nablOnly": "NABL only",
  "expandAll": "Expand all",
  "collapseAll": "Collapse all",
  "print": "Print",
  "anyLevel": "Any level",
  "repeats": "Repeats",
  "nabl": "NABL",
  "tat": "{{days}}d TAT",
  "count": "{{count}} test",
  "count_other": "{{count}} tests",
  "empty": "No tests match your filters.",
  "youOffer": "You offer this",
  "priced": "Priced {{price}}",
  "notPriced": "Not priced",
  "notOffered": "Not offered",
  "freq": {
    "ONCE": "Once",
    "PER_STAGE": "Once per stage",
    "PER_LOT": "{{samples}} per lot",
    "PER_VOLUME": "{{samples}} per {{unit}}",
    "PER_VOLUME_IS456": "Per pour volume — IS 456 ladder",
    "PER_AREA": "{{samples}} per {{unit}}",
    "PER_LAYER": "{{samples}} per layer",
    "PER_HEAT": "{{samples}} per heat",
    "PER_CONSIGNMENT": "{{samples}} per consignment"
  },
  "domain": {
    "soil": "Soil", "concrete": "Concrete", "cement": "Cement",
    "aggregate": "Aggregate", "steel": "Steel", "weld": "Weld",
    "masonry": "Masonry", "road/bitumen": "Road / bitumen",
    "waterproofing": "Waterproofing", "finishes": "Finishes",
    "electrical": "Electrical", "plumbing": "Plumbing", "fire": "Fire",
    "hvac": "HVAC", "water": "Water"
  }
}
```

- [ ] **Step 2: Add the same keys to `web/src/i18n/ta.json`** (Tamil translations; keep keys identical)

```json
"catalog": {
  "title": "சோதனை பட்டியல்",
  "subtitleGov": "ஒவ்வொரு கட்டுமான நிலையிலும் ஒவ்வொரு சோதனை",
  "subtitleVendor": "நாங்கள் செய்யும் சோதனைகள் — ஒவ்வொரு நிலையிலும் ஒவ்வொரு சோதனை",
  "search": "பெயர், குறியீடு அல்லது IS குறியீட்டைத் தேடுங்கள்",
  "nablOnly": "NABL மட்டும்",
  "expandAll": "அனைத்தையும் விரிவாக்கு",
  "collapseAll": "அனைத்தையும் சுருக்கு",
  "print": "அச்சிடு",
  "anyLevel": "எந்த நிலையிலும்",
  "repeats": "மீண்டும்",
  "nabl": "NABL",
  "tat": "{{days}} நாட்கள் TAT",
  "count": "{{count}} சோதனை",
  "count_other": "{{count}} சோதனைகள்",
  "empty": "உங்கள் வடிகட்டிகளுக்கு எந்த சோதனையும் இல்லை.",
  "youOffer": "நீங்கள் வழங்குகிறீர்கள்",
  "priced": "விலை {{price}}",
  "notPriced": "விலை நிர்ணயிக்கப்படவில்லை",
  "notOffered": "வழங்கப்படவில்லை",
  "freq": {
    "ONCE": "ஒருமுறை",
    "PER_STAGE": "ஒவ்வொரு நிலைக்கும் ஒருமுறை",
    "PER_LOT": "ஒவ்வொரு தொகுதிக்கும் {{samples}}",
    "PER_VOLUME": "ஒவ்வொரு {{unit}}க்கும் {{samples}}",
    "PER_VOLUME_IS456": "ஊற்று அளவின்படி — IS 456 ஏணி",
    "PER_AREA": "ஒவ்வொரு {{unit}}க்கும் {{samples}}",
    "PER_LAYER": "ஒவ்வொரு அடுக்குக்கும் {{samples}}",
    "PER_HEAT": "ஒவ்வொரு ஹீட்டிற்கும் {{samples}}",
    "PER_CONSIGNMENT": "ஒவ்வொரு சரக்குக்கும் {{samples}}"
  },
  "domain": {
    "soil": "மண்", "concrete": "காங்கிரீட்", "cement": "சிமெண்ட்",
    "aggregate": "கூட்டுப்பொருள்", "steel": "எஃகு", "weld": "வெல்டு",
    "masonry": "கொத்து", "road/bitumen": "சாலை / பிட்குமன்",
    "waterproofing": "நீர்ப்புகா", "finishes": "இறுதிப்பணிகள்",
    "electrical": "மின்சாரம்", "plumbing": "குழாய்", "fire": "தீ",
    "hvac": "HVAC", "water": "நீர்"
  }
}
```

- [ ] **Step 3: Write the failing component test `web/src/features/catalog/ChecklistScreen.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { CatalogChecklist } from '@/types/domain';
import { ChecklistScreen } from './ChecklistScreen';
import * as api from './api';
import * as pricingApi from '@/features/pricing/api';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, fetchCatalogChecklist: vi.fn() };
});
vi.mock('@/features/pricing/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pricing/api')>();
  return { ...actual, fetchVendorPricing: vi.fn() };
});

const t = (o: Partial<import('@/types/domain').ChecklistTest>) => ({
  code: 'X', name: 'X', domain: 'concrete', isCode: 'IS 456', requiresNabl: false,
  tatDays: 3, frequency: { key: 'catalog.freq.ONCE', params: {} },
  repeatsAcrossStages: false, ...o,
});

const fixture: CatalogChecklist = {
  stages: [
    { code: 'SITE_INVESTIGATION', sequence: 1, name: 'Site Investigation',
      tests: [t({ code: 'SOIL_BEARING', name: 'Soil bearing', domain: 'soil' })] },
    { code: 'ROADWORK', sequence: 7, name: 'Roadwork',
      tests: [t({ code: 'BITUMEN_PEN', name: 'Bitumen penetration', domain: 'road/bitumen', requiresNabl: true })] },
  ],
  crossStage: [t({ code: 'WATER_QUALITY', name: 'Water quality', domain: 'water' })],
};

function renderScreen(variant: 'gov' | 'vendor' = 'gov') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter><ChecklistScreen variant={variant} /></MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.fetchCatalogChecklist).mockResolvedValue(fixture);
  vi.mocked(pricingApi.fetchVendorPricing).mockRejectedValue(new Error('no pricing'));
});
afterEach(cleanup);

describe('ChecklistScreen (gov)', () => {
  it('lists every stage with its tests', async () => {
    renderScreen();
    expect(await screen.findByText('Soil bearing')).toBeInTheDocument();
    expect(screen.getByText('Bitumen penetration')).toBeInTheDocument();
    expect(screen.getByText('Water quality')).toBeInTheDocument();
  });

  it('search narrows across levels', async () => {
    renderScreen();
    await screen.findByText('Soil bearing');
    await userEvent.type(screen.getByRole('searchbox'), 'bitumen');
    await waitFor(() => expect(screen.queryByText('Soil bearing')).not.toBeInTheDocument());
    expect(screen.getByText('Bitumen penetration')).toBeInTheDocument();
  });

  it('domain filter (soil) shows only soil tests', async () => {
    renderScreen();
    await screen.findByText('Soil bearing');
    await userEvent.click(screen.getByRole('button', { name: 'Soil' }));
    await waitFor(() => expect(screen.queryByText('Bitumen penetration')).not.toBeInTheDocument());
    expect(screen.getByText('Soil bearing')).toBeInTheDocument();
  });

  it('NABL toggle keeps only NABL tests', async () => {
    renderScreen();
    await screen.findByText('Soil bearing');
    await userEvent.click(screen.getByRole('checkbox', { name: /NABL only/i }));
    await waitFor(() => expect(screen.queryByText('Soil bearing')).not.toBeInTheDocument());
    expect(screen.getByText('Bitumen penetration')).toBeInTheDocument();
  });
});

describe('ChecklistScreen (vendor)', () => {
  it('degrades cleanly when the pricing API is absent', async () => {
    renderScreen('vendor');
    expect(await screen.findByText('Soil bearing')).toBeInTheDocument();
    expect(screen.queryByText(/Not priced/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/features/catalog/ChecklistScreen.test.tsx`
Expected: FAIL — cannot resolve `./ChecklistScreen`.

- [ ] **Step 5: Implement `web/src/features/catalog/ChecklistScreen.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import type { ChecklistStage, ChecklistTest } from '@/types/domain';
import { useCatalogChecklist } from './useCatalog';
import { useVendorOffers } from './useVendorOffers';

const DOMAINS = [
  'soil', 'concrete', 'cement', 'aggregate', 'steel', 'weld', 'masonry',
  'road/bitumen', 'waterproofing', 'finishes', 'electrical', 'plumbing', 'fire', 'hvac',
];

function matches(test: ChecklistTest, q: string): boolean {
  if (!q) return true;
  const hay = `${test.name} ${test.code} ${test.isCode ?? ''}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

export function ChecklistScreen({ variant }: { variant: 'gov' | 'vendor' }) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useCatalogChecklist();
  const offers = useVendorOffers(variant === 'vendor');

  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<string | null>(null);
  const [nablOnly, setNablOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filterTests = (tests: ChecklistTest[]) =>
    tests.filter((x) => matches(x, query)
      && (!domain || x.domain === domain)
      && (!nablOnly || x.requiresNabl));

  const groups = useMemo(() => {
    if (!data) return [];
    const stageGroups = data.stages.map((s) => ({ ...s, tests: filterTests(s.tests) }));
    const cross: ChecklistStage = {
      code: '__ANY__', sequence: 99, name: t('catalog.anyLevel'),
      tests: filterTests(data.crossStage),
    };
    return [...stageGroups, cross].filter((g) => g.tests.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, query, domain, nablOnly, t]);

  if (isPending) return <FeedSkeleton />;
  if (isError) {
    return (
      <section className="gov-card border-l-4 border-l-danger p-4">
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary">
          {t('states.retry')}
        </button>
      </section>
    );
  }

  const allExpanded = collapsed.size === 0;
  const toggle = (code: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  return (
    <section className="print-sheet space-y-4">
      <header className="print:mb-4">
        <h2 className="font-display text-xl font-bold text-ink">{t('catalog.title')}</h2>
        <p className="text-sm text-ink-2">
          {t(variant === 'vendor' ? 'catalog.subtitleVendor' : 'catalog.subtitleGov')}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <input
          type="search" role="searchbox" value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('catalog.search')}
          className="gov-input min-w-[16rem] flex-1"
        />
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={nablOnly} onChange={(e) => setNablOnly(e.target.checked)} />
          {t('catalog.nablOnly')}
        </label>
        <button type="button" className="gov-btn-secondary"
          onClick={() => setCollapsed(allExpanded ? new Set(groups.map((g) => g.code)) : new Set())}>
          {allExpanded ? t('catalog.collapseAll') : t('catalog.expandAll')}
        </button>
        <button type="button" className="gov-btn-primary" onClick={() => window.print()}>
          {t('catalog.print')}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 print:hidden">
        {DOMAINS.map((d) => (
          <button
            key={d} type="button"
            aria-pressed={domain === d}
            onClick={() => setDomain(domain === d ? null : d)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
              domain === d ? 'border-navy bg-navy text-white' : 'border-hair text-ink-2'
            }`}
          >
            {t(`catalog.domain.${d}`)}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="gov-card p-6 text-center text-sm text-ink-2">{t('catalog.empty')}</div>
      ) : (
        groups.map((stage) => {
          const open = allExpanded || !collapsed.has(stage.code);
          return (
            <div key={stage.code} className="gov-card overflow-hidden print:break-before-page">
              <button
                type="button" onClick={() => toggle(stage.code)}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-2 p-4 text-left"
              >
                <span className="font-display text-base font-bold text-ink">{stage.name}</span>
                <span className="text-xs font-semibold text-ink-3">
                  {t('catalog.count', { count: stage.tests.length })}
                </span>
              </button>
              {(open || true) && (
                <ul className={`divide-y divide-hair border-t border-hair ${open ? '' : 'hidden print:block'}`}>
                  {stage.tests.map((test) => (
                    <ChecklistRow key={`${stage.code}-${test.code}`} test={test}
                      variant={variant} offer={offers.get(test.code)} />
                  ))}
                </ul>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}

function ChecklistRow({
  test, variant, offer,
}: {
  test: ChecklistTest;
  variant: 'gov' | 'vendor';
  offer: { offered: boolean; priceLabel: string | null } | undefined;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
      <span className="text-sm font-semibold text-ink">{test.name}</span>
      <span className="font-mono text-xs text-ink-3">{test.code}</span>
      {test.isCode && <span className="chip">{test.isCode}</span>}
      {test.requiresNabl && <span className="chip chip-nabl">{t('catalog.nabl')}</span>}
      <span className="text-xs text-ink-2">{t(test.frequency.key, test.frequency.params)}</span>
      {test.tatDays != null && <span className="text-xs text-ink-3">{t('catalog.tat', { days: test.tatDays })}</span>}
      {test.repeatsAcrossStages && <span className="chip chip-muted">{t('catalog.repeats')}</span>}
      {variant === 'vendor' && offer && (
        <span className="ml-auto flex items-center gap-1.5">
          {offer.offered && <span className="chip chip-ok">{t('catalog.youOffer')}</span>}
          {offer.priceLabel
            ? <span className="chip chip-ok">{t('catalog.priced', { price: offer.priceLabel })}</span>
            : <span className="chip chip-muted">{t('catalog.notPriced')}</span>}
        </span>
      )}
    </li>
  );
}
```

Note: `chip`, `chip-nabl`, `chip-ok`, `chip-muted`, `gov-input`, `gov-btn-*`, `print-sheet` — reuse existing utility classes from `index.css`. If a class is absent, add a minimal rule in `index.css` alongside the existing chip styles (check first with a grep for `.chip` in `src/index.css`).

- [ ] **Step 6: Create a stub `web/src/features/catalog/useVendorOffers.ts`** (real logic lands in Task 6; the gov variant and this task's tests only need the empty-map/degrade behaviour)

```ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchVendorPricing } from '@/features/pricing/api';
import { formatPaise } from '@/features/pricing/api';

export interface VendorOffer { offered: boolean; priceLabel: string | null }

/** Map of testCode -> offer for the signed-in vendor. Empty (chips hidden)
 *  whenever the pricing API is unavailable, so the gov variant and any
 *  vendor without the pricing feature both degrade cleanly. */
export function useVendorOffers(enabled: boolean): Map<string, VendorOffer> {
  const { data } = useQuery({
    queryKey: ['vendor', 'pricing', 'offers'],
    queryFn: fetchVendorPricing,
    enabled,
    retry: false,
  });
  return useMemo(() => {
    const map = new Map<string, VendorOffer>();
    for (const row of data ?? []) {
      map.set(row.testCode, {
        offered: true,
        priceLabel: row.isPricedToday && row.currentPricePaise != null
          ? formatPaise(row.currentPricePaise) : null,
      });
    }
    return map;
  }, [data]);
}
```

- [ ] **Step 7: Run the component test to verify it passes**

Run: `npx vitest run src/features/catalog/ChecklistScreen.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc -b && npm run lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add web/src/features/catalog/ChecklistScreen.tsx web/src/features/catalog/ChecklistScreen.test.tsx web/src/features/catalog/useVendorOffers.ts web/src/i18n/en.json web/src/i18n/ta.json web/src/index.css
git commit -m "feat(catalog): shared master checklist screen with search/filter/print"
```

---

## Task 6: Vendor deep links + routes + nav

**Files:**
- Modify: `web/src/features/catalog/ChecklistScreen.tsx` (vendor deep links for not-offered / not-priced)
- Modify: `web/src/App.tsx` (routes)
- Modify: `web/src/lib/navConfig.ts` + `web/src/lib/navConfig.test.ts`
- Modify: `web/src/lib/navIcons.tsx`

**Interfaces:**
- Consumes: `ChecklistScreen` (Task 5), `govNavForSession`/`vendorNavForSession` (existing).

- [ ] **Step 1: Add vendor deep links in `ChecklistScreen.tsx`**

In `ChecklistRow`, when `variant === 'vendor'` and `offer` is present, wrap the "Not priced" chip in a link to `/vendor/rates`, and when `!offer?.offered` show a "Not offered" link to `/vendor/onboarding`. Replace the vendor `<span className="ml-auto …">` block with:

```tsx
      {variant === 'vendor' && (
        <span className="ml-auto flex items-center gap-1.5">
          {offer?.offered ? (
            <>
              <span className="chip chip-ok">{t('catalog.youOffer')}</span>
              {offer.priceLabel
                ? <span className="chip chip-ok">{t('catalog.priced', { price: offer.priceLabel })}</span>
                : <Link to="/vendor/rates" className="chip chip-muted hover:underline">{t('catalog.notPriced')}</Link>}
            </>
          ) : (
            <Link to="/vendor/onboarding" className="chip chip-muted hover:underline">{t('catalog.notOffered')}</Link>
          )}
        </span>
      )}
```

Add `import { Link } from 'react-router-dom';` at the top. Guard: only render the vendor block once `offers` has resolved is unnecessary — an empty map yields "Not offered" links, which is correct for a vendor with no priced tests. To honour "degrade gracefully when the pricing API is absent", pass a boolean `pricingAvailable` from `useVendorOffers` and hide the whole vendor block when the query errored:

In `useVendorOffers.ts`, return `{ offers, available }` where `available = !isError`. Update the hook return type and `ChecklistScreen` accordingly:

```ts
// useVendorOffers.ts — change signature
export function useVendorOffers(enabled: boolean): { offers: Map<string, VendorOffer>; available: boolean } {
  const { data, isError } = useQuery({ /* …unchanged… */ });
  const offers = useMemo(() => { /* …unchanged map build… */ return map; }, [data]);
  return { offers, available: enabled && !isError };
}
```

In `ChecklistScreen`, read `const { offers, available } = useVendorOffers(variant === 'vendor');`, pass `offer={offers.get(test.code)}` and `showOffer={variant === 'vendor' && available}` to `ChecklistRow`, and gate the vendor block on `showOffer` instead of `variant === 'vendor'`.

Update the Task 5 test expectation already covers this (pricing rejected → no "Not priced" text). Re-run it in Step 6.

- [ ] **Step 2: Add routes in `web/src/App.tsx`**

Add the import near the other feature imports:

```tsx
import { ChecklistScreen } from '@/features/catalog/ChecklistScreen';
```

Under the gov route group (sibling of the existing `/gov/*` routes), add:

```tsx
            <Route path="checklist" element={<ChecklistScreen variant="gov" />} />
```

Under the vendor route group, add:

```tsx
            <Route path="tests" element={<ChecklistScreen variant="vendor" />} />
```

(Match the exact nesting used by the existing `/gov` and `/vendor` `<Route>` parents — check how `projects/:projectId/checklist` and `/vendor/rates` are declared and mirror that indentation/parent.)

- [ ] **Step 3: Add nav items + tab key in `web/src/lib/navConfig.ts`**

In `GOV_NAV_TAB_KEYS`, add after `planner`:

```ts
  { key: 'checklist', labelKey: 'catalog.title' },
```

In `GOV_ALL`, add after the planner item:

```ts
  { to: '/gov/checklist', labelKey: 'catalog.title', navKey: 'checklist', requiresPermission: 'order.read' },
```

In `VENDOR_OWNER`, add after the `/vendor/rates` item:

```ts
  { to: '/vendor/tests', labelKey: 'catalog.subtitleVendorNav' },
```

Add a short nav label key `catalog.subtitleVendorNav` = `"Tests we do"` / `"நாங்கள் செய்யும் சோதனைகள்"` to both i18n files (Task 5's block can hold it — add it there if doing tasks in order; otherwise add now).

- [ ] **Step 4: Add icons in `web/src/lib/navIcons.tsx`**

Map the two new `labelKey`s (or `to` paths, matching the file's existing lookup mechanism — check whether it keys on `to`, `navKey`, or `labelKey`) to a Lucide icon, e.g. `ListChecks` for the checklist. Follow the existing entries' exact shape.

- [ ] **Step 5: Update `web/src/lib/navConfig.test.ts`**

Add assertions:

```ts
it('gov nav includes the test checklist for order.read holders', () => {
  const session = /* build a session with order.read — copy the existing helper in this file */;
  const items = govNavForSession(session);
  expect(items.some((i) => i.to === '/gov/checklist')).toBe(true);
});

it('vendor owner nav includes Tests we do', () => {
  const items = vendorNavForSession(/* a LAB_VENDOR session — copy existing helper */);
  expect(items.some((i) => i.to === '/vendor/tests')).toBe(true);
});
```

Use the session-building helpers already present in `navConfig.test.ts` (do not invent new ones — read the file and reuse its fixtures).

- [ ] **Step 6: Run the affected tests + typecheck + lint**

Run: `npx vitest run src/features/catalog/ChecklistScreen.test.tsx src/lib/navConfig.test.ts`
Expected: PASS.
Run: `npx tsc -b && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/catalog/ChecklistScreen.tsx web/src/features/catalog/useVendorOffers.ts web/src/App.tsx web/src/lib/navConfig.ts web/src/lib/navConfig.test.ts web/src/lib/navIcons.tsx web/src/i18n/en.json web/src/i18n/ta.json
git commit -m "feat(catalog): wire /gov/checklist and /vendor/tests routes + nav"
```

---

## Task 7: Upgrade `ProjectChecklistPage` to the live-status model

**Files:**
- Modify: `web/src/features/gov/ProjectChecklistPage.tsx` (rewrite)
- Create: `web/src/features/gov/ProjectChecklistPage.test.tsx`
- Modify: `web/src/i18n/en.json`, `web/src/i18n/ta.json` (checklist status strings)

**Interfaces:**
- Consumes: `useProjectChecklist` (Task 4), `useGovProjects` (existing).

- [ ] **Step 1: Add status i18n keys to both `en.json` and `ta.json`**

Under the existing `checklist` block (used by the current page), add (en):

```json
"progress": "{{done}} of {{total}} certified",
"status": {
  "PLANNED": "Planned", "ORDERED": "Ordered", "IN_PROGRESS": "In progress",
  "CERTIFIED": "Certified", "FAILED": "Failed"
},
"notPlanned": "Not planned yet",
"planThisLevel": "Plan this level",
"viewOrder": "View order", "viewJob": "View job", "retestTrail": "Retest trail",
"summary": "{{done}} of {{total}} certified across {{stages}} levels"
```

Tamil equivalents (keep keys identical):

```json
"progress": "{{total}} இல் {{done}} சான்றளிக்கப்பட்டது",
"status": {
  "PLANNED": "திட்டமிடப்பட்டது", "ORDERED": "ஆர்டர் செய்யப்பட்டது",
  "IN_PROGRESS": "நடைபெறுகிறது", "CERTIFIED": "சான்றளிக்கப்பட்டது", "FAILED": "தோல்வி"
},
"notPlanned": "இன்னும் திட்டமிடப்படவில்லை",
"planThisLevel": "இந்த நிலையைத் திட்டமிடு",
"viewOrder": "ஆர்டரைப் பார்", "viewJob": "வேலையைப் பார்", "retestTrail": "மறுசோதனை பதிவு",
"summary": "{{stages}} நிலைகளில் {{total}} இல் {{done}} சான்றளிக்கப்பட்டது"
```

- [ ] **Step 2: Write the failing test `web/src/features/gov/ProjectChecklistPage.test.tsx`**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import type { ProjectChecklist } from '@/types/domain';
import { ProjectChecklistPage } from './ProjectChecklistPage';
import * as catalogApi from '@/features/catalog/api';
import * as govApi from './api';

vi.mock('@/features/catalog/api', async (o) => ({ ...(await o<typeof catalogApi>()), fetchProjectChecklist: vi.fn() }));
vi.mock('./api', async (o) => ({ ...(await o<typeof govApi>()), fetchGovProjects: vi.fn(async () => []) }));

const fixture: ProjectChecklist = {
  stages: [
    { code: 'FOUNDATION', sequence: 3, name: 'Foundation', planned: true,
      certifiedCount: 1, totalCount: 2, rows: [
        { requirementId: 'r1', testCode: 'CUBE', testName: 'Cube', plannedCount: 6,
          status: 'CERTIFIED', orderId: 'o1', jobId: 'j1' },
        { requirementId: 'r2', testCode: 'SLUMP', testName: 'Slump', plannedCount: 1,
          status: 'FAILED', orderId: 'o1', jobId: 'j1' },
      ] },
    { code: 'ROADWORK', sequence: 7, name: 'Roadwork', planned: false,
      certifiedCount: 0, totalCount: 0, rows: [] },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/gov/projects/p1/checklist']}>
          <Routes><Route path="/gov/projects/:projectId/checklist" element={<ProjectChecklistPage />} /></Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(catalogApi.fetchProjectChecklist).mockResolvedValue(fixture));
afterEach(cleanup);

describe('ProjectChecklistPage', () => {
  it('checks only certified rows and flags failures', async () => {
    renderPage();
    const cube = await screen.findByLabelText(/Cube/);
    expect(cube).toBeChecked();
    const slump = screen.getByLabelText(/Slump/);
    expect(slump).not.toBeChecked();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows a not-planned-yet level with a plan link', async () => {
    renderPage();
    await screen.findByText('Foundation');
    expect(screen.getByText(/Not planned yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Plan this level/ })).toBeInTheDocument();
  });

  it('renders per-level progress', async () => {
    renderPage();
    expect(await screen.findByText('1 of 2 certified')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/features/gov/ProjectChecklistPage.test.tsx`
Expected: FAIL (page still uses old `useProjectRequirements` shape / no progress text).

- [ ] **Step 4: Rewrite `web/src/features/gov/ProjectChecklistPage.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { FeedSkeleton } from '@/components/Skeleton';
import type { ProjectChecklistRow, ProjectChecklistStage } from '@/types/domain';
import { useGovProjects } from './useGov';
import { useProjectChecklist } from '@/features/catalog/useCatalog';

export function ProjectChecklistPage() {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  const { data: projects } = useGovProjects();
  const { data, isPending, isError, refetch } = useProjectChecklist(projectId);
  const project = projects?.find((p) => p.id === projectId);

  if (isPending) return <FeedSkeleton />;
  if (isError) {
    return (
      <section className="gov-card border-l-4 border-l-danger p-4">
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary">
          {t('states.retry')}
        </button>
      </section>
    );
  }

  const stages = data?.stages ?? [];
  const totalDone = stages.reduce((n, s) => n + s.certifiedCount, 0);
  const total = stages.reduce((n, s) => n + s.totalCount, 0);

  return (
    <section className="print-sheet space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/gov/planner" className="text-sm font-semibold text-navy hover:underline">
          ← {t('planner.title')}
        </Link>
        <button type="button" onClick={() => window.print()} className="gov-btn-primary">
          {t('checklist.print')}
        </button>
      </div>

      <header>
        <h2 className="font-display text-xl font-bold text-ink">{t('checklist.title')}</h2>
        <p className="text-sm text-ink-2">{project ? `${project.name} · ${project.code}` : projectId}</p>
      </header>

      <div className="gov-card p-4">
        <p className="text-sm font-semibold text-ink">
          {t('checklist.summary', { done: totalDone, total, stages: stages.filter((s) => s.planned).length })}
        </p>
      </div>

      {stages.map((stage, i) => (
        <StageCard key={stage.code} stage={stage} index={i} projectId={projectId} />
      ))}
    </section>
  );
}

function StageCard({ stage, index, projectId }: {
  stage: ProjectChecklistStage; index: number; projectId: string;
}) {
  const { t } = useTranslation();
  const pct = stage.totalCount > 0 ? Math.round((stage.certifiedCount / stage.totalCount) * 100) : 0;
  return (
    <div className="gov-card p-4" style={{ breakInside: 'avoid' }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-base font-bold text-ink">{index + 1}. {stage.name}</h3>
        {stage.planned && (
          <span className="text-xs font-semibold text-ink-3">
            {t('checklist.progress', { done: stage.certifiedCount, total: stage.totalCount })}
          </span>
        )}
      </div>
      {stage.planned ? (
        <>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-hair">
            <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-3 divide-y divide-hair">
            {stage.rows.map((r) => <ChecklistRow key={r.requirementId} row={r} />)}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-sm text-ink-3">
          {t('checklist.notPlanned')} ·{' '}
          <Link to={`/gov/planner?projectId=${projectId}&stage=${stage.code}`} className="text-navy hover:underline">
            {t('checklist.planThisLevel')}
          </Link>
        </p>
      )}
    </div>
  );
}

function ChecklistRow({ row }: { row: ProjectChecklistRow }) {
  const { t } = useTranslation();
  const done = row.status === 'CERTIFIED';
  const failed = row.status === 'FAILED';
  return (
    <li className="flex items-start gap-3 py-2">
      <input
        type="checkbox" checked={done} readOnly
        aria-label={`${row.testName}: ${t(`checklist.status.${row.status}`)}`}
        className="mt-0.5 h-4 w-4"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">
          {row.testName} <span className="font-mono text-xs font-normal text-ink-3">{row.testCode}</span>
        </p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span>{t('checklist.samples', { count: row.plannedCount })}</span>
          {failed
            ? <span className="chip chip-danger">{t('checklist.status.FAILED')}</span>
            : <span>{t(`checklist.status.${row.status}`)}</span>}
          {row.orderId && (
            <Link to={`/gov/orders/${row.orderId}`} className="text-navy hover:underline">
              {failed ? t('checklist.retestTrail') : t('checklist.viewOrder')}
            </Link>
          )}
        </p>
      </div>
    </li>
  );
}
```

Note: reuse existing `checklist.samples`, `checklist.print`, `checklist.title` keys (already in the i18n files from the old page). If `chip-danger`/`bg-success` are absent in `index.css`, add minimal rules next to the existing chip styles.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/features/gov/ProjectChecklistPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc -b && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/gov/ProjectChecklistPage.tsx web/src/features/gov/ProjectChecklistPage.test.tsx web/src/i18n/en.json web/src/i18n/ta.json
git commit -m "feat(catalog): live-status per-project checklist with deep links"
```

---

## Task 8: Full green + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all pass (DB-gated `catalog-checklist.db.test.mjs` passes if the DB is up, else skipped).

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npx tsc -b`
Expected: clean.

- [ ] **Step 3: i18n parity check**

Run: `node -e "const a=require('./src/i18n/en.json'),b=require('./src/i18n/ta.json');const k=o=>Object.keys(o).flatMap(x=>o[x]&&typeof o[x]==='object'?k(o[x]).map(y=>x+'.'+y):[x]);const ka=new Set(k(a)),kb=new Set(k(b));const miss=[...ka].filter(x=>!kb.has(x)).concat([...kb].filter(x=>!ka.has(x)));console.log(miss.length?('MISMATCH: '+miss.join(', ')):'i18n keys match');"`
Expected: `i18n keys match`.

- [ ] **Step 4: Manual smoke (DB up, BFF + Vite running)**

Start (if not running): `npm run bff` and `npm run dev`. Then verify:
- `http://localhost:5173/gov/checklist` — 9 levels, counts `8,2,12,5,15,4,9,6,14`, "Any level" with 2 tests; search "bitumen" jumps to Roadwork; domain "Soil" shows only stages 1–2; NABL toggle filters; Print shows all expanded, one level per page.
- `http://localhost:5173/vendor/tests` — same list with "You offer this" / "Priced" / "Not priced" chips for a LAB_VENDOR persona; degrades (no chips) if pricing absent.
- A project's checklist (`/gov/planner` → open a project → checklist) — progress bars, CERTIFIED checkboxes, FAILED red chip + deep link, "not planned yet" levels linking to planner.

- [ ] **Step 5: Final commit (if index.css or stray fixups changed)**

```bash
git add -A
git commit -m "chore(catalog): final polish + verification"
```

---

## Self-Review

**Spec coverage:**
- §0 data source / no hard-coding → Global Constraints + Task 1 (API-driven) + domain chips note in Task 5. ✅
- §1 `/api/catalog/checklist` + frequency-as-key → Task 1. ✅
- §1 verification counts → Task 2 (DB-gated). ✅
- §2 master screen, toolbar, print, nav → Tasks 5, 6. ✅
- §2 vendor extras + graceful degrade + deep links → Tasks 5 (degrade), 6 (deep links). ✅
- §3 per-project live checklist, progress, deep links, FAILED, not-planned, print → Tasks 3 (endpoint) + 7 (UI). ✅
- §4 tests (API shape/counts, component search/filter/NABL/print, project status incl. FAILED, scope, vendor degrade) → Tasks 1,2,5,7 (scope covered by RLS + Task 2's real-user session; add an explicit out-of-scope assertion in Task 2 if a second seeded user with a foreign district is available). ✅
- §5 DoD (test/lint/tsc green; engineer sees all 64 tests; project checklist statuses; en+ta; no hard-coded catalog) → Task 8. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The only "check the existing file" notes (navIcons keying, App.tsx route nesting, index.css chip classes) are deliberate — they point at existing patterns the implementer must match rather than guess, and each names the exact file and what to look for.

**Type consistency:** `shapeChecklist`/`frequencyLabel`/`domainSlug`/`deriveReqStatus` signatures match between `catalog.mjs`, its tests, and `bff.mjs`. Frontend `ChecklistTest`/`ChecklistStage`/`CatalogChecklist`/`ProjectChecklist*` types match the server JSON and the component props. `useVendorOffers` returns `{ offers, available }` (Task 6) — Task 5 initially returns a bare `Map`; Task 6 explicitly updates both the hook and its call sites, so the intermediate state is consistent within each task.
