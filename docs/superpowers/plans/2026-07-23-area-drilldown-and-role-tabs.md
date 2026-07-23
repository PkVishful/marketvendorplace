# Area Drill-Down & Role-Differentiated Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing `org_units` hierarchy as one "Area" drill-down where each gov role lands at its own level and can only drill within its subtree, and make gov nav tabs actually differ by role.

**Architecture:** One route `/gov/area/:orgUnitId?` renders a single `AreaPage` that adapts to the level of the node it is showing. The BFF gains `GET /api/gov/area/:orgUnitId?`, which reuses the *existing* health-bucket and KPI SQL already backing `/api/gov/dashboard/map` — that SQL is extracted into a shared module first, so the two endpoints cannot drift. Nav differentiation is data: defaults seeded into the existing `eworks.settings.nav_visibility` key.

**Tech Stack:** Node + Express BFF (`web/server/*.mjs`), Postgres with `ltree` org paths and RLS, React 19 + react-router 7 + TanStack Query, vitest, i18next (en + ta).

## Global Constraints

- **No new migrations for the hierarchy.** The org tree already exists. The only migration in this plan seeds `nav_visibility` defaults (spec §3 explicitly asks for this).
- **KPI definitions must not fork.** The Area endpoint and the map endpoint share one SQL module and one scoring function (`scoreFromHealthCounts`). Spec §4.
- **RLS is the security boundary.** Every query runs inside `withUserSession`; `eworks.in_scope()` gates node access. Hidden ≠ blocked, blocked ≠ hidden.
- **i18n:** every user-visible string gets a key in **both** `web/src/i18n/en.json` and `web/src/i18n/ta.json`.
- **a11y:** breadcrumbs in a `<nav aria-label>`; cards are real links/buttons; loading states use `role="status"`.
- **Mobile-first** card layouts.
- Green bar before every commit: `npx vitest run`, `npx oxlint`, `npx tsc -b`.

## Ground Truth (verified against the live database 2026-07-23)

These facts were confirmed by querying the running instance. They differ from the
spec's assumptions in two places — read this before writing code.

**The tree is 8 levels, not 4.** `eworks.org_level` is
`STATE, DISTRICT, DIVISION, CIRCLE, SUBDIVISION, SECTION, FIELD_UNIT, PROJECT`,
and a trigger in `20260709000200_org_units.sql:88` enforces that a child's level
ordinal is exactly the parent's + 1 — **levels cannot be skipped**. Seeded counts:
1 state, 38 of each other level. A real seeded path:

```
TN.COIMBATORE.CBEDIV1.CBEC1.CBESD1.CBESEC1.CBEFU1.CBEPRJ1
```

**Sites/projects are `org_units` rows with `level='PROJECT'`.** There is no
separate projects table. `project_test_requirements.project_id` references
`org_units(id)`.

**Decision (confirmed with the user): collapse single-child chains.** When a node
has exactly one child and is not itself a `PROJECT`, the Area view forwards to
that child. Breadcrumbs still show the true, uncollapsed path. This is what makes
the four-tap demo in spec §5 achievable: `TN → Coimbatore` renders Subdivision 1's
children (Section 1, Section 2) because Division 1 → Circle 1 → Subdivision 1 is a
single-child chain.

**Decision (confirmed with the user): tabs the spec matrix omits keep their
current visibility.** The matrix in spec §3 does not mention `ratings`, which is
live today for six roles. It is preserved rather than dropped.

**`vendors.org_unit_id`** is the vendor's registering district, so
`summary.pendingApprovals` is genuinely subtree-scopeable.

## File Structure

| File | Responsibility |
|---|---|
| `web/server/area-queries.mjs` *(new)* | Shared subtree SQL: health buckets, KPI counts, pending approvals. Consumed by both the map and area endpoints. |
| `web/server/area.mjs` *(new)* | Pure logic: chain collapse, breadcrumb assembly, summary shaping. No SQL. |
| `web/server/area.test.mjs` *(new)* | Unit tests for `area.mjs` (node env, no DB). |
| `web/server/area.db.test.mjs` *(new)* | Scope/RLS tests against a seeded DB. |
| `web/server/bff.mjs` *(modify)* | Register `GET /api/gov/area/:orgUnitId?`; refactor the map route onto `area-queries.mjs`. |
| `web/src/features/gov/area/api.ts` *(new)* | `fetchArea`, `areaKeys`, DTO types. |
| `web/src/features/gov/area/useArea.ts` *(new)* | `useArea(orgUnitId)` query hook. |
| `web/src/features/gov/area/landing.ts` *(new)* | Pure `resolveLandingPath(session)`. |
| `web/src/features/gov/area/landing.test.ts` *(new)* | Tests for landing resolution. |
| `web/src/features/gov/area/AreaPage.tsx` *(new)* | Level-adaptive container. |
| `web/src/features/gov/area/AreaBreadcrumbs.tsx` *(new)* | Crumb trail; out-of-scope crumbs render as plain text. |
| `web/src/features/gov/area/AreaChildCard.tsx` *(new)* | One child node card + KPI row. |
| `web/src/features/gov/area/AreaProjectList.tsx` *(new)* | Project rows with stage progress. |
| `web/src/features/gov/area/OutsideAreaScreen.tsx` *(new)* | Friendly 403 screen. |
| `web/src/lib/navConfig.ts` *(modify)* | Add the `area` tab key and nav entry. |
| `web/src/App.tsx` *(modify)* | `/gov/area/:orgUnitId?` route; `/gov` index → Area. |
| `supabase/migrations/20260723000200_area_nav_defaults.sql` *(new)* | Seed per-role nav defaults including `area`. |
| `web/src/i18n/{en,ta}.json` *(modify)* | `area.*` keys. |

---

### Task 1: Extract shared subtree SQL so map and area cannot drift

The map endpoint at `bff.mjs:1793` embeds the health-bucket and KPI queries
inline. Area needs the identical aggregation anchored at an arbitrary node. Move
it out first, with the map endpoint as the proof it still works.

**Files:**
- Create: `web/server/area-queries.mjs`
- Modify: `web/server/bff.mjs:1793-1897` (the `/api/gov/dashboard/map` handler)
- Test: `web/server/dashboard-map.db.test.mjs` (existing — must stay green)

**Interfaces:**
- Consumes: `assembleRegions`, `scoreFromHealthCounts` from `./bff.mjs` (already exported at `bff.mjs:198` and `bff.mjs:186`).
- Produces:
  - `loadChildRegions(client, anchorPath) -> Promise<Region[]>` where `Region = { id, name, score: number|null, kpis: {openOrders, activeJobs, failedTests30d, certificates30d, vendorsActive} }`
  - `loadSubtreeSummary(client, anchorPath) -> Promise<{ openOrders, activeJobs, failedTests30d, certificates30d, pendingApprovals, qualityScore: number|null }>`

- [ ] **Step 1: Move the two queries into the new module, unchanged**

Create `web/server/area-queries.mjs`. Copy the `childrenQ`, `ordersQ`, and `kpiQ`
SQL verbatim out of the map handler — do not retune it in this task; a behaviour
change here would be invisible until the map regressed.

```js
// Shared subtree aggregation. Both GET /api/gov/dashboard/map and
// GET /api/gov/area/:id read region health from here so their KPI definitions
// cannot drift apart (build spec §4).
import { assembleRegions, scoreFromHealthCounts, computeMilestoneHealth } from './bff.mjs';

export async function loadChildRegions(client, anchorPath) {
  const childrenQ = await client.query(
    `select id, name, level, path::text as path
       from eworks.org_units
      where path <@ $1::ltree and nlevel(path) = nlevel($1::ltree) + 1
      order by name`,
    [anchorPath]);
  const children = childrenQ.rows;
  // ...ordersQ and kpiQ copied verbatim from bff.mjs, both keyed on `child.id`
  return assembleRegions(children, bucketsById, kpisById);
}
```

- [ ] **Step 2: Point the map handler at it and run the existing DB test**

Replace the inline query block in the map handler with
`const regions = await loadChildRegions(client, anchor.path);`

Run: `npx vitest run server/dashboard-map.db.test.mjs`
Expected: PASS — same assertions, same numbers. This is the regression gate for
the extraction.

- [ ] **Step 3: Verify the live endpoint is byte-identical**

Run the app and diff the payload against a capture taken before the refactor:

```bash
curl -s http://localhost:5173/api/gov/dashboard/map -b ck.txt > after.json
diff before.json after.json
```
Expected: no differences.

- [ ] **Step 4: Add `loadSubtreeSummary` with a failing test first**

Write `server/area.db.test.mjs` asserting that for the Coimbatore district node,
`loadSubtreeSummary` returns `pendingApprovals` equal to the count of
`eworks.vendors` rows with `status='SUBMITTED'` whose `org_unit_id` is inside the
subtree. Run it, watch it fail with "loadSubtreeSummary is not a function", then
implement:

```sql
select count(*)::int as "pendingApprovals"
  from eworks.vendors v
  join eworks.org_units ou on ou.id = v.org_unit_id
 where ou.path <@ $1::ltree and v.status = 'SUBMITTED'
```

`qualityScore` reuses `scoreFromHealthCounts` over the whole-subtree bucket — do
not write a second formula.

- [ ] **Step 5: Commit**

```bash
git add web/server/area-queries.mjs web/server/bff.mjs web/server/area.db.test.mjs
git commit -m "refactor(area): extract shared subtree KPI SQL from map endpoint"
```

---

### Task 2: Chain collapse (the core algorithm)

**Files:**
- Create: `web/server/area.mjs`, `web/server/area.test.mjs`

**Interfaces:**
- Produces: `pickEffectiveNode(chainRows) -> { node, skipped: Node[] }` where `chainRows` is ordered by `hops` ascending and `Node = { id, parentId, level, name, path }`.

- [ ] **Step 1: Write the failing tests**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { pickEffectiveNode } from './area.mjs';

const n = (id, level, hops) => ({ id, level, name: id, path: id, hops });

describe('pickEffectiveNode', () => {
  it('returns the node itself when it has more than one child', () => {
    const { node, skipped } = pickEffectiveNode([n('sd1', 'SUBDIVISION', 0)]);
    expect(node.id).toBe('sd1');
    expect(skipped).toEqual([]);
  });

  it('forwards through a single-child chain to the first branching node', () => {
    const chain = [
      n('coimbatore', 'DISTRICT', 0),
      n('div1', 'DIVISION', 1),
      n('circle1', 'CIRCLE', 2),
      n('sd1', 'SUBDIVISION', 3),
    ];
    const { node, skipped } = pickEffectiveNode(chain);
    expect(node.id).toBe('sd1');
    expect(skipped.map((s) => s.id)).toEqual(['coimbatore', 'div1', 'circle1']);
  });

  it('forwards all the way to a project when the chain bottoms out', () => {
    const chain = [n('sec1', 'SECTION', 0), n('fu1', 'FIELD_UNIT', 1), n('prj1', 'PROJECT', 2)];
    expect(pickEffectiveNode(chain).node.id).toBe('prj1');
  });

  it('never forwards past a PROJECT', () => {
    const { node } = pickEffectiveNode([n('prj1', 'PROJECT', 0)]);
    expect(node.level).toBe('PROJECT');
  });

  it('returns the single node unchanged for a childless leaf', () => {
    const { node, skipped } = pickEffectiveNode([n('fu9', 'FIELD_UNIT', 0)]);
    expect(node.id).toBe('fu9');
    expect(skipped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run server/area.test.mjs`
Expected: FAIL — "Failed to resolve import ./area.mjs".

- [ ] **Step 3: Implement**

```js
// The org tree is 8 strict levels but most districts are a single-child chain
// down to the sections. Presenting one screen per level would make a site seven
// taps deep, so a node with exactly one child forwards to that child. The
// skipped nodes are still returned — breadcrumbs show the true path.
export function pickEffectiveNode(chainRows) {
  const chain = [...chainRows].sort((a, b) => a.hops - b.hops);
  const node = chain[chain.length - 1];
  return { node, skipped: chain.slice(0, -1) };
}
```

The descent itself is the SQL's job (Task 4) — this function only interprets the
chain it produced. Keeping it pure is what makes the five cases above cheap to test.

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run server/area.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/server/area.mjs web/server/area.test.mjs
git commit -m "feat(area): pure single-child chain collapse"
```

---

### Task 3: Breadcrumbs with scope flags

**Files:**
- Modify: `web/server/area.mjs`, `web/server/area.test.mjs`

**Interfaces:**
- Produces: `buildBreadcrumbs(ancestorRows, callerAnchorPath) -> Array<{ id, name, level, inScope: boolean }>`, ordered root-first.

- [ ] **Step 1: Write the failing tests**

```js
describe('buildBreadcrumbs', () => {
  const rows = [
    { id: 'tn', name: 'Tamil Nadu', level: 'STATE', path: 'TN' },
    { id: 'mdu', name: 'Madurai', level: 'DISTRICT', path: 'TN.MADURAI' },
    { id: 'melur', name: 'Melur', level: 'DIVISION', path: 'TN.MADURAI.MELUR' },
  ];

  it('flags crumbs at or below the caller anchor as in scope', () => {
    const crumbs = buildBreadcrumbs(rows, 'TN.MADURAI');
    expect(crumbs.map((c) => [c.name, c.inScope])).toEqual([
      ['Tamil Nadu', false], ['Madurai', true], ['Melur', true],
    ]);
  });

  it('marks every crumb in scope for a state-anchored caller', () => {
    expect(buildBreadcrumbs(rows, 'TN').every((c) => c.inScope)).toBe(true);
  });

  it('keeps root-first ordering regardless of input order', () => {
    const crumbs = buildBreadcrumbs([...rows].reverse(), 'TN');
    expect(crumbs[0].name).toBe('Tamil Nadu');
  });
});
```

- [ ] **Step 2: Run, watch fail** — `npx vitest run server/area.test.mjs`, expect "buildBreadcrumbs is not a function".

- [ ] **Step 3: Implement**

```js
// A crumb above the caller's own anchor is context, not a destination: it
// renders as plain text so nobody is invited to drill up out of their subtree.
export function buildBreadcrumbs(ancestorRows, callerAnchorPath) {
  return [...ancestorRows]
    .sort((a, b) => a.path.split('.').length - b.path.split('.').length)
    .map((row) => ({
      id: row.id,
      name: row.name,
      level: row.level,
      inScope: row.path === callerAnchorPath || row.path.startsWith(`${callerAnchorPath}.`),
    }));
}
```

- [ ] **Step 4: Run, watch pass.** - [ ] **Step 5: Commit** `git commit -m "feat(area): breadcrumbs with scope flags"`

---

### Task 4: `GET /api/gov/area/:orgUnitId?`

**Files:**
- Modify: `web/server/bff.mjs` (register beside the map route, ~line 1793), `web/server/area-queries.mjs`
- Test: `web/server/area.db.test.mjs`

**Interfaces:**
- Consumes: `pickEffectiveNode`, `buildBreadcrumbs` (Tasks 2–3); `loadChildRegions`, `loadSubtreeSummary` (Task 1).
- Produces: the DTO in spec §4 — `{ node, breadcrumbs, summary, children, projects }`.

- [ ] **Step 1: Write the failing scope tests**

```js
it('403s when a district officer requests another district', async () => {
  const res = await areaFor(MADURAI_OFFICER, COIMBATORE_NODE_ID);
  expect(res.status).toBe(403);
});

it('403s when a district officer requests the state node', async () => {
  const res = await areaFor(MADURAI_OFFICER, STATE_NODE_ID);
  expect(res.status).toBe(403);
});

it('defaults to the caller own anchor when no id is given', async () => {
  const { body } = await areaFor(MADURAI_OFFICER, undefined);
  expect(body.node.name).toBe('Madurai');
});

it('collapses the single-child chain under a district', async () => {
  const { body } = await areaFor(HEAD_ADMIN, COIMBATORE_NODE_ID);
  expect(body.node.level).toBe('SUBDIVISION');
  expect(body.children.map((c) => c.name).sort())
    .toEqual(['Coimbatore Section 1', 'Coimbatore Section 2']);
});
```

- [ ] **Step 2: Run, watch fail** — `npx vitest run server/area.db.test.mjs`, expect 404 from an unregistered route.

- [ ] **Step 3: Implement the handler**

Resolve the anchor exactly as the map route does (`bff.mjs:1799-1807`), then:

```sql
-- Descend while the current node has exactly one child. Bounded by hops < 8,
-- the depth of eworks.org_level, so a cycle cannot spin.
with recursive chain as (
  select ou.id, ou.parent_id, ou.level, ou.name, ou.path::text as path, 0 as hops
    from eworks.org_units ou
   where ou.id = $1 and eworks.in_scope(ou.path)
  union all
  select c.id, c.parent_id, c.level, c.name, c.path::text, chain.hops + 1
    from chain
    join eworks.org_units c on c.parent_id = chain.id
   where chain.level <> 'PROJECT'
     and chain.hops < 8
     and (select count(*) from eworks.org_units s where s.parent_id = chain.id) = 1
)
select * from chain order by hops
```

An empty result means the node is missing **or** out of scope — respond `403`
with `{ error: 'outside_your_area' }` and do not distinguish the two, so the
endpoint cannot be used to probe for node existence.

Ancestors for breadcrumbs:
`select id, name, level, path::text from eworks.org_units where path @> $1::ltree`.

`children` = `loadChildRegions(client, effective.path)`. When the effective node's
children are `PROJECT` level, return them as `projects` instead (spec §4:
"`children` for a taluka node = its projects").

- [ ] **Step 4: Run, watch pass.**

- [ ] **Step 5: Commit** `git commit -m "feat(area): GET /api/gov/area/:orgUnitId with scope gate"`

---

### Task 5: Project-level payload (stage progress)

**Files:** Modify `web/server/area-queries.mjs`, `web/server/area.db.test.mjs`

**Interfaces:** Produces `loadProjectDetail(client, projectId) -> { stages: Array<{ stageName, required, certified }>, orders, nextMilestone }`.

- [ ] **Step 1: Failing test** — assert the seeded Coimbatore Flyover returns a
  stage row whose `required` equals its `project_test_requirements` count and
  whose `certified` counts only verified certificates.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement** — join `project_test_requirements` → `construction_stage`,
  left join certificates through `test_jobs`, group by stage. This is what renders
  "Superstructure — 4/15 tests certified".
- [ ] **Step 4: Run, watch pass.** - [ ] **Step 5: Commit.**

---

### Task 6: Landing resolution

**Files:** Create `web/src/features/gov/area/landing.ts` + `landing.test.ts`

**Interfaces:** Produces `resolveLandingPath(session: Session) -> string`.

- [ ] **Step 1: Write the failing tests**

```ts
it('sends a state-anchored user to the area root', () => {
  expect(resolveLandingPath(sessionWith({ orgLevel: 'STATE', orgUnitId: 'tn' })))
    .toBe('/gov/area');
});

it('sends a district officer to their own district node', () => {
  expect(resolveLandingPath(sessionWith({ orgLevel: 'DISTRICT', orgUnitId: 'mdu' })))
    .toBe('/gov/area/mdu');
});

it('sends a mid-tree engineer to their own node', () => {
  expect(resolveLandingPath(sessionWith({ orgLevel: 'SECTION', orgUnitId: 'sec1' })))
    .toBe('/gov/area/sec1');
});

it('uses the most senior anchor when a user holds several roles', () => {
  expect(resolveLandingPath(multiAnchorSession)).toBe('/gov/area/mdu');
});
```

Rank anchors with the canonical `ORG_LEVELS` ordering already used by the nav
work (commit `b75ca1f`) — do not re-derive an ordinal.

Note: the spec's "engineer with exactly one active project → straight to that
site" is **not** implemented here, because `/api/me` does not currently expose a
project list. Chain collapse already delivers the same outcome whenever the
engineer's anchor has a single-child path to one project. Flag this in the PR.

- [ ] **Step 2–5:** run/fail, implement, run/pass, commit.

---

### Task 7: Frontend data layer

**Files:** Create `web/src/features/gov/area/api.ts`, `useArea.ts`

**Interfaces:** Produces `fetchArea(orgUnitId?: string)`, `areaKeys.detail(id)`, `useArea(orgUnitId?)`.

- [ ] **Step 1: Implement following the existing `features/gov/api.ts` pattern**

```ts
export const areaKeys = {
  detail: (id?: string) => ['gov', 'area', id ?? 'self'] as const,
};

export function fetchArea(orgUnitId?: string) {
  return apiClient.get<AreaDTO>(`/api/gov/area${orgUnitId ? `/${orgUnitId}` : ''}`);
}
```

- [ ] **Step 2: Hook**

```ts
export function useArea(orgUnitId?: string) {
  return useQuery({ queryKey: areaKeys.detail(orgUnitId), queryFn: () => fetchArea(orgUnitId) });
}
```

- [ ] **Step 3: `npx tsc -b`** — expect exit 0. - [ ] **Step 4: Commit.**

---

### Task 8: AreaPage and its components

**Files:** Create `AreaPage.tsx`, `AreaBreadcrumbs.tsx`, `AreaChildCard.tsx`, `AreaProjectList.tsx`, `OutsideAreaScreen.tsx`; modify `web/src/i18n/{en,ta}.json`

- [ ] **Step 1: Breadcrumbs first (smallest testable unit)**

Out-of-scope crumbs render as `<span>`, in-scope as `<Link to={/gov/area/${id}}>`.
Wrap in `<nav aria-label={t('area.breadcrumbLabel')}>`.

- [ ] **Step 2: Child cards** — name, then the five KPIs from `children[].kpis`,
  reusing the `No data` treatment from `DistrictMap.tsx` for `score === null` so a
  missing score never renders as a rating.
- [ ] **Step 3: Project list** — stage progress line per Task 5, linking to the
  existing `/gov/projects/:projectId/checklist` route (already in `App.tsx:77`).
- [ ] **Step 4: `OutsideAreaScreen`** — rendered on a 403 from `useArea`.
- [ ] **Step 5: `AreaPage`** — switch on `node.level`: `STATE`/`DISTRICT` render
  `DistrictPerformanceMap` above the card grid (it already merges live scores);
  mid-levels render the grid alone; `PROJECT` renders the site view.
- [ ] **Step 6: i18n keys in en.json AND ta.json.**
- [ ] **Step 7: `npx vitest run && npx tsc -b && npx oxlint`.** - [ ] **Step 8: Commit.**

---

### Task 9: Routing

**Files:** Modify `web/src/App.tsx`, `web/src/app/GovLayout.tsx`

- [ ] **Step 1:** Add `<Route path="area/:orgUnitId?" element={<AreaPage />} />` inside the existing `/gov` block (`App.tsx:73`).
- [ ] **Step 2:** Point the `/gov` index at the Area landing. There is **no**
  `/gov/dashboard` route today — the dashboard is the index element
  (`App.tsx:74`), so the spec's "old route redirects" means replacing the index.
  Keep `RoleDashboard` mounted for the panels Task 8 does not yet absorb.
- [ ] **Step 3:** Verify in the running app that a district officer landing on `/gov` is forwarded to their own district. - [ ] **Step 4: Commit.**

---

### Task 10: Role-differentiated nav defaults

**Files:** Create `supabase/migrations/20260723000200_area_nav_defaults.sql`; modify `web/src/lib/navConfig.ts`; test `web/src/lib/navConfig.test.ts` (exists)

- [ ] **Step 1: Failing nav tests, one fixture per role**

Assert HEAD_ADMIN sees `area` but not `planner`; SITE_ENGINEER sees `area, planner, orders, quality, checklist` but not `vendors`/`analytics`/`audit`; AUDITOR's set is read-only. Assert `ratings` survives for the roles that have it today.

- [ ] **Step 2: Run, watch fail.**

- [ ] **Step 3: Add the `area` tab key**

In `GOV_NAV_TAB_KEYS` (`navConfig.ts:16`) add `{ key: 'area', labelKey: 'area.nav' }`,
and in `GOV_ALL` (`navConfig.ts:28`) add
`{ to: '/gov/area', labelKey: 'area.nav', navKey: 'area', requiresPermission: 'order.read' }`
as the **first** entry — Area is everyone's first tab.

- [ ] **Step 4: Migration seeding the matrix**

`jsonb_set` each role key, adding `area` and the spec's §3 set while preserving
`ratings` where present (per the confirmed decision). Idempotent: guard with
`where key = 'nav_visibility'` and use `||` merge semantics, not blind overwrite,
so an operator's later edits via the admin screen are not clobbered on re-run.

- [ ] **Step 5: Run, watch pass.** - [ ] **Step 6: Apply the migration locally and confirm each seeded role's `/api/me` returns its new tab set.** - [ ] **Step 7: Commit.**

---

### Task 11: Full verification

- [ ] **Step 1:** `npx vitest run` — all green.
- [ ] **Step 2:** `npx tsc -b` — exit 0. **Step 3:** `npx oxlint` — no new warnings.
- [ ] **Step 4: Drive the real app** (per the `run` skill), signing in as each of
  HEAD_ADMIN (`9000000001`), a district officer (`9000000002`), and a site
  engineer, and confirm:
  - HEAD_ADMIN reaches a site checklist in ≤4 taps from `/gov/area`;
  - the district officer lands on their district and the crumbs above it are inert text;
  - a hand-typed out-of-scope `/gov/area/<other-district-id>` shows the friendly screen;
  - each role's tab strip matches the matrix.
- [ ] **Step 5: Commit and open the PR**, noting the two spec deviations recorded
  in Ground Truth plus the landing simplification from Task 6.

---

## Self-Review

**Spec coverage:** §1 four levels → Tasks 4, 5, 8 (adapted to 8 real levels via
collapse); §1 breadcrumbs/no-drill-up → Task 3, Task 8 Step 1; §1 deep links +
outside-area screen → Task 4 Step 3, Task 8 Step 4; §2 landing → Task 6 (one
documented reduction); §3 matrix → Task 10; §4 DTO → Task 4; §4 shared KPI SQL →
Task 1; §5 tests → Tasks 2, 3, 4, 6, 10, 11.

**Known gaps, deliberate:** (a) "engineer with exactly one active project" landing
needs `/api/me` to expose projects — deferred, Task 6 notes it. (b) The multi-anchor
district switcher is reused from the maps build, not rebuilt. (c) `qualityScore` in
`summary` reuses `scoreFromHealthCounts`; if the spec intended a different quality
metric, that is a one-line change in Task 1 Step 4.
