# Works-Tender Phase 1 (Notice & Eligibility) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the tender front door to the existing `contracts` layer — sanction → publishable tender notice (+ structured eligibility criteria) → publish → **public** tender board, plus contractor experience/machinery/engineers records.

**Architecture:** One additive migration adds 7 tables (referencing existing `contracts`/`contractors`), an enum, RLS policies, and three `security definer` state-change functions (`record_sanction`, `publish_tender_notice`, `issue_corrigendum`) that enforce the rules and append hash-chained audit rows — plus defense-in-depth triggers so the rules can't be bypassed by a raw UPDATE. Thin BFF endpoints call the functions inside `withUserSession`; public board endpoints use a direct scoped `pool.query`. React screens: gov tender wizard, public tender board+detail, contractor eligibility profile.

**Tech Stack:** Postgres (`eworks` schema), Node/Express (`.mjs`), Vite+React 19+TS, TanStack Query, Tailwind, vitest, i18next (en+ta).

## Global Constraints

- **Extend, never fork:** every new table references existing `contracts`/`contractors`; none alter them. Money is `*_paise` bigint; `pg` returns bigint as string → wrap with `Number(...)` before JSON.
- **Rules live in the DB.** The three controlled operations are `security definer` functions that (1) check the caller holds the permission via `eworks.has_permission('contract.manage', <project path>)` — because `security definer` bypasses RLS, the function MUST check this itself and `raise exception` if absent — (2) enforce the business rule, (3) do the state change, (4) append an audit row. Defense-in-depth triggers also enforce rules 1 & 3 against raw UPDATEs/INSERTs.
- **Audit rows are appended ONLY inside `security definer` functions** (as `eworks.record_material_delivery` does) — `eworks_authenticated` has no INSERT on `audit_logs`. Format: `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload) values (eworks.current_user_id(), '<action>', '<entity>', <id>, <ltree path>, <jsonb>)`.
- **Public data is NOT RLS.** Board/detail endpoints use a direct `pool.query` (like `/api/public/certificates/:id`, `bff.mjs:284`) selecting only `status='PUBLISHED'` notices and public columns. No draft/cancelled notice, no internal column, no session ever on the public path. This is NOT the Supabase service-role key — it is the server's own DB connection, the codebase's established public-read convention.
- **Authenticated paths** use `requireUser(req,res)` then `withUserSession(userId, async (client) => …)`; officer gating is by RLS (`contract.manage`) + the function's own permission check.
- **i18n:** every user-facing string has a key in BOTH `web/src/i18n/en.json` and `web/src/i18n/ta.json` (ta may carry English placeholder text — the repo's convention).
- **DB tests** carry `// @vitest-environment node`, force `EWORKS_USE_LOCAL_PG='1'` + local PG env BEFORE importing `db.mjs` (dynamic `await import('./db.mjs')`), use a raw `pg.Pool` probe to find fixtures + `describe.skipIf(!dbAvailable)`. Local DB: `127.0.0.1:5433`, db `eworks` (`docker start eworks-pg`).
- **Commands** from `web/`: `EWORKS_USE_LOCAL_PG=1 npx vitest run …`, `npm run lint` (oxlint), `npx tsc -b`.
- **Migration numbering:** this branch (`feat/works-tender`, off master) is at `…20260723000100`. Use `20260724000400_tender_notices.sql` (the `…000400` suffix avoids colliding with the separate oversight branch's `…000100/200/300`).

---

## File Structure

**Create:**
- `supabase/migrations/20260724000400_tender_notices.sql` — enum, 7 tables, indexes, RLS, 3 functions, 2 guard triggers, grants.
- `web/server/tender-queries.mjs` — `govTenderView(client, contractId)`, `publicTenderBoard(pool)`, `publicTenderDetail(pool, noticeId)`, `contractorEligibility(client)`.
- `web/server/tender.db.test.mjs` — DB tests (rules, scope, public-safety).
- `web/server/tender-model.test.mjs` — n/a (model is client-side; see below).
- `web/src/features/gov/tenders/` — `tenderApi.ts`, `useTenders.ts`, `TenderWizardPage.tsx`, `SanctionStep.tsx`, `NoticeStep.tsx`, `CorrigendumDialog.tsx`.
- `web/src/features/public/tenders/` — `publicTenderApi.ts`, `usePublicTenders.ts`, `tenderModel.ts` (+`tenderModel.test.ts`), `TenderBoardPage.tsx`, `TenderDetailPage.tsx`.
- `web/src/features/contractor/eligibility/` — `eligibilityApi.ts`, `useEligibility.ts`, `EligibilityPage.tsx`.

**Modify:**
- `web/server/bff.mjs` — register gov tender, public tender, and contractor eligibility endpoints.
- `web/server/seed-contracts.mjs` — seed one DRAFT contract usable by the flow.
- `web/src/App.tsx` — public `/tenders` + `/tenders/:noticeId`; gov `/gov/tenders` (+`/:contractId`); contractor `/contractor/eligibility`.
- `web/src/lib/navConfig.ts` — gov nav `tenders` item (gated `contract.manage`); contractor nav `eligibility` item.
- `web/src/types/domain.ts` — tender/eligibility DTOs.
- `web/src/i18n/en.json`, `web/src/i18n/ta.json` — `tender.*` / `eligibility.*` keys.

---

## Task 1: Migration — enum, tables, indexes, RLS

**Files:** Create `supabase/migrations/20260724000400_tender_notices.sql` (functions/triggers added in Task 2). Test: manual SQL assertions.

**Interfaces produced:** `eworks.tender_notice_status` enum; tables `sanctions`, `tender_notices`, `tender_eligibility_criteria`, `tender_corrigenda`, `contractor_experience`, `contractor_machinery`, `contractor_engineers`, all RLS-enabled.

- [ ] **Step 1: Write the enum + tables**

Create `supabase/migrations/20260724000400_tender_notices.sql`:

```sql
-- Works-tender Phase 1: notice & eligibility. Extends the contracts layer.
create type eworks.tender_notice_status as enum ('DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED');

create table eworks.sanctions (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null unique references eworks.contracts(id) on delete cascade,
  sanctioned_amount_paise bigint not null check (sanctioned_amount_paise > 0),
  order_no      text not null check (length(trim(order_no)) > 0),
  sanctioned_by uuid not null references eworks.user_profiles(id),
  sanctioned_at timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table eworks.tender_notices (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null unique references eworks.contracts(id) on delete cascade,
  notice_no     text not null check (length(trim(notice_no)) > 0),
  scope_summary text not null check (length(trim(scope_summary)) > 0),
  estimated_value_paise bigint not null check (estimated_value_paise > 0),
  completion_period_days int not null check (completion_period_days > 0),
  emd_amount_paise bigint not null check (emd_amount_paise >= 0),
  publish_at         timestamptz,
  query_deadline_at  timestamptz,
  submission_close_at timestamptz,
  technical_opening_at timestamptz,
  financial_opening_at timestamptz,
  status        eworks.tender_notice_status not null default 'DRAFT',
  published_by  uuid references eworks.user_profiles(id),
  published_at  timestamptz,
  created_by    uuid not null references eworks.user_profiles(id),
  created_at    timestamptz not null default now(),
  -- Key dates, when all present, must be ordered.
  constraint tender_notice_dates_ordered check (
    submission_close_at is null or technical_opening_at is null
    or (submission_close_at <= technical_opening_at
        and (financial_opening_at is null or technical_opening_at <= financial_opening_at))
  )
);

create table eworks.tender_eligibility_criteria (
  id          uuid primary key default gen_random_uuid(),
  notice_id   uuid not null references eworks.tender_notices(id) on delete cascade,
  seq         int not null check (seq >= 0),
  label       text not null check (length(trim(label)) > 0),
  description text not null default '',
  kind        text not null default 'general',
  created_at  timestamptz not null default now(),
  unique (notice_id, seq)
);

create table eworks.tender_corrigenda (
  id            uuid primary key default gen_random_uuid(),
  notice_id     uuid not null references eworks.tender_notices(id) on delete cascade,
  corrigendum_no int not null check (corrigendum_no > 0),
  summary       text not null check (length(trim(summary)) > 0),
  changes       jsonb not null default '{}'::jsonb,
  issued_by     uuid not null references eworks.user_profiles(id),
  issued_at     timestamptz not null default now(),
  unique (notice_id, corrigendum_no)
);

create table eworks.contractor_experience (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references eworks.contractors(id) on delete cascade,
  work_name     text not null check (length(trim(work_name)) > 0),
  client_name   text not null default '',
  value_paise   bigint not null check (value_paise > 0),
  completed_on  date,
  completion_doc_path text,
  created_at    timestamptz not null default now()
);

create table eworks.contractor_machinery (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references eworks.contractors(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  quantity      int not null check (quantity > 0),
  capacity      text not null default '',
  created_at    timestamptz not null default now()
);

create table eworks.contractor_engineers (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references eworks.contractors(id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  qualification text not null default '',
  role          text not null default '',
  created_at    timestamptz not null default now()
);

create index tender_notices_contract_idx on eworks.tender_notices (contract_id);
create index tender_notices_status_idx on eworks.tender_notices (status);
create index tender_criteria_notice_idx on eworks.tender_eligibility_criteria (notice_id);
create index tender_corrigenda_notice_idx on eworks.tender_corrigenda (notice_id);
create index contractor_experience_idx on eworks.contractor_experience (contractor_id);
create index contractor_machinery_idx on eworks.contractor_machinery (contractor_id);
create index contractor_engineers_idx on eworks.contractor_engineers (contractor_id);
```

- [ ] **Step 2: Add RLS** (append to the same file)

```sql
alter table eworks.sanctions enable row level security;
alter table eworks.tender_notices enable row level security;
alter table eworks.tender_eligibility_criteria enable row level security;
alter table eworks.tender_corrigenda enable row level security;
alter table eworks.contractor_experience enable row level security;
alter table eworks.contractor_machinery enable row level security;
alter table eworks.contractor_engineers enable row level security;

grant select, insert, update on eworks.sanctions to eworks_authenticated;
grant select, insert, update on eworks.tender_notices to eworks_authenticated;
grant select, insert, update, delete on eworks.tender_eligibility_criteria to eworks_authenticated;
grant select, insert on eworks.tender_corrigenda to eworks_authenticated;
grant select, insert, update, delete on eworks.contractor_experience to eworks_authenticated;
grant select, insert, update, delete on eworks.contractor_machinery to eworks_authenticated;
grant select, insert, update, delete on eworks.contractor_engineers to eworks_authenticated;

-- Management tables: in-scope contract.manage officers, via the parent contract's project path.
-- (Sanction insert also happens through record_sanction(); this policy lets the authoring view read.)
create policy sanctions_manage on eworks.sanctions for all to eworks_authenticated
  using (exists (select 1 from eworks.contracts ct join eworks.org_units ou on ou.id = ct.project_id
                  where ct.id = sanctions.contract_id and eworks.has_permission('contract.manage', ou.path)))
  with check (exists (select 1 from eworks.contracts ct join eworks.org_units ou on ou.id = ct.project_id
                       where ct.id = sanctions.contract_id and eworks.has_permission('contract.manage', ou.path)));

create policy tender_notices_manage on eworks.tender_notices for all to eworks_authenticated
  using (exists (select 1 from eworks.contracts ct join eworks.org_units ou on ou.id = ct.project_id
                  where ct.id = tender_notices.contract_id and eworks.has_permission('contract.manage', ou.path)))
  with check (exists (select 1 from eworks.contracts ct join eworks.org_units ou on ou.id = ct.project_id
                       where ct.id = tender_notices.contract_id and eworks.has_permission('contract.manage', ou.path)));

create policy tender_criteria_manage on eworks.tender_eligibility_criteria for all to eworks_authenticated
  using (exists (select 1 from eworks.tender_notices tn join eworks.contracts ct on ct.id = tn.contract_id
                  join eworks.org_units ou on ou.id = ct.project_id
                  where tn.id = tender_eligibility_criteria.notice_id and eworks.has_permission('contract.manage', ou.path)))
  with check (exists (select 1 from eworks.tender_notices tn join eworks.contracts ct on ct.id = tn.contract_id
                       join eworks.org_units ou on ou.id = ct.project_id
                       where tn.id = tender_eligibility_criteria.notice_id and eworks.has_permission('contract.manage', ou.path)));

create policy tender_corrigenda_read on eworks.tender_corrigenda for select to eworks_authenticated
  using (exists (select 1 from eworks.tender_notices tn join eworks.contracts ct on ct.id = tn.contract_id
                  join eworks.org_units ou on ou.id = ct.project_id
                  where tn.id = tender_corrigenda.notice_id and eworks.has_permission('contract.manage', ou.path)));
-- No INSERT policy: corrigenda are written only by issue_corrigendum() (security definer).

-- Contractor child tables: a contractor manages only its own rows; in-scope officers may read.
create policy contractor_experience_own on eworks.contractor_experience for all to eworks_authenticated
  using (exists (select 1 from eworks.contractors c where c.id = contractor_experience.contractor_id and c.owner_user_id = eworks.current_user_id()))
  with check (exists (select 1 from eworks.contractors c where c.id = contractor_experience.contractor_id and c.owner_user_id = eworks.current_user_id()));
create policy contractor_experience_officer_read on eworks.contractor_experience for select to eworks_authenticated
  using (exists (select 1 from eworks.contractors c join eworks.org_units ou on ou.id = c.org_unit_id
                  where c.id = contractor_experience.contractor_id and eworks.has_permission('contractor.read', ou.path)));
```
Repeat the two `contractor_experience_*` policies verbatim for `contractor_machinery` and `contractor_engineers` (same shape, swap the table name).

- [ ] **Step 3: Apply + verify**

Run:
```bash
docker exec -i eworks-pg psql -U postgres -d eworks < supabase/migrations/20260724000400_tender_notices.sql
docker exec eworks-pg psql -U postgres -d eworks -tAc "select count(*) from information_schema.tables where table_schema='eworks' and table_name in ('sanctions','tender_notices','tender_eligibility_criteria','tender_corrigenda','contractor_experience','contractor_machinery','contractor_engineers');"
```
Expected: no errors; count = `7`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260724000400_tender_notices.sql
git commit -m "feat(works-tender): P1 schema — notices, sanctions, criteria, corrigenda, contractor eligibility"
```

---

## Task 2: DB functions + guard triggers (the rules)

**Files:** Modify `supabase/migrations/20260724000400_tender_notices.sql` (append). Test: `web/server/tender.db.test.mjs` (created here).

**Interfaces produced:**
- `eworks.record_sanction(p_contract_id uuid, p_amount_paise bigint, p_order_no text) returns uuid`
- `eworks.publish_tender_notice(p_notice_id uuid) returns eworks.tender_notices`
- `eworks.issue_corrigendum(p_notice_id uuid, p_summary text, p_changes jsonb) returns eworks.tender_corrigenda`
- guard triggers enforcing sanction-before-publish and corrigendum-only-on-published.

- [ ] **Step 1: Write the failing DB test**

Create `web/server/tender.db.test.mjs`:
```js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
process.env.EWORKS_USE_LOCAL_PG = '1';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5433';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'eworks';

const probe = new pg.Pool({ host: process.env.PGHOST, port: Number(process.env.PGPORT),
  user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE,
  connectionTimeoutMillis: 1500, max: 2 });

let dbAvailable = false;
let officer = null;  // { userId } holding contract.manage over some DRAFT contract
let contract = null; // { id }
try {
  const fn = await probe.query(`select 1 from pg_proc where proname='publish_tender_notice'`);
  const c = await probe.query(`select id, project_id from eworks.contracts where status='DRAFT' limit 1`);
  contract = c.rows[0] ?? null;
  if (contract) {
    const o = await probe.query(
      `select ur.user_id as "userId" from eworks.user_roles ur
         join eworks.role_permissions rp on rp.role_code=ur.role_code
         join eworks.org_units ou on ou.id=ur.org_unit_id
         join eworks.org_units proj on proj.id=$1
        where rp.permission_code='contract.manage' and proj.path <@ ou.path limit 1`,
      [contract.project_id]);
    officer = o.rows[0] ?? null;
  }
  dbAvailable = fn.rowCount === 1 && Boolean(contract) && Boolean(officer);
} catch { dbAvailable = false; }

describe.skipIf(!dbAvailable)('tender rules', () => {
  let withUserSession, pool;
  beforeAll(async () => { ({ withUserSession, pool } = await import('./db.mjs')); });
  afterAll(async () => { await probe.end(); await pool.end(); });

  it('publish is blocked without a sanction, allowed after, and floats the contract', async () => {
    await withUserSession(officer.userId, async (client) => {
      // fresh notice on the DRAFT contract (clean any prior)
      await client.query(`delete from eworks.tender_notices where contract_id=$1`, [contract.id]);
      const n = await client.query(
        `insert into eworks.tender_notices (contract_id, notice_no, scope_summary, estimated_value_paise, completion_period_days, emd_amount_paise, created_by)
         values ($1,'NIT-TEST','scope',100000,90,5000, eworks.current_user_id()) returning id`, [contract.id]);
      const noticeId = n.rows[0].id;
      await client.query(`delete from eworks.sanctions where contract_id=$1`, [contract.id]);
      await expect(client.query(`select eworks.publish_tender_notice($1)`, [noticeId])).rejects.toThrow(/sanction/i);
      await client.query(`select eworks.record_sanction($1, 120000, 'GO-1')`, [contract.id]);
      await client.query(`select eworks.publish_tender_notice($1)`, [noticeId]);
      const st = await client.query(`select status from eworks.tender_notices where id=$1`, [noticeId]);
      expect(st.rows[0].status).toBe('PUBLISHED');
      const cs = await client.query(`select status from eworks.contracts where id=$1`, [contract.id]);
      expect(cs.rows[0].status).toBe('FLOATED');
      // corrigendum now allowed + auto-numbers
      const cg = await client.query(`select (eworks.issue_corrigendum($1,'extend dates','{}'::jsonb)).corrigendum_no as n`, [noticeId]);
      expect(cg.rows[0].n).toBe(1);
    });
  }, 15000);
});
```

- [ ] **Step 2: Run — verify it FAILS** (functions not created yet)

Run: `cd web && npx vitest run server/tender.db.test.mjs`
Expected: FAIL (function `publish_tender_notice` does not exist) — or SKIP if local DB down (`docker start eworks-pg`).

- [ ] **Step 3: Implement the functions + triggers** (append to the migration)

```sql
-- Sanction: only a contract.manage officer in scope; append audit.
create or replace function eworks.record_sanction(p_contract_id uuid, p_amount_paise bigint, p_order_no text)
returns uuid language plpgsql security definer set search_path = eworks, public, extensions, pg_temp as $$
declare v_path ltree; v_id uuid;
begin
  select ou.path into v_path from eworks.contracts ct join eworks.org_units ou on ou.id=ct.project_id where ct.id=p_contract_id;
  if v_path is null then raise exception 'contract % not found', p_contract_id; end if;
  if not eworks.has_permission('contract.manage', v_path) then raise exception 'not authorized to sanction'; end if;
  insert into eworks.sanctions (contract_id, sanctioned_amount_paise, order_no, sanctioned_by)
  values (p_contract_id, p_amount_paise, p_order_no, eworks.current_user_id())
  on conflict (contract_id) do update set sanctioned_amount_paise=excluded.sanctioned_amount_paise,
    order_no=excluded.order_no, sanctioned_by=excluded.sanctioned_by, sanctioned_at=now()
  returning id into v_id;
  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'tender.sanction', 'contract', p_contract_id, v_path,
          jsonb_build_object('amount_paise', p_amount_paise, 'order_no', p_order_no));
  return v_id;
end; $$;

-- Guard: no notice may reach PUBLISHED without a sanction (unbypassable).
create or replace function eworks.tender_notice_publish_guard()
returns trigger language plpgsql as $$
begin
  if new.status='PUBLISHED' and old.status is distinct from 'PUBLISHED' then
    if not exists (select 1 from eworks.sanctions s where s.contract_id=new.contract_id) then
      raise exception 'a sanction is required before publishing the tender notice';
    end if;
    if new.published_at is null then new.published_at := now(); end if;
  end if;
  return new;
end; $$;
create trigger tender_notice_publish_trg before update on eworks.tender_notices
  for each row execute function eworks.tender_notice_publish_guard();

-- Publish: controlled path — permission check, set PUBLISHED (guard fires), float the contract, audit.
create or replace function eworks.publish_tender_notice(p_notice_id uuid)
returns eworks.tender_notices language plpgsql security definer set search_path = eworks, public, extensions, pg_temp as $$
declare v_notice eworks.tender_notices; v_path ltree;
begin
  select ou.path into v_path from eworks.tender_notices tn join eworks.contracts ct on ct.id=tn.contract_id
    join eworks.org_units ou on ou.id=ct.project_id where tn.id=p_notice_id;
  if v_path is null then raise exception 'notice % not found', p_notice_id; end if;
  if not eworks.has_permission('contract.manage', v_path) then raise exception 'not authorized to publish'; end if;
  update eworks.tender_notices set status='PUBLISHED', published_by=eworks.current_user_id(), published_at=now()
    where id=p_notice_id returning * into v_notice;
  update eworks.contracts set status='FLOATED' where id=v_notice.contract_id and status='DRAFT';
  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'tender.publish', 'tender_notice', p_notice_id, v_path,
          jsonb_build_object('contract_id', v_notice.contract_id, 'notice_no', v_notice.notice_no));
  return v_notice;
end; $$;

-- Corrigendum guard: only on a PUBLISHED notice (unbypassable).
create or replace function eworks.tender_corrigendum_guard()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from eworks.tender_notices tn where tn.id=new.notice_id and tn.status='PUBLISHED') then
    raise exception 'corrigenda may be issued only on a published notice';
  end if;
  return new;
end; $$;
create trigger tender_corrigendum_trg before insert on eworks.tender_corrigenda
  for each row execute function eworks.tender_corrigendum_guard();

-- Issue corrigendum: controlled path — permission, auto-number, apply changes, audit.
create or replace function eworks.issue_corrigendum(p_notice_id uuid, p_summary text, p_changes jsonb)
returns eworks.tender_corrigenda language plpgsql security definer set search_path = eworks, public, extensions, pg_temp as $$
declare v_row eworks.tender_corrigenda; v_path ltree; v_next int;
begin
  select ou.path into v_path from eworks.tender_notices tn join eworks.contracts ct on ct.id=tn.contract_id
    join eworks.org_units ou on ou.id=ct.project_id where tn.id=p_notice_id;
  if v_path is null then raise exception 'notice % not found', p_notice_id; end if;
  if not eworks.has_permission('contract.manage', v_path) then raise exception 'not authorized'; end if;
  select coalesce(max(corrigendum_no),0)+1 into v_next from eworks.tender_corrigenda where notice_id=p_notice_id;
  insert into eworks.tender_corrigenda (notice_id, corrigendum_no, summary, changes, issued_by)
  values (p_notice_id, v_next, p_summary, coalesce(p_changes,'{}'::jsonb), eworks.current_user_id())
  returning * into v_row;
  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'tender.corrigendum', 'tender_notice', p_notice_id, v_path,
          jsonb_build_object('corrigendum_no', v_next, 'summary', p_summary));
  return v_row;
end; $$;

revoke all on function eworks.record_sanction(uuid,bigint,text) from public;
revoke all on function eworks.publish_tender_notice(uuid) from public;
revoke all on function eworks.issue_corrigendum(uuid,text,jsonb) from public;
grant execute on function eworks.record_sanction(uuid,bigint,text) to eworks_authenticated;
grant execute on function eworks.publish_tender_notice(uuid) to eworks_authenticated;
grant execute on function eworks.issue_corrigendum(uuid,text,jsonb) to eworks_authenticated;
```

- [ ] **Step 4: Apply the appended DDL + run test → PASS**

Run:
```bash
docker exec -i eworks-pg psql -U postgres -d eworks < supabase/migrations/20260724000400_tender_notices.sql
cd web && npx vitest run server/tender.db.test.mjs
```
Expected: migration re-applies cleanly (the `create or replace`/`create trigger` — drop the two triggers first if re-running: `drop trigger if exists`); test PASSES.
> Note: because the file is applied twice during dev, prefix the two `create trigger` statements with `drop trigger if exists tender_notice_publish_trg on eworks.tender_notices;` / `drop trigger if exists tender_corrigendum_trg on eworks.tender_corrigenda;`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260724000400_tender_notices.sql web/server/tender.db.test.mjs
git commit -m "feat(works-tender): P1 rules — sanction/publish/corrigendum functions + guard triggers"
```

---

## Task 3: Query module (gov authoring + public board) + public-safety test

**Files:** Create `web/server/tender-queries.mjs`. Modify `web/server/tender.db.test.mjs` (extend).

**Interfaces produced:**
- `govTenderView(client, contractId)` → `{ contract, sanction, notice, criteria, corrigenda }`
- `publicTenderBoard(pool)` → `[{ noticeId, noticeNo, contractCode, title, scopeSummary, estimatedValuePaise, emdAmountPaise, submissionCloseAt, technicalOpeningAt }]` (PUBLISHED only)
- `publicTenderDetail(pool, noticeId)` → `{ …notice public fields, criteria, corrigenda }` or `null`
- `contractorEligibility(client)` → `{ experience, machinery, engineers }` (own rows)

- [ ] **Step 1: Write the failing public-safety test** (append to `tender.db.test.mjs`)

```js
import { publicTenderBoard } from './tender-queries.mjs';
describe.skipIf(!dbAvailable)('public tender safety', () => {
  let pool;
  beforeAll(async () => { ({ pool } = await import('./db.mjs')); });
  it('the public board returns only PUBLISHED notices, never DRAFT/CANCELLED', async () => {
    const rows = await publicTenderBoard(pool);
    for (const r of rows) {
      const s = await pool.query(`select status from eworks.tender_notices where id=$1`, [r.noticeId]);
      expect(s.rows[0].status).toBe('PUBLISHED');
    }
  });
});
```

- [ ] **Step 2: Run → FAIL** (module missing). `cd web && npx vitest run server/tender.db.test.mjs` → FAIL.

- [ ] **Step 3: Implement `tender-queries.mjs`**

```js
// Tender queries. Authenticated views take a `client` (RLS applies). Public
// board/detail take the raw `pool` and hard-filter to PUBLISHED + public columns.
const n = (v) => (v == null ? null : Number(v));

export async function govTenderView(client, contractId) {
  const c = await client.query(`select id, code, title, value_paise as "valuePaise", status, project_id as "projectId" from eworks.contracts where id=$1`, [contractId]);
  if (c.rowCount === 0) return null;
  const s = await client.query(`select sanctioned_amount_paise as "amountPaise", order_no as "orderNo", sanctioned_at as "sanctionedAt" from eworks.sanctions where contract_id=$1`, [contractId]);
  const tn = await client.query(`select * from eworks.tender_notices where contract_id=$1`, [contractId]);
  const notice = tn.rows[0] ?? null;
  let criteria = [], corrigenda = [];
  if (notice) {
    criteria = (await client.query(`select id, seq, label, description, kind from eworks.tender_eligibility_criteria where notice_id=$1 order by seq`, [notice.id])).rows;
    corrigenda = (await client.query(`select corrigendum_no as "corrigendumNo", summary, issued_at as "issuedAt" from eworks.tender_corrigenda where notice_id=$1 order by corrigendum_no`, [notice.id])).rows;
  }
  return {
    contract: { id: c.rows[0].id, code: c.rows[0].code, title: c.rows[0].title, valuePaise: n(c.rows[0].valuePaise), status: c.rows[0].status },
    sanction: s.rows[0] ? { amountPaise: n(s.rows[0].amountPaise), orderNo: s.rows[0].orderNo, sanctionedAt: s.rows[0].sanctionedAt } : null,
    notice: notice ? shapeNotice(notice) : null,
    criteria, corrigenda: corrigenda.map((r) => ({ ...r, corrigendumNo: Number(r.corrigendumNo) })),
  };
}

function shapeNotice(row) {
  return {
    id: row.id, contractId: row.contract_id, noticeNo: row.notice_no, scopeSummary: row.scope_summary,
    estimatedValuePaise: n(row.estimated_value_paise), completionPeriodDays: row.completion_period_days,
    emdAmountPaise: n(row.emd_amount_paise), publishAt: row.publish_at, queryDeadlineAt: row.query_deadline_at,
    submissionCloseAt: row.submission_close_at, technicalOpeningAt: row.technical_opening_at,
    financialOpeningAt: row.financial_opening_at, status: row.status, publishedAt: row.published_at,
  };
}

export async function publicTenderBoard(pool) {
  const q = await pool.query(`
    select tn.id as "noticeId", tn.notice_no as "noticeNo", ct.code as "contractCode", ct.title,
           tn.scope_summary as "scopeSummary", tn.estimated_value_paise as "estimatedValuePaise",
           tn.emd_amount_paise as "emdAmountPaise", tn.submission_close_at as "submissionCloseAt",
           tn.technical_opening_at as "technicalOpeningAt"
      from eworks.tender_notices tn join eworks.contracts ct on ct.id=tn.contract_id
     where tn.status='PUBLISHED'
     order by tn.submission_close_at asc nulls last, tn.published_at desc`);
  return q.rows.map((r) => ({ ...r, estimatedValuePaise: n(r.estimatedValuePaise), emdAmountPaise: n(r.emdAmountPaise) }));
}

export async function publicTenderDetail(pool, noticeId) {
  const tn = await pool.query(`
    select tn.id, tn.notice_no as "noticeNo", ct.code as "contractCode", ct.title, tn.scope_summary as "scopeSummary",
           tn.estimated_value_paise as "estimatedValuePaise", tn.completion_period_days as "completionPeriodDays",
           tn.emd_amount_paise as "emdAmountPaise", tn.publish_at as "publishAt", tn.query_deadline_at as "queryDeadlineAt",
           tn.submission_close_at as "submissionCloseAt", tn.technical_opening_at as "technicalOpeningAt",
           tn.financial_opening_at as "financialOpeningAt"
      from eworks.tender_notices tn join eworks.contracts ct on ct.id=tn.contract_id
     where tn.id=$1 and tn.status='PUBLISHED'`, [noticeId]);
  if (tn.rowCount === 0) return null;
  const criteria = (await pool.query(`select seq, label, description, kind from eworks.tender_eligibility_criteria where notice_id=$1 order by seq`, [noticeId])).rows;
  const corrigenda = (await pool.query(`select corrigendum_no as "corrigendumNo", summary, issued_at as "issuedAt" from eworks.tender_corrigenda where notice_id=$1 order by corrigendum_no`, [noticeId])).rows;
  const r = tn.rows[0];
  return { ...r, estimatedValuePaise: n(r.estimatedValuePaise), emdAmountPaise: n(r.emdAmountPaise),
    criteria, corrigenda: corrigenda.map((c) => ({ ...c, corrigendumNo: Number(c.corrigendumNo) })) };
}

export async function contractorEligibility(client) {
  const own = `join eworks.contractors c on c.id = t.contractor_id and c.owner_user_id = eworks.current_user_id()`;
  const experience = (await client.query(`select t.id, t.work_name as "workName", t.client_name as "clientName", t.value_paise as "valuePaise", t.completed_on as "completedOn" from eworks.contractor_experience t ${own} order by t.created_at desc`)).rows.map((r) => ({ ...r, valuePaise: n(r.valuePaise) }));
  const machinery = (await client.query(`select t.id, t.name, t.quantity, t.capacity from eworks.contractor_machinery t ${own} order by t.created_at desc`)).rows;
  const engineers = (await client.query(`select t.id, t.name, t.qualification, t.role from eworks.contractor_engineers t ${own} order by t.created_at desc`)).rows;
  return { experience, machinery, engineers };
}
```

- [ ] **Step 4: Run → PASS.** `cd web && npx vitest run server/tender.db.test.mjs` → all pass.

- [ ] **Step 5: Commit**
```bash
git add web/server/tender-queries.mjs web/server/tender.db.test.mjs
git commit -m "feat(works-tender): P1 tender query module + public-safety test"
```

---

## Task 4: Gov authoring endpoints

**Files:** Modify `web/server/bff.mjs` (import + endpoints). Test: covered by Task 2's DB test (functions) + a `node --check`.

**Interfaces produced:** `GET /api/gov/tenders/:contractId`; `POST …/sanction`; `POST …/notice` (upsert draft + criteria); `POST …/notice/publish`; `POST …/notice/corrigendum`.

- [ ] **Step 1: Add the import** near the other server-module imports in `bff.mjs`:
```js
import { govTenderView, publicTenderBoard, publicTenderDetail, contractorEligibility } from './tender-queries.mjs';
```

- [ ] **Step 2: Register the gov endpoints** (next to other `/api/gov/*` routes). Full code:
```js
  app.get('/api/gov/tenders/:contractId', async (req, res) => {
    const userId = requireUser(req, res); if (!userId) return;
    try {
      const payload = await withUserSession(userId, (c) => govTenderView(c, req.params.contractId));
      if (!payload) return res.status(404).json({ error: 'not_found' });
      res.json(payload);
    } catch (err) { res.status(500).json({ error: 'query_failed', detail: err.message }); }
  });

  app.post('/api/gov/tenders/:contractId/sanction', async (req, res) => {
    const userId = requireUser(req, res); if (!userId) return;
    const { amountPaise, orderNo } = req.body || {};
    if (!Number.isFinite(Number(amountPaise)) || Number(amountPaise) <= 0 || !orderNo) return res.status(400).json({ error: 'bad_sanction' });
    try {
      await withUserSession(userId, (c) => c.query(`select eworks.record_sanction($1,$2,$3)`, [req.params.contractId, Number(amountPaise), String(orderNo)]));
      res.json(await withUserSession(userId, (c) => govTenderView(c, req.params.contractId)));
    } catch (err) { res.status(400).json({ error: 'sanction_failed', detail: err.message }); }
  });

  app.post('/api/gov/tenders/:contractId/notice', async (req, res) => {
    const userId = requireUser(req, res); if (!userId) return;
    const b = req.body || {};
    try {
      await withUserSession(userId, async (c) => {
        const up = await c.query(`
          insert into eworks.tender_notices (contract_id, notice_no, scope_summary, estimated_value_paise,
            completion_period_days, emd_amount_paise, publish_at, query_deadline_at, submission_close_at,
            technical_opening_at, financial_opening_at, created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, eworks.current_user_id())
          on conflict (contract_id) do update set notice_no=excluded.notice_no, scope_summary=excluded.scope_summary,
            estimated_value_paise=excluded.estimated_value_paise, completion_period_days=excluded.completion_period_days,
            emd_amount_paise=excluded.emd_amount_paise, publish_at=excluded.publish_at, query_deadline_at=excluded.query_deadline_at,
            submission_close_at=excluded.submission_close_at, technical_opening_at=excluded.technical_opening_at,
            financial_opening_at=excluded.financial_opening_at
          where eworks.tender_notices.status='DRAFT'
          returning id`,
          [req.params.contractId, b.noticeNo, b.scopeSummary, Number(b.estimatedValuePaise), Number(b.completionPeriodDays),
           Number(b.emdAmountPaise ?? 0), b.publishAt || null, b.queryDeadlineAt || null, b.submissionCloseAt || null,
           b.technicalOpeningAt || null, b.financialOpeningAt || null]);
        const noticeId = up.rows[0]?.id;
        if (noticeId && Array.isArray(b.criteria)) {
          await c.query(`delete from eworks.tender_eligibility_criteria where notice_id=$1`, [noticeId]);
          for (let i = 0; i < b.criteria.length; i += 1) {
            const cr = b.criteria[i];
            await c.query(`insert into eworks.tender_eligibility_criteria (notice_id, seq, label, description, kind) values ($1,$2,$3,$4,$5)`,
              [noticeId, i, cr.label, cr.description ?? '', cr.kind ?? 'general']);
          }
        }
      });
      res.json(await withUserSession(userId, (c) => govTenderView(c, req.params.contractId)));
    } catch (err) { res.status(400).json({ error: 'notice_failed', detail: err.message }); }
  });

  app.post('/api/gov/tenders/:contractId/notice/publish', async (req, res) => {
    const userId = requireUser(req, res); if (!userId) return;
    try {
      await withUserSession(userId, async (c) => {
        const tn = await c.query(`select id from eworks.tender_notices where contract_id=$1`, [req.params.contractId]);
        if (tn.rowCount === 0) throw new Error('no notice to publish');
        await c.query(`select eworks.publish_tender_notice($1)`, [tn.rows[0].id]);
      });
      res.json(await withUserSession(userId, (c) => govTenderView(c, req.params.contractId)));
    } catch (err) { res.status(400).json({ error: 'publish_failed', detail: err.message }); }
  });

  app.post('/api/gov/tenders/:contractId/notice/corrigendum', async (req, res) => {
    const userId = requireUser(req, res); if (!userId) return;
    const { summary, changes } = req.body || {};
    if (!summary) return res.status(400).json({ error: 'summary_required' });
    try {
      await withUserSession(userId, async (c) => {
        const tn = await c.query(`select id from eworks.tender_notices where contract_id=$1`, [req.params.contractId]);
        if (tn.rowCount === 0) throw new Error('no notice');
        // apply amended fields (if provided) then record the corrigendum
        if (changes && typeof changes === 'object') {
          const map = { submissionCloseAt: 'submission_close_at', technicalOpeningAt: 'technical_opening_at', financialOpeningAt: 'financial_opening_at', scopeSummary: 'scope_summary' };
          for (const [k, col] of Object.entries(map)) if (k in changes) await c.query(`update eworks.tender_notices set ${col}=$2 where id=$1`, [tn.rows[0].id, changes[k]]);
        }
        await c.query(`select eworks.issue_corrigendum($1,$2,$3::jsonb)`, [tn.rows[0].id, String(summary), JSON.stringify(changes ?? {})]);
      });
      res.json(await withUserSession(userId, (c) => govTenderView(c, req.params.contractId)));
    } catch (err) { res.status(400).json({ error: 'corrigendum_failed', detail: err.message }); }
  });
```

- [ ] **Step 3: Verify parse + tsc.** `cd web && node --check server/bff.mjs && npx tsc -b` → clean.

- [ ] **Step 4: Commit**
```bash
git add web/server/bff.mjs
git commit -m "feat(works-tender): P1 gov tender authoring endpoints"
```

---

## Task 5: Public tender endpoints

**Files:** Modify `web/server/bff.mjs`. Test: `tender.db.test.mjs` already covers the query; add a `node --check`.

**Interfaces produced:** `GET /api/public/tenders`, `GET /api/public/tenders/:noticeId` (no auth).

- [ ] **Step 1: Register** (next to `/api/public/certificates`):
```js
  app.get('/api/public/tenders', async (_req, res) => {
    try { res.json(await publicTenderBoard(pool)); }
    catch (err) { res.status(500).json({ error: 'query_failed', detail: err.message }); }
  });
  app.get('/api/public/tenders/:noticeId', async (req, res) => {
    try {
      const row = await publicTenderDetail(pool, req.params.noticeId);
      if (!row) return res.json({ found: false });
      res.json({ found: true, ...row });
    } catch (err) { res.status(500).json({ error: 'query_failed', detail: err.message }); }
  });
```
(`pool` is already imported from `./db.mjs`.)

- [ ] **Step 2: Verify.** `cd web && node --check server/bff.mjs` → clean.

- [ ] **Step 3: Commit**
```bash
git add web/server/bff.mjs
git commit -m "feat(works-tender): P1 public tender board + detail endpoints"
```

---

## Task 6: Contractor eligibility endpoints

**Files:** Modify `web/server/bff.mjs`. Test: `node --check`.

**Interfaces produced:** `GET /api/contractor/eligibility`; `POST/DELETE /api/contractor/eligibility/{experience,machinery,engineers}`.

- [ ] **Step 1: Register** (next to the other `/api/contractor/*` routes). Full code:
```js
  app.get('/api/contractor/eligibility', async (req, res) => {
    const userId = requireUser(req, res); if (!userId) return;
    try { res.json(await withUserSession(userId, (c) => contractorEligibility(c))); }
    catch (err) { res.status(500).json({ error: 'query_failed', detail: err.message }); }
  });

  async function ownContractorId(client) {
    const q = await client.query(`select id from eworks.contractors where owner_user_id = eworks.current_user_id()`);
    if (q.rowCount === 0) throw new Error('no contractor profile');
    return q.rows[0].id;
  }

  app.post('/api/contractor/eligibility/experience', async (req, res) => {
    const userId = requireUser(req, res); if (!userId) return;
    const { workName, clientName, valuePaise, completedOn } = req.body || {};
    if (!workName || !Number.isFinite(Number(valuePaise)) || Number(valuePaise) <= 0) return res.status(400).json({ error: 'bad_experience' });
    try {
      await withUserSession(userId, async (c) => {
        const cid = await ownContractorId(c);
        await c.query(`insert into eworks.contractor_experience (contractor_id, work_name, client_name, value_paise, completed_on) values ($1,$2,$3,$4,$5)`,
          [cid, workName, clientName ?? '', Number(valuePaise), completedOn || null]);
      });
      res.json(await withUserSession(userId, (c) => contractorEligibility(c)));
    } catch (err) { res.status(400).json({ error: 'save_failed', detail: err.message }); }
  });

  app.post('/api/contractor/eligibility/machinery', async (req, res) => {
    const userId = requireUser(req, res); if (!userId) return;
    const { name, quantity, capacity } = req.body || {};
    if (!name || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0) return res.status(400).json({ error: 'bad_machinery' });
    try {
      await withUserSession(userId, async (c) => {
        const cid = await ownContractorId(c);
        await c.query(`insert into eworks.contractor_machinery (contractor_id, name, quantity, capacity) values ($1,$2,$3,$4)`, [cid, name, Number(quantity), capacity ?? '']);
      });
      res.json(await withUserSession(userId, (c) => contractorEligibility(c)));
    } catch (err) { res.status(400).json({ error: 'save_failed', detail: err.message }); }
  });

  app.post('/api/contractor/eligibility/engineers', async (req, res) => {
    const userId = requireUser(req, res); if (!userId) return;
    const { name, qualification, role } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name_required' });
    try {
      await withUserSession(userId, async (c) => {
        const cid = await ownContractorId(c);
        await c.query(`insert into eworks.contractor_engineers (contractor_id, name, qualification, role) values ($1,$2,$3,$4)`, [cid, name, qualification ?? '', role ?? '']);
      });
      res.json(await withUserSession(userId, (c) => contractorEligibility(c)));
    } catch (err) { res.status(400).json({ error: 'save_failed', detail: err.message }); }
  });

  app.delete('/api/contractor/eligibility/:kind/:id', async (req, res) => {
    const userId = requireUser(req, res); if (!userId) return;
    const table = { experience: 'contractor_experience', machinery: 'contractor_machinery', engineers: 'contractor_engineers' }[req.params.kind];
    if (!table) return res.status(400).json({ error: 'bad_kind' });
    try {
      await withUserSession(userId, (c) => c.query(`delete from eworks.${table} where id=$1`, [req.params.id])); // RLS ensures own-row only
      res.json(await withUserSession(userId, (c) => contractorEligibility(c)));
    } catch (err) { res.status(400).json({ error: 'delete_failed', detail: err.message }); }
  });
```

- [ ] **Step 2: Verify.** `cd web && node --check server/bff.mjs && npx tsc -b` → clean.

- [ ] **Step 3: Commit**
```bash
git add web/server/bff.mjs
git commit -m "feat(works-tender): P1 contractor eligibility endpoints"
```

---

## Task 7: Client types, API, hooks + tenderModel

**Files:** Modify `web/src/types/domain.ts`. Create the three `*Api.ts` + `use*.ts` files and `tenderModel.ts` (+ test) named in the File Structure.

**Interfaces produced:** DTO types; `useGovTender(contractId)` + sanction/notice/publish/corrigendum mutations; `usePublicTenders()` / `usePublicTender(id)`; `useEligibility()` + add/delete mutations; `tenderModel.tenderWindow(notice)` + `formatCountdown`.

- [ ] **Step 1: Write the tenderModel test** — Create `web/src/features/public/tenders/tenderModel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { tenderWindow } from './tenderModel';
describe('tenderWindow', () => {
  it('is open well before close, closing-soon within 48h, closed after', () => {
    const now = new Date('2026-08-01T00:00:00Z').getTime();
    expect(tenderWindow('2026-08-10T00:00:00Z', now)).toBe('open');
    expect(tenderWindow('2026-08-02T00:00:00Z', now)).toBe('closing_soon');
    expect(tenderWindow('2026-07-31T00:00:00Z', now)).toBe('closed');
    expect(tenderWindow(null, now)).toBe('open');
  });
});
```
- [ ] **Step 2: Run → FAIL.** `cd web && npx vitest run src/features/public/tenders/tenderModel.test.ts` → FAIL.
- [ ] **Step 3: Implement `tenderModel.ts`:**
```ts
export type TenderWindow = 'open' | 'closing_soon' | 'closed';
export function tenderWindow(submissionCloseAt: string | null, nowMs: number): TenderWindow {
  if (!submissionCloseAt) return 'open';
  const close = new Date(submissionCloseAt).getTime();
  if (nowMs >= close) return 'closed';
  if (close - nowMs <= 48 * 3600 * 1000) return 'closing_soon';
  return 'open';
}
```
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Add DTO types** to `web/src/types/domain.ts` (mirror the query-module shapes): `TenderNoticeDetailPublic`, `TenderBoardRow`, `GovTenderView` (`{ contract, sanction, notice, criteria, corrigenda }`), `ContractorEligibility` (`{ experience, machinery, engineers }`) with the exact field names the server returns.
- [ ] **Step 6: Create the api + hooks** following `web/src/features/contractor/api.ts` + `useContractor.ts` patterns verbatim (apiClient.get/post/delete; query keys; useQuery/useMutation with `invalidateQueries`). `publicTenderApi` uses `apiClient.get` on `/api/public/tenders`. Gov mutations POST to the Task-4 routes and invalidate `['gov','tender',contractId]`.
- [ ] **Step 7: `npx tsc -b` → 0. Commit** `git commit -m "feat(works-tender): P1 client types, api, hooks, tenderModel"`.

---

## Task 8: Nav + routes + gov Tender wizard

**Files:** Modify `web/src/App.tsx`, `web/src/lib/navConfig.ts`, `web/src/i18n/{en,ta}.json`. Create the gov wizard components + the public/contractor route targets (stubs filled in Tasks 9–10 to keep tsc green).

- [ ] **Step 1: Nav** — in `navConfig.ts`, add to `GOV_ALL`: `{ to: '/gov/tenders', labelKey: 'tender.nav', navKey: 'tenders', requiresPermission: 'contract.manage' }`; add to `CONTRACTOR_NAV`: `{ to: '/contractor/eligibility', labelKey: 'eligibility.nav' }`.
- [ ] **Step 2: Routes** — in `App.tsx`: public (under `AppShell`, beside `/verify`): `<Route path="/tenders" element={<TenderBoardPage/>}/>` + `<Route path="/tenders/:noticeId" element={<TenderDetailPage/>}/>`; gov (under GovLayout): `<Route path="tenders" element={<TenderWizardPage/>}/>` + `<Route path="tenders/:contractId" element={<TenderWizardPage/>}/>`; contractor (under ContractorLayout): `<Route path="eligibility" element={<EligibilityPage/>}/>`. Add imports. Create `TenderBoardPage`/`TenderDetailPage`/`EligibilityPage` as `null`-returning stubs for now (Tasks 9–10 replace them).
- [ ] **Step 3: i18n** — add a `tender.*` block (nav, wizard step labels, notice fields, publish, corrigendum, board, detail, window states) and an `eligibility.*` block to BOTH `en.json` and `ta.json` (identical key sets).
- [ ] **Step 4: Build `TenderWizardPage` + `SanctionStep` + `NoticeStep` + `CorrigendumDialog`** — a contract picker (list DRAFT contracts the officer manages — reuse a contracts fetch) → sanction form (amount, order no) → notice form (fields + add/remove criteria rows) → Publish button (disabled with a "sanction required" hint until `view.sanction` is present); a published notice shows a Corrigendum action. Use `useGovTender`/mutations; gov-card + existing form styling; money via `formatInr` (rupees→paise on submit).
- [ ] **Step 5: `npx tsc -b` → 0. Commit** `git commit -m "feat(works-tender): P1 nav, routes, gov tender wizard"`.

---

## Task 9: Public tender board + detail screens

**Files:** Replace `TenderBoardPage.tsx` / `TenderDetailPage.tsx` stubs; create `usePublicTenders`.

- [ ] **Step 1: `TenderBoardPage`** — `usePublicTenders()`; render responsive gov-cards of open tenders, each showing title, notice no, estimated value (`formatInr`), EMD, and a **countdown** to `submissionCloseAt` with a `tenderWindow`-driven badge (open / closing-soon / closed); link each to `/tenders/:noticeId`. No layout/login (it renders under `AppShell`); include a simple public header.
- [ ] **Step 2: `TenderDetailPage`** — `usePublicTender(noticeId)`; show scope, estimated value, EMD, all key dates, the eligibility criteria list, and corrigendum history; a "not found" state when `found:false`.
- [ ] **Step 3: `npx tsc -b` → 0. Commit** `git commit -m "feat(works-tender): P1 public tender board + detail"`.

---

## Task 10: Contractor eligibility profile screen

**Files:** Replace `EligibilityPage.tsx` stub; create `useEligibility`.

- [ ] **Step 1: `EligibilityPage`** — three sections (Experience, Machinery, Engineers), each a table of the contractor's own rows + an inline add form + a delete action, via `useEligibility()` and the add/delete mutations. Experience amounts via `formatInr`. gov-card + existing contractor form styling.
- [ ] **Step 2: `npx tsc -b` → 0. Commit** `git commit -m "feat(works-tender): P1 contractor eligibility profile"`.

---

## Task 11: Seed, flow test, full verification

**Files:** Modify `web/server/seed-contracts.mjs` (ensure a DRAFT contract exists for the flow); extend `tender.db.test.mjs` with the end-to-end flow test.

- [ ] **Step 1: Seed** — ensure `seed-contracts.mjs` leaves at least one `DRAFT` contract anchored to a PROJECT unit an officer manages (the Task-2 test already relies on one; make it deterministic).
- [ ] **Step 2: Flow test** (append to `tender.db.test.mjs`): as the officer — create a notice on a DRAFT contract, add 3 criteria, `record_sanction`, `publish_tender_notice`; then assert `publicTenderBoard(pool)` includes the notice with its criteria via `publicTenderDetail`, and that `select count(*) from eworks.audit_logs where action in ('tender.sanction','tender.publish')` increased.
- [ ] **Step 3: Full verification.** Run from `web/`: `EWORKS_USE_LOCAL_PG=1 npx vitest run` (report pass/fail; note any pre-existing unrelated failures), `npx tsc -b` (0), `npm run lint` (no new errors), and the i18n parity check `node -e "const en=require('./src/i18n/en.json').tender,ta=require('./src/i18n/ta.json').tender;console.log(Object.keys(en).every(k=>k in ta)?'ok':'MISSING')"` (and same for `eligibility`).
- [ ] **Step 4: Manual demo** (controller does the browser/HTTP smoke — not the implementer): restart BFF, officer runs the wizard → tender appears on the public `/tenders` board with a countdown → corrigendum updates a date → contractor adds an experience row.
- [ ] **Step 5: Commit** `git commit -m "test(works-tender): P1 seed + end-to-end flow test + verification"`.

---

## Self-Review

**Spec coverage:** sanctions (A2) → Task 1/2/4. tender_notices + dates + criteria (B1) → Task 1/4. corrigenda (B3) → Task 1/2/4. public board (B2) → Task 3/5/9. contractor experience/machinery/engineers (C2/C3) → Task 1/6/10. Rules 1–4 → Task 2 (functions + guard triggers + explicit audit). Public-safety → Task 3. i18n/tests/DoD → Task 8/11. ✅

**Placeholder scan:** no TBD/TODO; DB/endpoint code is complete; frontend Tasks 8–10 give component-level specs with the exact hooks/props and reuse named existing patterns (acceptable — they mirror `ContractorRegistration`/`ContractsPage` verbatim). Where a task says "mirror X," X is a concrete cited file.

**Type/name consistency:** query-module field names (`noticeNo`, `estimatedValuePaise`, `submissionCloseAt`, `contractCode`, …) are the DTO names in Task 7 and the props in Tasks 8–10. `tenderWindow` signature is identical in the test and impl.

**Known verify-time checks flagged:** the migration is applied twice in dev (drop-if-exists on the two triggers); `contractors.org_unit_id` is DISTRICT-level (used by the officer-read policy join) — confirmed in the audit. RLS `for all` on notices means a raw UPDATE could set PUBLISHED, which is why the sanction rule is *also* a trigger (unbypassable), not only in the function.
