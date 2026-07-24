# Works-Tender Phase 1 — Notice & Eligibility — Design

*Status: approved 2026-07-24. Phase 1 of a 4-phase works-tender build (see
`docs/works-tender-audit.md`). Branch: `feat/works-tender` (off master).
Extends the existing `contracts` layer from
`20260713000100_contracts_materials.sql` — never forks a parallel tender system.
Follows the master prompt: i18n en+ta, a11y, RLS/`in_scope()`, hash-chained audit
logging, paise-only money, no Supabase service-role.*

## Goal

Turn the contractor works-tender flow from an amount-only bidding stub into a
real tendering front door: a contract can be **sanctioned**, given a
**publishable tender notice** with **structured eligibility criteria** and key
dates, amended by **corrigendum**, and shown on a **public tender board**.
Contractors can record **experience / machinery / engineers** for later
technical evaluation. Bidding, evaluation, award, and post-award are later
phases.

## Decisions (resolved in brainstorming)

1. **Public tender board** — an unauthenticated public page + endpoint listing
   only PUBLISHED notices (real e-gov transparency).
2. **Authoring gate = `contract.manage`** — the existing permission that already
   governs contracts. No new permission/role.
3. **Structured eligibility criteria** — named criterion rows per notice, so
   Phase 2 technical bids answer each and Phase 3 evaluates per-criterion.
4. **Notice ↔ contract is 1:1** — a notice is created for an existing `contracts`
   row (DRAFT); publishing it moves the contract to `FLOATED`.

## Ground truth (verified)

- `eworks.contracts` (`…000100:184-207`): `code, title, value_paise, status`
  (enum `DRAFT/FLOATED/AWARDED/CANCELLED`), `project_id` (forced to a PROJECT org
  unit by trigger `:212-226`), `created_by/at`, `awarded_by/at`, constraint
  `contracts_award_attributed`.
- Permissions present: `contract.read`, `contract.manage`, `contract.award`.
- Public-data convention: `/api/public/certificates/:id` (`bff.mjs:284`) uses a
  **direct `pool.query`** (no `withUserSession`) selecting only public columns
  for a specific lookup — this is how anon reads are served (not a Supabase
  service-role; the server's own DB connection). The tender board mirrors it.
- Authenticated data goes through `withUserSession(userId, fn)` (`db.mjs:53`,
  `set local role eworks_authenticated` + `app.user_id`) so RLS scopes rows.
- Audit logging: state changes append to the hash-chained `eworks.audit_logs`
  (per the audit/`…000400` spine used across the app).

## Scope

**In (Phase 1):** the schema below; `contract.manage` authoring endpoints;
public board endpoints; contractor eligibility CRUD; the gov tender wizard,
public tender board + notice detail, and contractor eligibility profile screens;
the four DB-enforced rules; tests; en+ta.

**Out (later phases):** EMD, technical/financial bids, deadline enforcement on
bids, technical evaluation, financial opening, auto-L1, award justification, LOA,
performance security, agreement, RA bills, completion certificate. Also deferred:
wiring the orphaned BOQ/material-delivery DB to BFF/UI (Phase 4).

## Migration (one, additive: `…000400_tender_notices.sql`)

All new tables reference existing `contracts`/`contractors`; none alter them.

- **`sanctions`** — `id`, `contract_id` (fk, unique — one live sanction per
  contract), `sanctioned_amount_paise bigint check (>0)`, `order_no text`,
  `sanctioned_by uuid` (fk user_profiles), `sanctioned_at timestamptz`,
  `created_at`.
- **`tender_notices`** — `id`, `contract_id` (fk, unique 1:1), `notice_no text`,
  `scope_summary text`, `estimated_value_paise bigint check (>0)`,
  `completion_period_days int check (>0)`, `emd_amount_paise bigint check (>=0)`,
  `publish_at`, `query_deadline_at`, `submission_close_at`, `technical_opening_at`,
  `financial_opening_at` (all timestamptz), `status eworks.tender_notice_status`
  (new enum `DRAFT/PUBLISHED/CLOSED/CANCELLED`, default DRAFT), `published_by`,
  `published_at`, `created_by/at`. Check: date ordering
  `publish_at <= submission_close_at <= technical_opening_at <= financial_opening_at`.
- **`tender_eligibility_criteria`** — `id`, `notice_id` (fk), `seq int`,
  `label text`, `description text`, `kind text` (free label now, e.g.
  `min_class`/`min_experience_value`/`min_similar_works`), `created_at`.
- **`tender_corrigenda`** — `id`, `notice_id` (fk), `corrigendum_no int`,
  `summary text`, `changes jsonb` (amended fields snapshot), `issued_by`,
  `issued_at`. Append-only (no update/delete grant); `unique(notice_id, corrigendum_no)`.
- **`contractor_experience`** — `id`, `contractor_id` (fk), `work_name`,
  `client_name`, `value_paise bigint check (>0)`, `completed_on date`,
  `completion_doc_path text null`, `created_at`.
- **`contractor_machinery`** — `id`, `contractor_id` (fk), `name`,
  `quantity int check (>0)`, `capacity text null`, `created_at`.
- **`contractor_engineers`** — `id`, `contractor_id` (fk), `name`,
  `qualification text`, `role text`, `created_at`.

## RLS (following `…000500_rls.sql` patterns)

- **Management tables** (`sanctions`, `tender_notices`,
  `tender_eligibility_criteria`, `tender_corrigenda`): SELECT/INSERT/UPDATE for
  `eworks_authenticated` where the caller holds **`contract.manage`** on the
  parent contract's `project_id` org path (`has_permission('contract.manage',
  ou.path)`), i.e. in-scope officers only. Corrigenda: INSERT + SELECT only (no
  UPDATE/DELETE — append-only history).
- **Contractor child tables** (`contractor_experience/machinery/engineers`):
  a contractor SELECT/INSERT/UPDATE/DELETE only rows for a `contractors` row they
  own (`owner_user_id = current_user_id()`); in-scope officers may SELECT (for
  later evaluation).
- **Public read is NOT via RLS.** The public board/detail endpoints use a direct
  scoped `pool.query` (mirroring `/api/public/certificates/:id`) that selects
  only `status='PUBLISHED'` notices and public columns (+ their criteria and
  corrigenda + parent contract `code/title`). No draft/cancelled notice and no
  internal field is ever selected on the public path. No session, no user data.

## DB-enforced rules (this phase)

1. **Sanction-before-publish:** a `BEFORE UPDATE` trigger on `tender_notices`
   rejects a transition to `PUBLISHED` unless a `sanctions` row exists for its
   `contract_id`.
2. **Publish floats the contract:** the same `tender_notices` PUBLISHED-transition
   trigger sets the parent `contracts.status = 'FLOATED'` (rules 1 and 2 are one
   trigger — sanction check then contract float — so the rule lives in the DB,
   not the endpoint).
3. **Corrigendum only on PUBLISHED:** a `BEFORE INSERT` trigger on
   `tender_corrigenda` rejects unless the notice is `PUBLISHED`; `corrigendum_no`
   auto-increments per notice.
4. **Audit-logged:** sanction insert, notice publish, and corrigendum issue each
   append to `eworks.audit_logs` (via the existing audit trigger/helper pattern).

## BFF endpoints

- **Gov (`withUserSession`, RLS-gated by `contract.manage`):**
  `POST /api/gov/tenders/:contractId/sanction`;
  `POST /api/gov/tenders/:contractId/notice` (create/update draft notice +
  criteria); `POST /api/gov/tenders/:contractId/notice/publish`;
  `POST /api/gov/tenders/:contractId/notice/corrigendum`;
  `GET /api/gov/tenders/:contractId` (full authoring view).
- **Public (direct `pool.query`, no auth):** `GET /api/public/tenders` (board:
  published, open by date), `GET /api/public/tenders/:noticeId` (detail +
  criteria + corrigenda).
- **Contractor (`withUserSession`):** CRUD `GET/POST/PATCH/DELETE
  /api/contractor/eligibility/{experience,machinery,engineers}`; document upload
  reuses the existing KYC upload path.

## Frontend (`web/src/features/…`)

- **Gov — Tender wizard** (`features/gov/tenders/`): select/create a DRAFT
  contract → **Sanction** step (amount, order no) → **Notice** step (fields +
  add/remove eligibility criteria) → **Publish** (guarded; shows "sanction
  required" until present). A published notice gets a **Corrigendum** action
  (edit dates/details → records a corrigendum with history).
- **Public — Tender board** (`features/public/tenders/`): responsive cards of
  open tenders with a live **countdown to submission close**; detail page shows
  scope, estimated value, EMD, all key dates, criteria list, and corrigendum
  history. No login.
- **Contractor — Eligibility profile** (`features/contractor/eligibility/`):
  add/edit/remove experience, machinery, engineers; experience completion doc
  via the KYC-style uploader.
- Reuses `Pagination`, `formatInr`, `StatusPill`, gov-card, existing form
  patterns. en + ta, a11y, mobile-usable.

## Component boundaries (isolation)

- **`tender-queries.mjs`** (server) — pure SQL query builders for gov authoring +
  public board, each taking a `client`/`pool`. Public queries live here too,
  clearly separated as the anon path.
- **`tenderModel` (TS)** — pure client helpers: date-window state (open / closing
  soon / closed) from the key dates, countdown formatting; unit-tested.
- **endpoints** — thin wrappers: auth (or none for public) → query → JSON.
- **presentational components** — take data + callbacks, no fetching logic.

## Tests & definition of done

- **DB tests** (local Postgres, self-forcing `EWORKS_USE_LOCAL_PG=1`):
  publish blocked without a sanction; publish sets contract FLOATED; corrigendum
  blocked on a non-published notice and auto-numbers; a `contract.manage` officer
  in another district cannot read/author this district's notice; a contractor
  sees only their own eligibility rows.
- **Public-safety test:** the public query returns a PUBLISHED notice but NEVER a
  DRAFT/CANCELLED one, and exposes no non-public column.
- **Model unit test:** date-window/countdown logic (open vs closing-soon vs
  closed), including missing dates.
- **Flow test (seeded):** create contract → sanction → author notice + 3 criteria
  → publish → the notice appears on the public board with its criteria; every
  state change is in the audit log.
- `npm test`, `npm run lint`, `tsc -b` green; all strings en + ta; the existing
  contract/marketplace suites still green (no regression).
- **Demo:** an officer runs the wizard (sanction → notice → publish); the tender
  appears on the public board with a countdown; a corrigendum updates a date and
  shows in history; a contractor adds an experience record.
