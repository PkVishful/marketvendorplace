# District Dashboards — Correct Map Resolution + Live Data (Phase 1)

**Date:** 2026-07-22
**Status:** Approved (design), pending implementation plan
**Scope owner:** gov dashboard / district officers

## Context

Every district officer's dashboard renders `<DistrictPerformanceMap districtName=… orgPath=…/>`
(from `RoleDashboard.tsx`). Today that component pulls everything from a **static,
client-fabricated registry**:

- `registry.ts:resolveDistrictKey()` falls back to `'coimbatore'` for any org
  path/name it can't match — so officers in unmapped districts see **Coimbatore's
  map**.
- All 37 non-Coimbatore districts use `buildGridMap()`, whose region scores are
  **fabricated** (`registry.ts:38` derives a score from the district name length).

So both the *map shown* and the *numbers on it* are wrong for most officers.

This is the first of three sub-projects derived from the "District Maps for Every
District Officer" prompt. It fixes the two user-visible bugs (wrong map, fake
numbers) without any external-data dependency.

## Goals

1. Each gov user sees the correct map for **their own** scope — never another
   district's, never a silent Coimbatore fallback.
2. Regions on that map are colored by **real, RLS-scoped live data** — no
   fabricated scores anywhere.
3. Groundwork (resolution correctness, a live endpoint, tests) that subsystem 1
   (real geometry) and any later work can build on.

## Non-goals (explicitly deferred)

- Real geographic polygon geometry for 38 districts / their talukas — that is
  **subsystem 1** (a separate, data-gated effort needing openly-licensed GeoJSON).
- The build-time GeoJSON→SVG pipeline, `districtMaps/generated/*`, per-district
  code-splitting, ATTRIBUTION.md.
- Mobile pinch-zoom / hit-area work tied to real polygons.

## The one honest tradeoff (decided in brainstorming)

The map *draws* talukas, but **live data only exists per PWD `org_unit`**
(division/section): every `test_order` is keyed to `o.org_unit_id`, there is **no
`TALUKA` level** in `eworks.org_level`, and nothing links a taluka to any data
row. Attributing order/job data to a taluka polygon is impossible in this phase
(no real geometry) without fabricating.

**Decision: a colored "region" is a PWD org unit, not a taluka.** Consequence:
Phase 1 delivers a **schematic regional breakdown** (a grid of the officer's own
org units, colored by real data) — **not** a geographic map. The geographic
taluka map is subsystem 1; when it lands it will need its own taluka→data
reconciliation (either a taluka→org-unit mapping or a geometric point-in-polygon
join). This doc does not oversell Phase 1 as a geographic map.

## Design

### 1. Map resolution (`districtMaps/registry.ts`)

- **Fallback fix:** `resolveDistrictKey()` returns `'tamilnadu'` (state map) for
  any unresolved key — never `'coimbatore'`. The UI shows a subtle "district map
  unavailable" note when the fallback fires (distinguish "you're state-level"
  from "we couldn't resolve your district").
- **Role priority:** resolve the org unit from the user's **highest-priority gov
  role in the current portal**, ranked by org-level ordinal (state-most-senior
  first) — not `roles[0]`. Selection helper lives next to the session code that
  already knows the user's roles.
- **Level scoping:**
  - STATE role → TN map; districts colored; clicking a district drills into that
    district's org-unit grid.
  - DISTRICT role → that district's org-unit grid.
  - DIVISION / SUBDIVISION role → the district grid with the user's own subtree
    highlighted and sibling units dimmed.
- **District switcher:** rendered only when the user holds gov roles in **more
  than one** district; a small `<select>` above the map, options = their role
  districts. Single-district users see no switcher.
- **Alias coverage + guard test:** extend `ORG_PATH_ALIASES` so every org path
  seeded in `20260709000200_org_units.sql` resolves to its own district key. A
  unit test walks every seeded district node and asserts it resolves to its own
  key (and that an unknown path resolves to `tamilnadu`). This test is the
  standing guard against the Coimbatore-fallback bug class.

### 2. Live data endpoint — `GET /api/gov/dashboard/map` (`web/server/bff.mjs`)

- Runs entirely inside `withUserSession(userId, …)`; RLS scopes every read to the
  caller's subtree, so a Madurai officer can never receive Chennai regions
  (scope isolation is enforced by the DB, not app code).
- Response shape:

  ```json
  { "level": "district", "key": "madurai",
    "regions": [ { "id": "<org_unit_id>", "name": "Melur Division",
      "score": 82,
      "kpis": { "openOrders": 3, "activeJobs": 2, "failedTests30d": 1,
                "certificates30d": 12, "vendorsActive": 5 } } ] }
  ```

- **Regions = the caller's immediate child org units.** STATE caller → the
  districts; DISTRICT caller → its divisions. Each region's metrics roll up **all
  orders in that child's subtree** (via `org_units.path` `<@` containment).
- **KPIs per region** (all subtree-scoped, "30d" = last 30 days):
  - `openOrders` — orders not in a terminal state.
  - `activeJobs` — jobs in progress (assigned/checked-in/…, not complete).
  - `failedTests30d` — failed test results in the window.
  - `certificates30d` — certificates issued in the window.
  - `vendorsActive` — distinct vendors with an awarded job in the subtree.
- **No fabrication:** a region whose orders are all in-flight (or which has zero
  orders) returns `score: null` → rendered neutral gray with "no activity yet" in
  the sheet.

### 3. Score formula (documented in code)

Reuse the existing `computeMilestoneHealth(row)` (green / amber / red / neutral
per order). Roll up per region:

```
score = round( 100 × (green + 0.5 × amber) / (green + amber + red) )
```

- `neutral` orders (DRAFT/FLOATED/REVEALING — no quality signal yet) are excluded
  from the denominator.
- denominator == 0 → `score = null` (no signal). Colors come from the existing
  `performanceFromScore` bands.

Rationale: `computeMilestoneHealth` is already the app's canonical order-health
calc (used by `/api/gov/quality`); green = delivered/verified, red =
failed/escalated, amber = awarded-but-unfinished. A weighted pass ratio over
those is explainable and needs no new quality math.

### 4. Component (`components/dashboard/DistrictMap.tsx`)

- Add `useQuery(['dashboard-map'], → GET /api/gov/dashboard/map)`.
- Build the grid **from the returned regions** (data-driven), keyed by
  `org_unit_id`; color each by `performanceFromScore(score)`; `null` → neutral.
- **Loading skeleton** over the map while the query is pending.
- Tap a region → bottom sheet showing the 5 KPIs + deep links: open orders → gov
  orders list filtered to that org unit; failed tests → quality page. (May add an
  `orgUnit` query param to the orders list route/endpoint.)
- Mobile: map full-width; tap targets ≥ 44 px.
- i18n: all new strings in `en` + `ta`; theme + a11y per master prompt.

## Data flow

```
session (roles) ──► resolveScope() ──► level + district key ──► which map def
     │
     └► useQuery ─► GET /api/gov/dashboard/map ─(withUserSession/RLS)─► regions[]
                         │
                         └► merge score+kpis onto grid regions ─► colored map + sheet
```

## Testing (definition of done)

- **Resolution guard** (`registry` test): every district node seeded in
  `20260709000200_org_units.sql` resolves to its own key; unknown path →
  `tamilnadu`; no production path resolves to a *different* district's map.
- **Endpoint** (`.db.test.mjs`, skip-if-DB-down pattern): scope isolation (a
  district officer receives only their subtree's regions), score-formula unit
  test (green/amber/red inputs → expected number; all-neutral → `null`),
  empty-data shape.
- **Component:** correct map/regions per role fixture (state / district /
  subdivision), switcher appears only for multi-district users, KPI sheet deep
  links.
- `npm run test`, `npm run lint`, `tsc -b` green.

## Demo (acceptance)

- Log in as a non-Coimbatore district officer (e.g. Salem) → **their** district's
  org-unit grid, colored from live data — not Coimbatore.
- Log in as HEAD_ADMIN → TN map; click a district → that district's grid.
- Region with no live activity → neutral gray "no activity yet", not a fake
  score.
- All strings render in en + ta.

## Files touched (anticipated)

- `web/src/components/dashboard/districtMaps/registry.ts` — fallback, role
  priority, level scoping, alias coverage.
- `web/src/components/dashboard/districtMaps/talukaData.ts` — `ORG_PATH_ALIASES`
  extension.
- `web/src/components/dashboard/DistrictMap.tsx` — live query, data-driven grid,
  skeleton, KPI sheet, switcher.
- `web/server/bff.mjs` — new `GET /api/gov/dashboard/map` + region score/KPI SQL.
- Session/role helper (highest-priority role) — a small pure function colocated
  with the existing role/portal helpers in `web/src/types/domain.ts`.
- Tests: registry resolution, endpoint `.db.test.mjs`, component fixtures.
- i18n `en.json` + `ta.json` — new dashboard-map strings.
