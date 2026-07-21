# Full Test Checklist Screens — Design

*Status: approved 2026-07-21. Supersedes `vendor-rate-card-build-prompt.md` §4 and
`simplify-and-admin-build-prompt.md` B4.*

Builds the screens that show **every test at every construction level in one
place** — as a master reference (all 64 tests under all 9 levels) and as a live
per-project checklist. Everything renders from the API; no catalog data is
hard-coded in the frontend, so future catalog edits appear automatically.

## Goals / definition of done

- A site engineer opens one screen and sees all 64 tests under all 9 construction
  levels, can search ("bitumen" → jumps to Roadwork), filter by domain/NABL, and
  print the whole thing.
- The same engineer opens a project's checklist and sees exactly which required
  tests are certified, ordered, or still missing at each level, with working deep
  links to the order/job behind each row.
- All strings in `en` and `ta`; zero hard-coded catalog data in the frontend.
- `npm run test`, `npm run lint`, `tsc -b` green in `web/`.

## Data source (read the DB, don't hard-code)

Already seeded: 64 tests in `eworks.test_catalog`, 9 levels in
`eworks.construction_stage` (sequence 1–9: SITE_INVESTIGATION, EARTHWORK,
FOUNDATION, SUBSTRUCTURE, SUPERSTRUCTURE, MASONRY, ROADWORK, FINISHES, SERVICES),
mapping + frequencies in `eworks.test_stage_rules`. **No new migrations.**

Verification numbers (must render): stage-rule counts per level =
`8, 2, 12, 5, 15, 4, 9, 6, 14`; two cross-stage tests (concrete mix design, water
quality) in their own group; repeats (slump + cube across Foundation/
Substructure/Superstructure, cement, steel) render under every level they apply
to, marked "repeats".

### Relevant schema

- `construction_stage(id, code, name, sequence)`.
- `test_catalog(id, code, name, domain, default_is_code, requires_nabl,
  typical_tat_days, is_active)`.
- `test_stage_rules(id, test_id, stage_id, frequency_type, frequency_spec jsonb,
  is_code, org_unit_id, is_active)` — `frequency_type` ∈ `ONCE, PER_STAGE,
  PER_LOT, PER_VOLUME, PER_AREA, PER_LAYER, PER_HEAT, PER_CONSIGNMENT`.
- `project_test_requirements(id, project_id, test_id, stage_id, planned_count,
  completed_count, status)` — status ∈ `PLANNED, FLOATED, IN_PROGRESS, COMPLETE,
  WAIVED`.
- Join chain for live status: `project_test_requirements` ← `order_items.requirement_id`
  → `test_orders(status: DRAFT/FLOATED/REVEALING/AWARDED/CANCELLED/FAILED)`;
  `test_orders` → `test_jobs(order_id)` → `test_results(job_id, passed)` /
  `certificates(job_id, one per job)`.

## Layer 1 — BFF endpoints (`web/server/bff.mjs`)

### 1a. `GET /api/catalog/checklist` (new)

Any authenticated user; inside `withUserSession` (RLS read; no service role).
One query `construction_stage ⋈ test_stage_rules ⋈ test_catalog`, active rows only,
ordered by `cs.sequence, tc.name`. Response:

```json
{ "stages": [ { "code": "SITE_INVESTIGATION", "sequence": 1, "name": "…",
    "tests": [ { "code": "SOIL_BEARING_CAPACITY", "name": "…", "domain": "soil",
      "isCode": "IS 1888", "requiresNabl": true, "tatDays": 7,
      "frequency": { "key": "catalog.freq.ONCE", "params": { "unit": "site" } },
      "repeatsAcrossStages": false } ] } ],
  "crossStage": [ … same test shape … ] }
```

Rules:
- A test appears under **every** stage its rules map it to. `repeatsAcrossStages`
  = the test maps to more than one stage.
- `domain` is emitted as a UI-facing slug (soil, concrete, cement, aggregate,
  steel, weld, masonry, road/bitumen, waterproofing, finishes, electrical,
  plumbing, fire, HVAC) derived from the `test_domain` enum.
- `isCode` = `test_stage_rules.is_code` if set, else `test_catalog.default_is_code`.
- **Frequency is a localization key + params, never English text.** Server maps
  `frequency_type` (+ tiered `frequency_spec` for the IS 456 cube ladder →
  `catalog.freq.PER_VOLUME_IS456`) to `{ key, params }`; the client renders
  `t(key, params)`. Keeps Tamil working and honors "no hard-coded catalog text."
- Cross-stage group = the two `ONCE` tests that are conceptually any-level
  (concrete mix design, water quality); pulled out of `stages` into `crossStage`.

### 1b. `GET /api/gov/projects/:projectId/checklist` (new — distinct from `/requirements`)

Same `order.read`-in-scope RLS gate as `/requirements`. Left-joins requirements to
`order_items → test_orders` (deep-link `orderId` + order status) and
`test_jobs → certificates` / `test_results` (deep-link `jobId`; `FAILED` when a
result has `passed=false` with no later passing retest). Derives per-row status
`PLANNED | ORDERED | IN_PROGRESS | CERTIFIED | FAILED` (from `ptr.status`:
FLOATED→ORDERED, COMPLETE→CERTIFIED; FAILED from results). Returns **all 9 stages**;
stages that have catalog rules but no generated requirements are marked
`unplanned` so the UI can render a "not planned yet" row set.

A new endpoint (not an overload of `/requirements`) so the planner keeps its
existing contract.

## Layer 2 — Master checklist screen (§2)

One shared component `src/features/catalog/ChecklistScreen.tsx` (+ `useChecklist.ts`,
`api.ts`), two routes.

- **Layout:** 9 collapsible level sections in sequence order; header = level name +
  test count. Row per test: bilingual name, code, IS-code chip, NABL chip,
  frequency label (`t(freq.key, freq.params)`), TAT; "Repeats" badge where
  applicable. 10th section "Any level" for the two cross-stage tests.
- **Toolbar:** search (name/code/IS code); domain filter chips (soil, concrete,
  cement, aggregate, steel, weld, masonry, road/bitumen, waterproofing, finishes,
  electrical, plumbing, fire, HVAC); "NABL only" toggle; expand-all/collapse-all;
  **Print** (print stylesheet: all sections expanded, one level per page break,
  header with date).
- **Route `/gov/checklist`** — plain reference screen.
- **Route `/vendor/tests`** — same component, `variant="vendor"`: each row also
  shows "You offer this" (capability) and "Priced ₹X" / "Not priced" (from the
  existing `pricing/` API). Price chips hide gracefully if that API is absent.
  Deep links: not offered → onboarding capabilities step; not priced → My Rates.
- Mobile-first accordion; keyboard navigable; no colour-only meaning.
- Nav: "Test checklist" → gov nav; "Tests we do" → vendor nav; respect the
  tab-visibility matrix (admin build present). New icons in `navIcons.tsx`.

## Layer 3 — Per-project checklist (§3, upgrade existing page)

Rewrite `src/features/gov/ProjectChecklistPage.tsx` (route
`/gov/projects/:projectId/checklist` already wired) to consume 1b:

- Same 9-level layout as a **live status checklist** for one project, entered from
  the planner page.
- Checkbox checked only when CERTIFIED; FAILED shows a red chip linking to the
  failure/retest trail; each row deep-links to its order or job.
- Level header shows progress ("4 of 12 certified") with a thin progress bar; a top
  summary card totals the project.
- Stages with no generated requirements → subdued "not planned yet" row set, with a
  link to the planner pre-filtered to that level.
- Printable "site copy": statuses render as ☑ / ☐ / ✗ with project name, district,
  date in the header.
- Permission: `order.read` within scope (same gate as the requirements API).

## Testing (§4)

- **API shape (server, vitest):** 9 stages in sequence; per-level counts exactly
  `8,2,12,5,15,4,9,6,14`; cross-stage = 2; repeat flags set for
  slump/cube/cement/steel where expected.
- **Component (RTL):** search narrows across levels; domain filter (soil → stages
  1+2 only; road/bitumen → stage 7); NABL toggle; print view expands all.
- **Project checklist:** status mapping for each state incl. FAILED; scope test —
  an officer outside the project's district gets 403/empty per existing RLS.
- **Vendor route** degrades cleanly when the pricing API is absent.

## Out of scope / non-goals

- No new migrations or catalog edits.
- No changes to the planner's `/requirements` contract.
- No new pricing/capability write paths — the vendor route only reads existing
  pricing/capability data.
