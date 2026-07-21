# Admin Settings Module (`/gov/admin`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give head admins one place to manage users, roles, permissions, settings, and the test catalog — Part B of the simplify-flows spec — with every mutation RLS-gated and audit-logged.

**Architecture:** One additive migration opens the three write paths RLS genuinely lacks (`user_profiles` insert, `roles`/`role_permissions`, `settings`); everything else (`user_roles`, `test_catalog`, `test_stage_rules`) already has admin write policies. New `/api/admin/*` routes in `web/server/bff.mjs` run entirely inside `withUserSession` so RLS is the real gate; the BFF only pre-checks permissions to turn silent RLS denials into clear 403s, and appends `eworks.audit_logs` rows in the same transaction. Frontend is a new `features/admin/` module: one `/gov/admin` route with four permission-gated tabs following the existing react-query + `gov-card` patterns.

**Tech Stack:** Postgres RLS (ltree scopes, `eworks.has_permission*`), Express BFF (plain .mjs), React 19 + react-router 7 + @tanstack/react-query 5 + i18next, vitest.

## Global Constraints

- **Simplify the screens, never the security.** RLS, sealed bids, audit chain, geofencing untouched.
- All DB access inside `withUserSession(userId, fn)` — never the service-role/superuser pool for user actions.
- Every mutation appends to `eworks.audit_logs` (actor, action, entity, before/after payload) **in the same transaction** as the write, using the exact insert shape at `web/server/bff.mjs:2148`.
- Every new UI string exists in BOTH `web/src/i18n/en.json` and `ta.json` (34 existing namespaces stay untouched; add one `admin` namespace).
- Role codes and test codes are immutable once created; there are deliberately **no** rename/delete endpoints for them.
- Permission counts are dynamic: the seed has 14 permissions + 8 from contracts (22 today). Never hard-code "13".
- New migration must be **additive only**: `20260717000100_admin_writes.sql`. It must also be added to the `needs_postgis` list in `scripts/db-test.sh` (it touches `eworks.settings`, created by the postgis-gated vendors migration).
- Session cookie name `eworks_dev_uid`; tests build cookies with `setSessionCookie` exactly like `web/server/vendor-pricing.db.test.mjs:53-69`.
- Definition of done: `npx vitest run`, `npx tsc -b`, `npx oxlint` green in `web/`; `bash scripts/db-test.sh` green at repo root.
- Fixture user ids (from `supabase/tests/01_fixtures.sql`): HEAD_ADMIN@TN `22222222-0000-0000-0000-00000000000a`, DISTRICT_OFFICER@Coimbatore `22222222-0000-0000-0000-00000000000b`, SITE_ENGINEER@Coimbatore-Section-1 `22222222-0000-0000-0000-00000000000d`. Org units: TN state `11111111-0000-0000-0000-000000000001`, Coimbatore district `11111111-0000-0000-0000-000000000002`, Coimbatore Section 1 `11111111-0000-0000-0000-000000000006`, Salem district `11111111-0000-0000-0000-000000000009`.

---

### Task 1: Migration + RLS checks — open the missing admin write paths

**Files:**
- Create: `supabase/migrations/20260717000100_admin_writes.sql`
- Create: `supabase/tests/10_admin_writes.sql`
- Modify: `scripts/db-test.sh` (two spots: `needs_postgis()` case list; test-loop glob list)

**Interfaces:**
- Produces: RLS policies `user_profiles_admin_create`, `roles_read`, `permissions_read`, `role_permissions_read`, `roles_admin_write`, `role_permissions_admin_write`, `settings_admin_write`. Later tasks' BFF endpoints assume: `user.manage` holders (anywhere) can INSERT `user_profiles`, write `roles`/`role_permissions`, and write `settings`; everyone authenticated can SELECT `roles`/`permissions`/`role_permissions`.

- [ ] **Step 1: Write the failing SQL checks**

Create `supabase/tests/10_admin_writes.sql`:

```sql
-- Admin write paths: user creation, role/permission editing, settings.
-- user_roles / test_catalog / test_stage_rules write policies predate this
-- file and are exercised by 02/05; this file covers the paths added by
-- 20260717000100_admin_writes.sql.

\set ON_ERROR_STOP on
\set QUIET on

create or replace function pg_temp.check(label text, condition boolean)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'pass: %', label;
end;
$$;

create or replace function pg_temp.check_raises(label text, stmt text)
returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    raise notice 'pass: % (rejected: %)', label, left(sqlerrm, 55); return;
  end;
  raise exception 'FAIL: % -- accepted but should have been rejected', label;
end;
$$;

-- ===========================================================================
-- 1. Creating users: user.manage only.
-- ===========================================================================
begin;
set local role eworks_authenticated;

select set_config('app.user_id','22222222-0000-0000-0000-00000000000a', true); -- head admin
insert into eworks.user_profiles (phone, full_name) values ('9911100001','Created By Admin');
select pg_temp.check('A head admin can create a user profile',
  (select count(*) from eworks.user_profiles where phone='9911100001') = 1);

select set_config('app.user_id','22222222-0000-0000-0000-00000000000d', true); -- site engineer
select pg_temp.check_raises('A site engineer cannot create a user profile',
  $$insert into eworks.user_profiles (phone, full_name) values ('9911100002','Should Fail')$$);
rollback;

-- ===========================================================================
-- 2. Roles and the permission matrix: readable by all, writable by user.manage.
-- ===========================================================================
begin;
set local role eworks_authenticated;

select set_config('app.user_id','22222222-0000-0000-0000-00000000000d', true); -- site engineer
select pg_temp.check('Any authenticated user can read the roles list',
  (select count(*) from eworks.roles) >= 8);
select pg_temp.check('Any authenticated user can read the permission catalog',
  (select count(*) from eworks.permissions) >= 14);
select pg_temp.check_raises('A site engineer cannot create a role',
  $$insert into eworks.roles (code, name) values ('SNEAKY_ROLE','Nope')$$);
select pg_temp.check_raises('A site engineer cannot edit a role''s permissions',
  $$insert into eworks.role_permissions (role_code, permission_code)
    values ('AUDITOR','user.manage')$$);

select set_config('app.user_id','22222222-0000-0000-0000-00000000000a', true); -- head admin
insert into eworks.roles (code, name, description)
values ('QUALITY_CELL','Quality cell reviewer','Reads results statewide');
insert into eworks.role_permissions (role_code, permission_code)
values ('QUALITY_CELL','result.verify');
select pg_temp.check('A head admin can create a role with permissions',
  (select count(*) from eworks.role_permissions
    where role_code='QUALITY_CELL' and permission_code='result.verify') = 1);
delete from eworks.role_permissions where role_code='QUALITY_CELL';
select pg_temp.check('A head admin can remove a role permission',
  (select count(*) from eworks.role_permissions where role_code='QUALITY_CELL') = 0);
rollback;

-- ===========================================================================
-- 3. Settings: readable by any authenticated user, writable by user.manage.
-- ===========================================================================
begin;
set local role eworks_authenticated;

select set_config('app.user_id','22222222-0000-0000-0000-00000000000d', true); -- site engineer
select pg_temp.check('A site engineer can read settings',
  (select count(*) from eworks.settings where key='geofence_radius_m') = 1);
select pg_temp.check_raises('A site engineer cannot change a setting',
  $$update eworks.settings set value='999'::jsonb where key='geofence_radius_m'$$);

select set_config('app.user_id','22222222-0000-0000-0000-00000000000a', true); -- head admin
update eworks.settings set value='200'::jsonb, updated_at=now()
 where key='geofence_radius_m';
select pg_temp.check('A head admin can change a setting',
  (select value #>> '{}' from eworks.settings where key='geofence_radius_m') = '200');
insert into eworks.settings (key, value) values ('payment_hold_days','7'::jsonb)
on conflict (key) do update set value = excluded.value;
select pg_temp.check('A head admin can add a new setting key',
  (select value #>> '{}' from eworks.settings where key='payment_hold_days') = '7');
rollback;
```

- [ ] **Step 2: Wire the new test file and migration into `scripts/db-test.sh`**

Two edits:

1. In `needs_postgis()`, the first case-arm list ends with `20260710000100_notifications.sql) return 0 ;;`. Add a line right after it:

```bash
    20260717000100_admin_writes.sql)                                  return 0 ;;
```

Also extend the tests case-arm (the line listing `03_vendors.sql|04_pricing.sql|...|09_notifications.sql`) by appending `|10_admin_writes.sql` before the closing `)`.

2. The test loop reads `for t in supabase/tests/02_*.sql supabase/tests/03_*.sql ... supabase/tests/09_*.sql; do`. Append `supabase/tests/10_*.sql` to that list.

- [ ] **Step 3: Run to verify the checks fail (policies don't exist yet)**

Run at repo root: `bash scripts/db-test.sh 2>&1 | grep -E "10_admin|FAIL|RESULT"`
Expected: `ERROR:  FAIL: A head admin can create a user profile` (permission denied — no grant/policy yet), `RESULT: FAILED`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260717000100_admin_writes.sql`:

```sql
-- Part B admin module: the only admin write paths genuinely missing under
-- RLS. user_roles (user.manage, org-scoped), test_catalog and
-- test_stage_rules (catalog.manage) already have write policies; this adds,
-- additively:
--   * user_profiles: user.manage holders may create users ("Add user")
--   * roles / permissions / role_permissions: RLS on, read for any
--     authenticated user, writes for user.manage holders
--   * settings: writes for user.manage holders
-- Role codes stay immutable in practice: the BFF exposes no rename/delete,
-- and role_permissions cascades are the only sanctioned edit surface.

-- user_profiles -------------------------------------------------------------
grant insert on eworks.user_profiles to eworks_authenticated;

create policy user_profiles_admin_create on eworks.user_profiles
  for insert
  with check (eworks.has_permission_anywhere('user.manage'));

-- roles + permission matrix --------------------------------------------------
alter table eworks.roles            enable row level security;
alter table eworks.permissions      enable row level security;
alter table eworks.role_permissions enable row level security;

grant select on eworks.roles, eworks.permissions, eworks.role_permissions
  to eworks_authenticated;
grant insert, update on eworks.roles to eworks_authenticated;
grant insert, delete on eworks.role_permissions to eworks_authenticated;

create policy roles_read on eworks.roles
  for select using (eworks.current_user_id() is not null);

create policy permissions_read on eworks.permissions
  for select using (eworks.current_user_id() is not null);

create policy role_permissions_read on eworks.role_permissions
  for select using (eworks.current_user_id() is not null);

create policy roles_admin_write on eworks.roles
  for all
  using (eworks.has_permission_anywhere('user.manage'))
  with check (eworks.has_permission_anywhere('user.manage'));

create policy role_permissions_admin_write on eworks.role_permissions
  for all
  using (eworks.has_permission_anywhere('user.manage'))
  with check (eworks.has_permission_anywhere('user.manage'));

-- settings -------------------------------------------------------------------
grant insert, update on eworks.settings to eworks_authenticated;

create policy settings_admin_write on eworks.settings
  for all
  using (eworks.has_permission_anywhere('user.manage'))
  with check (eworks.has_permission_anywhere('user.manage'));
```

- [ ] **Step 5: Run to verify all checks pass**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: the 10 new `pass:` lines from `10_admin_writes.sql` and `RESULT: 386 checks passed (Phases 0-6a)` (376 existing + 10 new). If HEAD_ADMIN turns out not to hold `user.manage` in the seed, check `20260709000700_seed_reference_data.sql`'s `role_permissions` block — the fix is choosing a fixture user whose role has it, not weakening a policy.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260717000100_admin_writes.sql supabase/tests/10_admin_writes.sql scripts/db-test.sh
git commit -m "feat(admin): RLS write paths for user creation, role editing, settings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: BFF — list users, add user, org-unit picker

**Files:**
- Modify: `web/server/bff.mjs` (new `admin` section after the officers route, ~line 1621)
- Create: `web/server/admin.test.mjs` (mocked: auth + validation only)
- Create: `web/server/admin.db.test.mjs` (real PG: RLS + audit semantics)

**Interfaces:**
- Consumes: Task 1's policies; `withUserSession`, `requireUser`, `httpError` from `bff.mjs`; test harness shapes from `vendor-pricing.test.mjs` / `vendor-pricing.db.test.mjs`.
- Produces:
  - `GET /api/admin/users?q=` → `[{ userId, phone, fullName, isActive, roles: [{ roleCode, roleName, orgUnitId, orgName, orgLevel, orgPath }] }]`
  - `POST /api/admin/users` body `{ fullName, phone, orgUnitId, roleCode }` → 201 `{ userId, phone, fullName }`
  - `GET /api/admin/org-units` → `[{ id, name, level, path }]`
  - Shared helper `requireAdminPerm(client, permOrPerms)` used by every later admin endpoint.

- [ ] **Step 1: Write the failing mocked tests**

Create `web/server/admin.test.mjs`. Mirror the exact harness of `vendor-pricing.test.mjs` (same `vi.mock('./db.mjs', ...)`, `cookieFor`, `call`); the fake `withUserSession` invokes `fn` with a client whose `query` is dispatched by `fakeQuery`:

```js
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './env.mjs';
import { setSessionCookie } from './security.mjs';

const ADMIN = '22222222-0000-0000-0000-00000000000a';

const state = {
  noAuth: false,
  hasPerm: true,
  users: [{ userId: ADMIN, phone: '9000000001', fullName: 'Head Admin', isActive: true, roles: [] }],
  queries: [],
};
function resetState() {
  state.noAuth = false;
  state.hasPerm = true;
  state.queries = [];
}

function fakeQuery(sql, params) {
  state.queries.push({ sql, params });
  if (sql.includes('has_permission_anywhere')) return { rows: [{ ok: state.hasPerm }], rowCount: 1 };
  if (sql.includes('from eworks.user_profiles p')) return { rows: state.users, rowCount: state.users.length };
  if (sql.includes('insert into eworks.user_profiles')) {
    return { rows: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', phone: params[0], fullName: params[1] }], rowCount: 1 };
  }
  if (sql.includes('insert into eworks.user_roles')) return { rows: [{ id: 'bbbbbbbb-0000-0000-0000-000000000001' }], rowCount: 1 };
  if (sql.includes('insert into eworks.audit_logs')) return { rows: [], rowCount: 1 };
  if (sql.includes('from eworks.org_units')) return { rows: [], rowCount: 0 };
  throw new Error(`fake client has no handler for: ${sql.slice(0, 80)}`);
}

vi.mock('./db.mjs', () => ({
  pool: { query: vi.fn() },
  withUserSession: vi.fn(async (_userId, fn) => fn({ query: async (sql, params) => fakeQuery(sql, params) })),
  lookupProfile: vi.fn(),
}));

const { createApp } = await import('./bff.mjs');
const config = loadConfig({});
const app = createApp(config, {});

function cookieFor(userId) {
  let cookie = '';
  const res = { setHeader: (_n, v) => { cookie = String(v).split(';')[0]; } };
  setSessionCookie(res, userId, config);
  return cookie;
}

async function call(method, path, body) {
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (!state.noAuth) headers.cookie = cookieFor(ADMIN);
    const res = await fetch(`http://127.0.0.1:${srv.address().port}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    srv.close();
  }
}

describe('admin users endpoints', () => {
  beforeEach(() => resetState());

  it('401s without a session', async () => {
    state.noAuth = true;
    const r = await call('GET', '/api/admin/users');
    expect(r.status).toBe(401);
  });

  it('403s without user.manage', async () => {
    state.hasPerm = false;
    const r = await call('GET', '/api/admin/users');
    expect(r.status).toBe(403);
  });

  it('lists users with their role grants', async () => {
    const r = await call('GET', '/api/admin/users');
    expect(r.status).toBe(200);
    expect(r.body[0].fullName).toBe('Head Admin');
  });

  it('rejects a malformed phone on create', async () => {
    const r = await call('POST', '/api/admin/users', {
      fullName: 'New Officer', phone: '12345',
      orgUnitId: '11111111-0000-0000-0000-000000000002', roleCode: 'SITE_ENGINEER',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_phone');
  });

  it('rejects a blank name on create', async () => {
    const r = await call('POST', '/api/admin/users', {
      fullName: '  ', phone: '9876543210',
      orgUnitId: '11111111-0000-0000-0000-000000000002', roleCode: 'SITE_ENGINEER',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_name');
  });

  it('creates profile + role + audit row in one transaction', async () => {
    const r = await call('POST', '/api/admin/users', {
      fullName: 'New Officer', phone: '9876543210',
      orgUnitId: '11111111-0000-0000-0000-000000000002', roleCode: 'SITE_ENGINEER',
    });
    expect(r.status).toBe(201);
    const sqls = state.queries.map((q) => q.sql);
    expect(sqls.some((s) => s.includes('insert into eworks.user_profiles'))).toBe(true);
    expect(sqls.some((s) => s.includes('insert into eworks.user_roles'))).toBe(true);
    expect(sqls.some((s) => s.includes('insert into eworks.audit_logs'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run server/admin.test.mjs`
Expected: FAIL — 404s (routes don't exist), so status assertions miss.

- [ ] **Step 3: Implement the routes in `bff.mjs`**

Insert a new banner section directly after the `GET /api/gov/officers` route body ends (~line 1621):

```js
  // ---- admin: users, roles, settings, catalog ------------------------------
  // RLS is the real gate. This pre-check only converts a silent RLS no-op
  // into a clear 403 for the UI; passing it never grants anything RLS denies.
  async function requireAdminPerm(client, perms) {
    const list = Array.isArray(perms) ? perms : [perms];
    const q = await client.query(
      `select bool_or(eworks.has_permission_anywhere(p)) as ok
         from unnest($1::text[]) as p`,
      [list],
    );
    if (!q.rows[0].ok) throw httpError(403, `requires ${list.join(' or ')}`);
  }

  const PHONE_RE = /^[6-9][0-9]{9}$/;

  app.get('/api/admin/users', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const search = String(req.query.q ?? '').trim();
    try {
      const rows = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const q = await client.query(
          `select p.id        as "userId",
                  p.phone,
                  p.full_name as "fullName",
                  p.is_active as "isActive",
                  coalesce(jsonb_agg(jsonb_build_object(
                    'roleCode',  ur.role_code,
                    'roleName',  r.name,
                    'orgUnitId', ou.id,
                    'orgName',   ou.name,
                    'orgLevel',  ou.level,
                    'orgPath',   ou.path::text
                  ) order by ou.path, ur.role_code)
                    filter (where ur.id is not null), '[]'::jsonb) as roles
             from eworks.user_profiles p
             left join eworks.user_roles ur
               on ur.user_id = p.id
              and (ur.expires_at is null or ur.expires_at > now())
             left join eworks.org_units ou on ou.id = ur.org_unit_id
             left join eworks.roles r on r.code = ur.role_code
            where ($1 = ''
                   or p.full_name ilike '%' || $1 || '%'
                   or p.phone like $1 || '%')
            group by p.id
            order by p.full_name`,
          [search],
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(err.httpStatus ?? 500).json({ error: 'admin_users_failed', detail: err.message });
    }
  });

  app.post('/api/admin/users', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { fullName, phone, orgUnitId, roleCode } = req.body || {};
    if (!fullName || !String(fullName).trim()) {
      return res.status(400).json({ error: 'invalid_name', detail: 'full name is required' });
    }
    if (!PHONE_RE.test(String(phone ?? ''))) {
      return res.status(400).json({ error: 'invalid_phone', detail: 'phone must be a 10-digit Indian mobile number' });
    }
    if (!orgUnitId || !roleCode) {
      return res.status(400).json({ error: 'org_and_role_required', detail: 'orgUnitId and roleCode are required' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const pQ = await client.query(
          `insert into eworks.user_profiles (phone, full_name)
           values ($1, $2)
           returning id as "userId", phone, full_name as "fullName"`,
          [String(phone), String(fullName).trim()],
        );
        const created = pQ.rows[0];
        await client.query(
          `insert into eworks.user_roles (user_id, role_code, org_unit_id, granted_by)
           values ($1, $2, $3, eworks.current_user_id())`,
          [created.userId, roleCode, orgUnitId],
        );
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           select eworks.current_user_id(), 'admin.user_create', 'user_profiles', $1, ou.path,
                  jsonb_build_object('phone', $2::text, 'full_name', $3::text,
                                     'role_code', $4::text, 'org_unit_id', $5::uuid)
             from eworks.org_units ou where ou.id = $5`,
          [created.userId, String(phone), String(fullName).trim(), roleCode, orgUnitId],
        );
        return created;
      });
      res.status(201).json(row);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'phone_exists', detail: 'a user with this phone already exists' });
      }
      if (err.code === '42501') {
        return res.status(403).json({ error: 'forbidden', detail: 'you cannot manage users at this org unit' });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'user_create_failed', detail: err.message });
    }
  });

  app.get('/api/admin/org-units', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, ['user.manage', 'catalog.manage']);
        // RLS scopes this to the admin's own subtree.
        const q = await client.query(
          `select id, name, level, path::text as path
             from eworks.org_units
            where is_active
            order by path`,
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(err.httpStatus ?? 500).json({ error: 'admin_org_units_failed', detail: err.message });
    }
  });
```

Also add to `admin.test.mjs`'s `fakeQuery` nothing — the handlers above are already covered by its substring matches.

- [ ] **Step 4: Run mocked tests to verify they pass**

Run: `cd web && npx vitest run server/admin.test.mjs`
Expected: 6 passed.

- [ ] **Step 5: Write the failing real-PG tests**

Create `web/server/admin.db.test.mjs`. Copy the exact availability-probe + skip pattern from `vendor-pricing.db.test.mjs:10-75` (env pins, superuser `probe` pool, `describe.skipIf(!dbAvailable)`, mirror `it.skip` block, `beforeAll` dynamic imports, `cookieFor`, `api(userId, method, path, body)` helper):

```js
// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';

process.env.EWORKS_USE_LOCAL_PG = process.env.EWORKS_USE_LOCAL_PG || '1';
process.env.PGHOST = process.env.PGHOST || '127.0.0.1';
process.env.PGPORT = process.env.PGPORT || '5433';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'postgres';
process.env.PGDATABASE = process.env.PGDATABASE || 'eworks';

const HEAD_ADMIN = '22222222-0000-0000-0000-00000000000a';   // TN state
const SITE_ENG = '22222222-0000-0000-0000-00000000000d';     // no user.manage
const CBE_ADMIN = '22222222-0000-0000-0000-000000000c0a';    // created below: HEAD_ADMIN @ Coimbatore only
const CBE_DISTRICT = '11111111-0000-0000-0000-000000000002';
const CBE_SECTION = '11111111-0000-0000-0000-000000000006';
const SALEM_DISTRICT = '11111111-0000-0000-0000-000000000009';
const TARGET_USER = '22222222-0000-0000-0000-00000000000d';  // site engineer as grant target

const probe = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE, connectionTimeoutMillis: 1500, max: 2,
});

let dbAvailable = true;
try {
  const r = await probe.query(
    `select (select count(*) from eworks.user_profiles where id = $1) as admins`,
    [HEAD_ADMIN],
  );
  dbAvailable = Number(r.rows[0].admins) === 1;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)('admin endpoints against real Postgres', () => {
  let app, config, setSessionCookie, srv, base, db;

  beforeAll(async () => {
    ({ setSessionCookie } = await import('./security.mjs'));
    const env = await import('./env.mjs');
    db = await import('./db.mjs');
    config = env.loadConfig({ ...process.env, EWORKS_ENV: undefined });
    const bff = await import('./bff.mjs');
    app = bff.createApp(config, {});
    await new Promise((resolve) => { srv = app.listen(0, resolve); });
    base = `http://127.0.0.1:${srv.address().port}`;
    // A district-scoped admin: HEAD_ADMIN role granted at Coimbatore only.
    await probe.query(
      `insert into eworks.user_profiles (id, phone, full_name)
       values ($1, '9899900001', 'Coimbatore Scoped Admin')
       on conflict (id) do nothing`, [CBE_ADMIN]);
    await probe.query(
      `insert into eworks.user_roles (user_id, role_code, org_unit_id)
       values ($1, 'HEAD_ADMIN', $2)
       on conflict on constraint user_roles_unique do nothing`, [CBE_ADMIN, CBE_DISTRICT]);
  });

  afterAll(async () => {
    await new Promise((resolve) => srv.close(resolve));
    await db.pool.end();
    await probe.end();
  });

  beforeEach(async () => {
    await probe.query(
      `delete from eworks.user_roles
        where user_id = $1 and role_code = 'AUDITOR'`, [TARGET_USER]);
    await probe.query(
      `delete from eworks.user_profiles where phone like '98888%'`);
  });

  function cookieFor(userId) {
    let cookie = '';
    const res = { setHeader: (_n, v) => { cookie = String(v).split(';')[0]; } };
    setSessionCookie(res, userId, config);
    return cookie;
  }

  async function api(userId, method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', cookie: cookieFor(userId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it('a site engineer gets 403 from the users list', async () => {
    const r = await api(SITE_ENG, 'GET', '/api/admin/users');
    expect(r.status).toBe(403);
  });

  it('a head admin lists users including their role grants', async () => {
    const r = await api(HEAD_ADMIN, 'GET', '/api/admin/users?q=Head');
    expect(r.status).toBe(200);
    const me = r.body.find((u) => u.userId === HEAD_ADMIN);
    expect(me.roles.some((g) => g.roleCode === 'HEAD_ADMIN')).toBe(true);
  });

  it('creating a user writes profile, role, and an audit row', async () => {
    const r = await api(HEAD_ADMIN, 'POST', '/api/admin/users', {
      fullName: 'Freshly Added', phone: '9888800001',
      orgUnitId: CBE_SECTION, roleCode: 'SITE_ENGINEER',
    });
    expect(r.status).toBe(201);
    const audit = await probe.query(
      `select payload from eworks.audit_logs
        where action = 'admin.user_create' and entity_id = $1`, [r.body.userId]);
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].payload.role_code).toBe('SITE_ENGINEER');
    const chain = await probe.query('select eworks.verify_audit_chain() as bad');
    expect(chain.rows[0].bad).toBeNull();
  });

  it('a Coimbatore-scoped admin cannot create a user with a Salem role', async () => {
    const r = await api(CBE_ADMIN, 'POST', '/api/admin/users', {
      fullName: 'Wrong District', phone: '9888800002',
      orgUnitId: SALEM_DISTRICT, roleCode: 'SITE_ENGINEER',
    });
    expect(r.status).toBe(403);
    const check = await probe.query(
      `select count(*)::int as n from eworks.user_profiles where phone = '9888800002'`);
    expect(check.rows[0].n).toBe(0); // transaction rolled back — no orphan profile
  });

  it('duplicate phone returns 409', async () => {
    const r = await api(HEAD_ADMIN, 'POST', '/api/admin/users', {
      fullName: 'Dup Phone', phone: '9000000001',
      orgUnitId: CBE_SECTION, roleCode: 'SITE_ENGINEER',
    });
    expect(r.status).toBe(409);
  });

  it('org-units list is scoped to the admin subtree', async () => {
    const r = await api(CBE_ADMIN, 'GET', '/api/admin/org-units');
    expect(r.status).toBe(200);
    expect(r.body.some((o) => o.id === CBE_DISTRICT)).toBe(true);
    expect(r.body.some((o) => o.id === SALEM_DISTRICT)).toBe(false);
  });
});

if (!dbAvailable) {
  describe('admin endpoints against real Postgres', () => {
    it.skip('skipped — local test DB not reachable (run scripts/db-test.sh first)', () => {});
  });
}
```

- [ ] **Step 6: Run db tests**

Run: `cd web && npx vitest run server/admin.db.test.mjs`
Expected: 6 passed (requires `docker start eworks-pg` + `bash scripts/db-test.sh` beforehand). Note: the Salem-403 test passes only because the RLS error surfaces as pg code `42501` — if it arrives as a policy-violation message instead, assert on status via the `err.code === '42501'` mapping already in the route.

- [ ] **Step 7: Commit**

```bash
git add web/server/bff.mjs web/server/admin.test.mjs web/server/admin.db.test.mjs
git commit -m "feat(admin): users list, add-user, org-unit picker endpoints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: BFF — grant role, revoke role, last-HEAD_ADMIN guard

**Files:**
- Modify: `web/server/bff.mjs` (extend the admin section from Task 2)
- Modify: `web/server/admin.db.test.mjs` (append a describe block)

**Interfaces:**
- Consumes: `requireAdminPerm`, constants from Task 2's test file.
- Produces:
  - `POST /api/admin/users/:id/roles` body `{ roleCode, orgUnitId }` → 201 `{ id, roleCode, orgUnitId }`
  - `DELETE /api/admin/users/:id/roles/:roleCode?orgUnitId=<uuid>` → `{ revoked: true }`; 409 `{ error: 'last_head_admin' }` when the revoke would leave zero visible active HEAD_ADMIN grants.

- [ ] **Step 1: Write the failing db tests**

Append to the `describe.skipIf(!dbAvailable)` block in `admin.db.test.mjs`:

```js
  it('grants and revokes a role, audit-logged', async () => {
    const grant = await api(HEAD_ADMIN, 'POST', `/api/admin/users/${TARGET_USER}/roles`, {
      roleCode: 'AUDITOR', orgUnitId: CBE_DISTRICT,
    });
    expect(grant.status).toBe(201);
    const revoke = await api(HEAD_ADMIN, 'DELETE',
      `/api/admin/users/${TARGET_USER}/roles/AUDITOR?orgUnitId=${CBE_DISTRICT}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.revoked).toBe(true);
    const audit = await probe.query(
      `select action from eworks.audit_logs
        where entity_type = 'user_roles' and payload->>'user_id' = $1
        order by seq desc limit 2`, [TARGET_USER]);
    expect(audit.rows.map((r) => r.action).sort())
      .toEqual(['admin.role_grant', 'admin.role_revoke']);
  });

  it('a Coimbatore-scoped admin cannot grant a role in Salem', async () => {
    const r = await api(CBE_ADMIN, 'POST', `/api/admin/users/${TARGET_USER}/roles`, {
      roleCode: 'AUDITOR', orgUnitId: SALEM_DISTRICT,
    });
    expect(r.status).toBe(403);
  });

  it('granting a role twice returns 409', async () => {
    await api(HEAD_ADMIN, 'POST', `/api/admin/users/${TARGET_USER}/roles`, {
      roleCode: 'AUDITOR', orgUnitId: CBE_DISTRICT,
    });
    const dup = await api(HEAD_ADMIN, 'POST', `/api/admin/users/${TARGET_USER}/roles`, {
      roleCode: 'AUDITOR', orgUnitId: CBE_DISTRICT,
    });
    expect(dup.status).toBe(409);
  });

  it('revoking a grant that does not exist returns 404', async () => {
    const r = await api(HEAD_ADMIN, 'DELETE',
      `/api/admin/users/${TARGET_USER}/roles/AUDITOR?orgUnitId=${SALEM_DISTRICT}`);
    expect(r.status).toBe(404);
  });

  it('blocks revoking the last HEAD_ADMIN', async () => {
    // Fixture DB has exactly one state HEAD_ADMIN plus our CBE_ADMIN grant.
    // Remove the CBE grant so the state admin is the last one, then try to
    // revoke it as itself.
    await probe.query(
      `delete from eworks.user_roles where user_id = $1 and role_code = 'HEAD_ADMIN'`,
      [CBE_ADMIN]);
    const r = await api(HEAD_ADMIN, 'DELETE',
      `/api/admin/users/${HEAD_ADMIN}/roles/HEAD_ADMIN?orgUnitId=11111111-0000-0000-0000-000000000001`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('last_head_admin');
    // Restore the CBE grant for later tests.
    await probe.query(
      `insert into eworks.user_roles (user_id, role_code, org_unit_id)
       values ($1, 'HEAD_ADMIN', $2)
       on conflict on constraint user_roles_unique do nothing`, [CBE_ADMIN, CBE_DISTRICT]);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run server/admin.db.test.mjs`
Expected: the 5 new tests FAIL with 404 (routes missing); Task 2's 6 still pass.

- [ ] **Step 3: Implement the routes**

Append inside the admin section of `bff.mjs`:

```js
  app.post('/api/admin/users/:id/roles', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { roleCode, orgUnitId } = req.body || {};
    if (!roleCode || !orgUnitId) {
      return res.status(400).json({ error: 'role_and_org_required', detail: 'roleCode and orgUnitId are required' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const q = await client.query(
          `insert into eworks.user_roles (user_id, role_code, org_unit_id, granted_by)
           values ($1, $2, $3, eworks.current_user_id())
           returning id, role_code as "roleCode", org_unit_id as "orgUnitId"`,
          [req.params.id, roleCode, orgUnitId],
        );
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           select eworks.current_user_id(), 'admin.role_grant', 'user_roles', $1, ou.path,
                  jsonb_build_object('user_id', $2::uuid, 'role_code', $3::text, 'org_unit_id', $4::uuid)
             from eworks.org_units ou where ou.id = $4`,
          [q.rows[0].id, req.params.id, roleCode, orgUnitId],
        );
        return q.rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'role_exists', detail: 'this user already holds that role at that org unit' });
      }
      if (err.code === '42501') {
        return res.status(403).json({ error: 'forbidden', detail: 'you cannot manage roles at this org unit' });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'role_grant_failed', detail: err.message });
    }
  });

  app.delete('/api/admin/users/:id/roles/:roleCode', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const orgUnitId = String(req.query.orgUnitId ?? '');
    if (!orgUnitId) {
      return res.status(400).json({ error: 'org_required', detail: 'orgUnitId query param is required' });
    }
    try {
      const out = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        if (req.params.roleCode === 'HEAD_ADMIN') {
          // Counted under RLS: a scoped admin who cannot see other head
          // admins is blocked too — the guard errs on the safe side.
          const cQ = await client.query(
            `select count(*)::int as n
               from eworks.user_roles ur
              where ur.role_code = 'HEAD_ADMIN'
                and (ur.expires_at is null or ur.expires_at > now())
                and not (ur.user_id = $1 and ur.org_unit_id = $2)`,
            [req.params.id, orgUnitId],
          );
          if (cQ.rows[0].n === 0) {
            const e = httpError(409, 'cannot remove the last head admin');
            e.errorCode = 'last_head_admin';
            throw e;
          }
        }
        const dQ = await client.query(
          `delete from eworks.user_roles
            where user_id = $1 and role_code = $2 and org_unit_id = $3
            returning id`,
          [req.params.id, req.params.roleCode, orgUnitId],
        );
        if (dQ.rowCount === 0) throw httpError(404, 'role grant not found');
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           select eworks.current_user_id(), 'admin.role_revoke', 'user_roles', $1, ou.path,
                  jsonb_build_object('user_id', $2::uuid, 'role_code', $3::text, 'org_unit_id', $4::uuid)
             from eworks.org_units ou where ou.id = $4`,
          [dQ.rows[0].id, req.params.id, req.params.roleCode, orgUnitId],
        );
        return { revoked: true };
      });
      res.json(out);
    } catch (err) {
      if (err.errorCode === 'last_head_admin') {
        return res.status(409).json({ error: 'last_head_admin', detail: err.message });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'role_revoke_failed', detail: err.message });
    }
  });
```

Caveat the implementer must know: RLS `DELETE` without permission silently deletes 0 rows (no 42501), so the out-of-scope revoke surfaces as 404, not 403 — that is why the Salem revoke test above asserts 404 for the missing grant and 403 only on the INSERT path.

- [ ] **Step 4: Run db tests to verify green**

Run: `cd web && npx vitest run server/admin.db.test.mjs`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add web/server/bff.mjs web/server/admin.db.test.mjs
git commit -m "feat(admin): role grant/revoke with last-HEAD_ADMIN guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: BFF — roles & permission matrix endpoints

**Files:**
- Modify: `web/server/bff.mjs`
- Modify: `web/server/admin.db.test.mjs`

**Interfaces:**
- Produces:
  - `GET /api/admin/roles` → `{ roles: [{ code, name, description, permissions: string[] }], permissions: [{ code, description }] }`
  - `POST /api/admin/roles` body `{ code, name, description?, permissions: string[] }` → 201 role row
  - `PUT /api/admin/roles/:code/permissions` body `{ permissions: string[] }` → `{ code, permissions }`

- [ ] **Step 1: Write the failing db tests**

Append to `admin.db.test.mjs` (inside the skipIf describe). Also add `QUALITY_CELL` cleanup to `beforeEach`:

```js
    await probe.query(`delete from eworks.role_permissions where role_code = 'QUALITY_CELL'`);
    await probe.query(`delete from eworks.roles where code = 'QUALITY_CELL'`);
```

```js
  it('returns the full role/permission matrix', async () => {
    const r = await api(HEAD_ADMIN, 'GET', '/api/admin/roles');
    expect(r.status).toBe(200);
    expect(r.body.permissions.length).toBeGreaterThanOrEqual(14);
    const headAdmin = r.body.roles.find((x) => x.code === 'HEAD_ADMIN');
    expect(headAdmin.permissions).toContain('user.manage');
  });

  it('creates a role with its permission set, audit-logged', async () => {
    const r = await api(HEAD_ADMIN, 'POST', '/api/admin/roles', {
      code: 'QUALITY_CELL', name: 'Quality cell reviewer',
      description: 'Reads results statewide', permissions: ['result.verify', 'order.read'],
    });
    expect(r.status).toBe(201);
    const matrix = await api(HEAD_ADMIN, 'GET', '/api/admin/roles');
    const created = matrix.body.roles.find((x) => x.code === 'QUALITY_CELL');
    expect(created.permissions.sort()).toEqual(['order.read', 'result.verify']);
    const audit = await probe.query(
      `select count(*)::int as n from eworks.audit_logs
        where action = 'admin.role_create' and payload->>'role_code' = 'QUALITY_CELL'`);
    expect(audit.rows[0].n).toBe(1);
  });

  it('rejects a lowercase role code', async () => {
    const r = await api(HEAD_ADMIN, 'POST', '/api/admin/roles', {
      code: 'bad_code', name: 'Nope', permissions: [],
    });
    expect(r.status).toBe(400);
  });

  it('replaces a role permission set with before/after in the audit payload', async () => {
    await api(HEAD_ADMIN, 'POST', '/api/admin/roles', {
      code: 'QUALITY_CELL', name: 'Quality cell reviewer', permissions: ['result.verify'],
    });
    const r = await api(HEAD_ADMIN, 'PUT', '/api/admin/roles/QUALITY_CELL/permissions', {
      permissions: ['result.verify', 'audit.read'],
    });
    expect(r.status).toBe(200);
    expect(r.body.permissions.sort()).toEqual(['audit.read', 'result.verify']);
    const audit = await probe.query(
      `select payload from eworks.audit_logs
        where action = 'admin.role_permissions_set' and payload->>'role_code' = 'QUALITY_CELL'
        order by seq desc limit 1`);
    expect(audit.rows[0].payload.before).toEqual(['result.verify']);
    expect(audit.rows[0].payload.after.sort()).toEqual(['audit.read', 'result.verify']);
  });

  it('a site engineer cannot create roles', async () => {
    const r = await api(SITE_ENG, 'POST', '/api/admin/roles', {
      code: 'SNEAKY', name: 'Nope', permissions: [],
    });
    expect(r.status).toBe(403);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run server/admin.db.test.mjs`
Expected: 5 new FAIL (404), earlier ones pass.

- [ ] **Step 3: Implement the routes**

```js
  const ROLE_CODE_RE = /^[A-Z_]+$/;

  app.get('/api/admin/roles', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const out = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const rolesQ = await client.query(
          `select r.code, r.name, r.description,
                  coalesce(array_agg(rp.permission_code order by rp.permission_code)
                           filter (where rp.permission_code is not null), '{}') as permissions
             from eworks.roles r
             left join eworks.role_permissions rp on rp.role_code = r.code
            group by r.code
            order by r.code`,
        );
        const permsQ = await client.query(
          `select code, description from eworks.permissions order by code`,
        );
        return { roles: rolesQ.rows, permissions: permsQ.rows };
      });
      res.json(out);
    } catch (err) {
      res.status(err.httpStatus ?? 500).json({ error: 'admin_roles_failed', detail: err.message });
    }
  });

  app.post('/api/admin/roles', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { code, name, description, permissions } = req.body || {};
    if (!ROLE_CODE_RE.test(String(code ?? ''))) {
      return res.status(400).json({ error: 'invalid_code', detail: 'role code must be UPPER_SNAKE letters/underscores' });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'invalid_name', detail: 'role name is required' });
    }
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'invalid_permissions', detail: 'permissions must be an array of codes' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const rQ = await client.query(
          `insert into eworks.roles (code, name, description)
           values ($1, $2, $3)
           returning code, name, description`,
          [code, String(name).trim(), description ?? null],
        );
        if (permissions.length > 0) {
          await client.query(
            `insert into eworks.role_permissions (role_code, permission_code)
             select $1, p from unnest($2::text[]) as p`,
            [code, permissions],
          );
        }
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'admin.role_create', 'roles', null, null,
                   jsonb_build_object('role_code', $1::text, 'name', $2::text,
                                      'permissions', $3::text[]))`,
          [code, String(name).trim(), permissions],
        );
        return { ...rQ.rows[0], permissions };
      });
      res.status(201).json(row);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'role_exists', detail: 'a role with this code already exists' });
      }
      if (err.code === '23503') {
        return res.status(400).json({ error: 'unknown_permission', detail: 'one of the permission codes does not exist' });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'role_create_failed', detail: err.message });
    }
  });

  app.put('/api/admin/roles/:code/permissions', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { permissions } = req.body || {};
    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: 'invalid_permissions', detail: 'permissions must be an array of codes' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const exists = await client.query(
          `select code from eworks.roles where code = $1`, [req.params.code]);
        if (exists.rowCount === 0) throw httpError(404, 'role not found');
        const beforeQ = await client.query(
          `select coalesce(array_agg(permission_code order by permission_code), '{}') as perms
             from eworks.role_permissions where role_code = $1`,
          [req.params.code],
        );
        await client.query(
          `delete from eworks.role_permissions where role_code = $1`, [req.params.code]);
        if (permissions.length > 0) {
          await client.query(
            `insert into eworks.role_permissions (role_code, permission_code)
             select $1, p from unnest($2::text[]) as p`,
            [req.params.code, permissions],
          );
        }
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'admin.role_permissions_set', 'roles', null, null,
                   jsonb_build_object('role_code', $1::text,
                                      'before', $2::text[], 'after', $3::text[]))`,
          [req.params.code, beforeQ.rows[0].perms, permissions],
        );
        return { code: req.params.code, permissions };
      });
      res.json(row);
    } catch (err) {
      if (err.code === '23503') {
        return res.status(400).json({ error: 'unknown_permission', detail: 'one of the permission codes does not exist' });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'role_permissions_failed', detail: err.message });
    }
  });
```

- [ ] **Step 4: Run db tests**

Run: `cd web && npx vitest run server/admin.db.test.mjs`
Expected: 16 passed.

- [ ] **Step 5: Commit**

```bash
git add web/server/bff.mjs web/server/admin.db.test.mjs
git commit -m "feat(admin): roles and permission-matrix endpoints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: BFF — settings endpoints

**Files:**
- Modify: `web/server/bff.mjs`
- Modify: `web/server/admin.db.test.mjs`

**Interfaces:**
- Produces:
  - `GET /api/admin/settings` → `[{ key, value, updatedAt }]` (value is raw jsonb)
  - `PUT /api/admin/settings/:key` body `{ value }` → `{ key, value, updatedAt }`
  - `KNOWN_SETTINGS` registry (key → `{ type: 'number', min, max }`) reused by the SettingsTab labels in Task 12.

- [ ] **Step 1: Write the failing db tests**

Append to `admin.db.test.mjs` (add `await probe.query("delete from eworks.settings where key = 'payment_hold_days'")` to `beforeEach`):

```js
  it('lists settings for an admin, 403s a site engineer', async () => {
    const ok = await api(HEAD_ADMIN, 'GET', '/api/admin/settings');
    expect(ok.status).toBe(200);
    expect(ok.body.some((s) => s.key === 'geofence_radius_m')).toBe(true);
    const no = await api(SITE_ENG, 'GET', '/api/admin/settings');
    expect(no.status).toBe(403);
  });

  it('updates a known numeric setting with range validation', async () => {
    const bad = await api(HEAD_ADMIN, 'PUT', '/api/admin/settings/geofence_radius_m', { value: -5 });
    expect(bad.status).toBe(400);
    const ok = await api(HEAD_ADMIN, 'PUT', '/api/admin/settings/geofence_radius_m', { value: 200 });
    expect(ok.status).toBe(200);
    expect(ok.body.value).toBe(200);
    const audit = await probe.query(
      `select payload from eworks.audit_logs
        where action = 'admin.setting_set' and payload->>'key' = 'geofence_radius_m'
        order by seq desc limit 1`);
    expect(audit.rows[0].payload.after).toBe(200);
    // restore the fixture value
    await api(HEAD_ADMIN, 'PUT', '/api/admin/settings/geofence_radius_m', { value: 150 });
  });

  it('creates an unknown key via upsert and 403s non-admin writes', async () => {
    const ok = await api(HEAD_ADMIN, 'PUT', '/api/admin/settings/payment_hold_days', { value: 7 });
    expect(ok.status).toBe(200);
    const no = await api(SITE_ENG, 'PUT', '/api/admin/settings/payment_hold_days', { value: 1 });
    expect(no.status).toBe(403);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run server/admin.db.test.mjs` — 3 new FAIL (404).

- [ ] **Step 3: Implement**

```js
  // Known keys get typed validation; anything else is stored as raw JSON so
  // new server-side knobs never need a BFF release to become editable.
  const KNOWN_SETTINGS = {
    vendor_max_service_radius_km: { type: 'number', min: 1, max: 2000 },
    geofence_radius_m: { type: 'number', min: 10, max: 5000 },
    geofence_max_accuracy_m: { type: 'number', min: 5, max: 500 },
    max_clock_skew_seconds: { type: 'number', min: 0, max: 3600 },
  };

  app.get('/api/admin/settings', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const rows = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const q = await client.query(
          `select key, value, updated_at as "updatedAt"
             from eworks.settings order by key`,
        );
        return q.rows;
      });
      res.json(rows);
    } catch (err) {
      res.status(err.httpStatus ?? 500).json({ error: 'admin_settings_failed', detail: err.message });
    }
  });

  app.put('/api/admin/settings/:key', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { value } = req.body || {};
    if (value === undefined) {
      return res.status(400).json({ error: 'value_required', detail: 'a JSON value is required' });
    }
    const known = KNOWN_SETTINGS[req.params.key];
    if (known?.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < known.min || value > known.max) {
        return res.status(400).json({
          error: 'invalid_value',
          detail: `${req.params.key} must be a number between ${known.min} and ${known.max}`,
        });
      }
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'user.manage');
        const beforeQ = await client.query(
          `select value from eworks.settings where key = $1`, [req.params.key]);
        const q = await client.query(
          `insert into eworks.settings (key, value, updated_at)
           values ($1, $2::jsonb, now())
           on conflict (key) do update set value = excluded.value, updated_at = now()
           returning key, value, updated_at as "updatedAt"`,
          [req.params.key, JSON.stringify(value)],
        );
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'admin.setting_set', 'settings', null, null,
                   jsonb_build_object('key', $1::text, 'before', $2::jsonb, 'after', $3::jsonb))`,
          [req.params.key, beforeQ.rows[0]?.value ?? null, JSON.stringify(value)],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      if (err.code === '42501') {
        return res.status(403).json({ error: 'forbidden', detail: 'you cannot change settings' });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'setting_set_failed', detail: err.message });
    }
  });
```

- [ ] **Step 4: Run db tests** — Expected: 19 passed.

- [ ] **Step 5: Commit**

```bash
git add web/server/bff.mjs web/server/admin.db.test.mjs
git commit -m "feat(admin): settings read/write endpoints with typed validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: BFF — test-catalog endpoints

**Files:**
- Modify: `web/server/bff.mjs`
- Modify: `web/server/admin.db.test.mjs`

**Interfaces:**
- Produces:
  - `GET /api/admin/catalog` → `{ stages: [{ code, name, sequence }], tests: [{ id, code, name, domain, requiresNabl, typicalTatDays, isActive, stageCodes: string[] }] }`
  - `POST /api/admin/catalog/tests` body `{ code, name, domain, requiresNabl?, typicalTatDays? }` → 201 test row
  - `PUT /api/admin/catalog/tests/:code` body `{ name?, requiresNabl?, typicalTatDays?, isActive? }` → updated row (code immutable — not accepted in body)
  - `PUT /api/admin/catalog/tests/:code/stages` body `{ stageCodes: string[] }` → `{ code, stageCodes }`

- [ ] **Step 1: Write the failing db tests**

Append to `admin.db.test.mjs` (add cleanup to `beforeEach`: `await probe.query("delete from eworks.test_stage_rules where test_id in (select id from eworks.test_catalog where code = 'DEMO_NEW_TEST')"); await probe.query("delete from eworks.test_catalog where code = 'DEMO_NEW_TEST'")`):

```js
  it('catalog list groups stage mappings; gated by catalog.manage or user.manage', async () => {
    const r = await api(HEAD_ADMIN, 'GET', '/api/admin/catalog');
    expect(r.status).toBe(200);
    expect(r.body.stages.length).toBe(9);
    const cube = r.body.tests.find((t) => t.code === 'CONCRETE_CUBE_STRENGTH');
    expect(cube.stageCodes.length).toBeGreaterThan(0);
  });

  it('creates, edits, and remaps a test — catalog.manage required, audit-logged', async () => {
    const domainQ = await probe.query(
      `select domain::text as d from eworks.test_catalog limit 1`);
    const domain = domainQ.rows[0].d;

    const created = await api(HEAD_ADMIN, 'POST', '/api/admin/catalog/tests', {
      code: 'DEMO_NEW_TEST', name: 'Demo new test', domain, requiresNabl: true, typicalTatDays: 3,
    });
    expect(created.status).toBe(201);

    const edited = await api(HEAD_ADMIN, 'PUT', '/api/admin/catalog/tests/DEMO_NEW_TEST', {
      name: 'Demo renamed', typicalTatDays: 5,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.name).toBe('Demo renamed');

    const mapped = await api(HEAD_ADMIN, 'PUT', '/api/admin/catalog/tests/DEMO_NEW_TEST/stages', {
      stageCodes: ['FOUNDATION', 'SUPERSTRUCTURE'],
    });
    expect(mapped.status).toBe(200);
    expect(mapped.body.stageCodes.sort()).toEqual(['FOUNDATION', 'SUPERSTRUCTURE']);

    const unmapped = await api(HEAD_ADMIN, 'PUT', '/api/admin/catalog/tests/DEMO_NEW_TEST/stages', {
      stageCodes: ['FOUNDATION'],
    });
    expect(unmapped.body.stageCodes).toEqual(['FOUNDATION']);

    const audits = await probe.query(
      `select action from eworks.audit_logs where payload->>'test_code' = 'DEMO_NEW_TEST' order by seq`);
    expect(audits.rows.map((r) => r.action)).toEqual([
      'admin.catalog_test_create', 'admin.catalog_test_update',
      'admin.catalog_stage_map', 'admin.catalog_stage_map',
    ]);
  });

  it('a site engineer cannot edit the catalog', async () => {
    const r = await api(SITE_ENG, 'PUT', '/api/admin/catalog/tests/CONCRETE_CUBE_STRENGTH', {
      name: 'Hacked',
    });
    expect(r.status).toBe(403);
  });

  it('duplicate test code returns 409', async () => {
    const domainQ = await probe.query(`select domain::text as d from eworks.test_catalog limit 1`);
    const r = await api(HEAD_ADMIN, 'POST', '/api/admin/catalog/tests', {
      code: 'CONCRETE_CUBE_STRENGTH', name: 'Dup', domain: domainQ.rows[0].d,
    });
    expect(r.status).toBe(409);
  });
```

Note for the implementer: HEAD_ADMIN must hold `catalog.manage` in the seed for these to pass — verify in `20260709000700_seed_reference_data.sql`; if not, use a fixture user that does.

- [ ] **Step 2: Run to verify they fail** — 4 new FAIL (404).

- [ ] **Step 3: Implement**

```js
  const TEST_CODE_RE = /^[A-Z0-9_]+$/;

  app.get('/api/admin/catalog', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    try {
      const out = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, ['catalog.manage', 'user.manage']);
        const stagesQ = await client.query(
          `select code, name, sequence from eworks.construction_stage order by sequence`,
        );
        const testsQ = await client.query(
          `select tc.id, tc.code, tc.name, tc.domain::text as domain,
                  tc.requires_nabl as "requiresNabl",
                  tc.typical_tat_days as "typicalTatDays",
                  tc.is_active as "isActive",
                  coalesce(array_agg(distinct cs.code)
                           filter (where cs.code is not null), '{}') as "stageCodes"
             from eworks.test_catalog tc
             left join eworks.test_stage_rules tsr
               on tsr.test_id = tc.id and tsr.is_active and tsr.org_unit_id is null
             left join eworks.construction_stage cs on cs.id = tsr.stage_id
            group by tc.id
            order by tc.code`,
        );
        return { stages: stagesQ.rows, tests: testsQ.rows };
      });
      res.json(out);
    } catch (err) {
      res.status(err.httpStatus ?? 500).json({ error: 'admin_catalog_failed', detail: err.message });
    }
  });

  app.post('/api/admin/catalog/tests', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { code, name, domain, requiresNabl, typicalTatDays } = req.body || {};
    if (!TEST_CODE_RE.test(String(code ?? ''))) {
      return res.status(400).json({ error: 'invalid_code', detail: 'test code must be UPPER_SNAKE letters/digits' });
    }
    if (!name || !String(name).trim() || !domain) {
      return res.status(400).json({ error: 'name_and_domain_required', detail: 'name and domain are required' });
    }
    try {
      const row = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'catalog.manage');
        const q = await client.query(
          `insert into eworks.test_catalog (code, name, domain, requires_nabl, typical_tat_days)
           values ($1, $2, $3::eworks.test_domain, coalesce($4, false), coalesce($5, 1))
           returning id, code, name, domain::text as domain,
                     requires_nabl as "requiresNabl",
                     typical_tat_days as "typicalTatDays", is_active as "isActive"`,
          [code, String(name).trim(), domain, requiresNabl ?? null, typicalTatDays ?? null],
        );
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'admin.catalog_test_create', 'test_catalog', $1, null,
                   jsonb_build_object('test_code', $2::text, 'name', $3::text, 'domain', $4::text))`,
          [q.rows[0].id, code, String(name).trim(), domain],
        );
        return q.rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'test_exists', detail: 'a test with this code already exists' });
      }
      if (err.code === '22P02') {
        return res.status(400).json({ error: 'invalid_domain', detail: 'unknown test domain' });
      }
      if (err.code === '42501') {
        return res.status(403).json({ error: 'forbidden', detail: 'requires catalog.manage' });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'catalog_create_failed', detail: err.message });
    }
  });

  app.put('/api/admin/catalog/tests/:code', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { name, requiresNabl, typicalTatDays, isActive } = req.body || {};
    try {
      const row = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'catalog.manage');
        const beforeQ = await client.query(
          `select name, requires_nabl, typical_tat_days, is_active
             from eworks.test_catalog where code = $1`, [req.params.code]);
        if (beforeQ.rowCount === 0) throw httpError(404, 'test not found');
        const q = await client.query(
          `update eworks.test_catalog
              set name = coalesce($2, name),
                  requires_nabl = coalesce($3, requires_nabl),
                  typical_tat_days = coalesce($4, typical_tat_days),
                  is_active = coalesce($5, is_active)
            where code = $1
            returning id, code, name, domain::text as domain,
                      requires_nabl as "requiresNabl",
                      typical_tat_days as "typicalTatDays", is_active as "isActive"`,
          [req.params.code, name ?? null, requiresNabl ?? null, typicalTatDays ?? null, isActive ?? null],
        );
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'admin.catalog_test_update', 'test_catalog', $1, null,
                   jsonb_build_object('test_code', $2::text, 'before', $3::jsonb, 'after', $4::jsonb))`,
          [q.rows[0].id, req.params.code,
           JSON.stringify(beforeQ.rows[0]),
           JSON.stringify({ name: q.rows[0].name, requires_nabl: q.rows[0].requiresNabl,
                            typical_tat_days: q.rows[0].typicalTatDays, is_active: q.rows[0].isActive })],
        );
        return q.rows[0];
      });
      res.json(row);
    } catch (err) {
      res.status(err.httpStatus ?? 400).json({ error: 'catalog_update_failed', detail: err.message });
    }
  });

  app.put('/api/admin/catalog/tests/:code/stages', async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const { stageCodes } = req.body || {};
    if (!Array.isArray(stageCodes)) {
      return res.status(400).json({ error: 'invalid_stages', detail: 'stageCodes must be an array' });
    }
    try {
      const out = await withUserSession(userId, async (client) => {
        await requireAdminPerm(client, 'catalog.manage');
        const tQ = await client.query(
          `select id from eworks.test_catalog where code = $1`, [req.params.code]);
        if (tQ.rowCount === 0) throw httpError(404, 'test not found');
        const testId = tQ.rows[0].id;
        // Unmap: deactivate, never delete — history and scoped overrides stay.
        await client.query(
          `update eworks.test_stage_rules tsr
              set is_active = false
             from eworks.construction_stage cs
            where cs.id = tsr.stage_id and tsr.test_id = $1
              and tsr.org_unit_id is null and tsr.is_active
              and not (cs.code = any($2::text[]))`,
          [testId, stageCodes],
        );
        // Remap: reactivate a previously unmapped rule rather than duplicating
        // (the scope-unique constraint treats NULL org_unit_id rows as distinct).
        await client.query(
          `update eworks.test_stage_rules tsr
              set is_active = true
             from eworks.construction_stage cs
            where cs.id = tsr.stage_id and tsr.test_id = $1
              and tsr.org_unit_id is null and not tsr.is_active
              and cs.code = any($2::text[])`,
          [testId, stageCodes],
        );
        // Map: brand-new statewide rules default to ONCE; frequency is
        // refined later through the rules machinery, not this endpoint.
        await client.query(
          `insert into eworks.test_stage_rules (test_id, stage_id, frequency_type, frequency_spec)
           select $1, cs.id, 'ONCE', '{}'::jsonb
             from eworks.construction_stage cs
            where cs.code = any($2::text[])
              and not exists (select 1 from eworks.test_stage_rules t
                               where t.test_id = $1 and t.stage_id = cs.id
                                 and t.org_unit_id is null)`,
          [testId, stageCodes],
        );
        await client.query(
          `insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
           values (eworks.current_user_id(), 'admin.catalog_stage_map', 'test_stage_rules', $1, null,
                   jsonb_build_object('test_code', $2::text, 'stage_codes', $3::text[]))`,
          [testId, req.params.code, stageCodes],
        );
        return { code: req.params.code, stageCodes };
      });
      res.json(out);
    } catch (err) {
      if (err.code === '42501') {
        return res.status(403).json({ error: 'forbidden', detail: 'requires catalog.manage' });
      }
      res.status(err.httpStatus ?? 400).json({ error: 'catalog_stage_map_failed', detail: err.message });
    }
  });
```

- [ ] **Step 4: Run db tests** — Expected: 23 passed. Then run the full server suite: `cd web && npx vitest run server/` — all green.

- [ ] **Step 5: Commit**

```bash
git add web/server/bff.mjs web/server/admin.db.test.mjs
git commit -m "feat(admin): test-catalog read/create/edit/stage-map endpoints

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend data layer — types, api, hooks

**Files:**
- Modify: `web/src/types/domain.ts` (append after the rate-card block, ~line 318)
- Create: `web/src/features/admin/api.ts`
- Create: `web/src/features/admin/useAdmin.ts`

**Interfaces:**
- Consumes: `apiClient` (`get/post/put/delete`) from `web/src/lib/apiClient.ts`; endpoint shapes from Tasks 2–6.
- Produces (used by Tasks 9–12): types `AdminUserRow`, `AdminRoleGrant`, `AdminRolesResponse`, `AdminSettingRow`, `AdminCatalogResponse`, `AdminCatalogTest`; hooks `useAdminUsers(q)`, `useAdminOrgUnits()`, `useCreateUser()`, `useGrantRole()`, `useRevokeRole()`, `useAdminRoles()`, `useCreateRole()`, `useSetRolePermissions()`, `useAdminSettings()`, `useSetSetting()`, `useAdminCatalog()`, `useCreateTest()`, `useUpdateTest()`, `useSetTestStages()`.

- [ ] **Step 1: Append types to `web/src/types/domain.ts`**

```ts
// --- admin module ---------------------------------------------------------

export interface AdminRoleGrant {
  roleCode: string;
  roleName: string | null;
  orgUnitId: string;
  orgName: string;
  orgLevel: OrgLevel;
  orgPath: string;
}

export interface AdminUserRow {
  userId: string;
  phone: string;
  fullName: string;
  isActive: boolean;
  roles: AdminRoleGrant[];
}

export interface AdminOrgUnit {
  id: string;
  name: string;
  level: OrgLevel;
  path: string;
}

export interface AdminRole {
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
}

export interface AdminRolesResponse {
  roles: AdminRole[];
  permissions: { code: string; description: string }[];
}

export interface AdminSettingRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface AdminCatalogTest {
  id: string;
  code: string;
  name: string;
  domain: string;
  requiresNabl: boolean;
  typicalTatDays: number;
  isActive: boolean;
  stageCodes: string[];
}

export interface AdminCatalogResponse {
  stages: { code: string; name: string; sequence: number }[];
  tests: AdminCatalogTest[];
}
```

- [ ] **Step 2: Create `web/src/features/admin/api.ts`**

```ts
import { apiClient } from '@/lib/apiClient';
import type {
  AdminCatalogResponse, AdminCatalogTest, AdminOrgUnit, AdminRole,
  AdminRolesResponse, AdminSettingRow, AdminUserRow,
} from '@/types/domain';

export const adminKeys = {
  users: (q: string) => ['admin', 'users', q] as const,
  orgUnits: ['admin', 'org-units'] as const,
  roles: ['admin', 'roles'] as const,
  settings: ['admin', 'settings'] as const,
  catalog: ['admin', 'catalog'] as const,
};

export const fetchAdminUsers = (q: string) =>
  apiClient.get<AdminUserRow[]>(`/api/admin/users?q=${encodeURIComponent(q)}`);
export const fetchAdminOrgUnits = () =>
  apiClient.get<AdminOrgUnit[]>('/api/admin/org-units');
export const createUser = (body: { fullName: string; phone: string; orgUnitId: string; roleCode: string }) =>
  apiClient.post<{ userId: string }>('/api/admin/users', body);
export const grantRole = (userId: string, body: { roleCode: string; orgUnitId: string }) =>
  apiClient.post<{ id: string }>(`/api/admin/users/${userId}/roles`, body);
export const revokeRole = (userId: string, roleCode: string, orgUnitId: string) =>
  apiClient.delete<{ revoked: boolean }>(
    `/api/admin/users/${userId}/roles/${roleCode}?orgUnitId=${orgUnitId}`);

export const fetchAdminRoles = () => apiClient.get<AdminRolesResponse>('/api/admin/roles');
export const createRole = (body: { code: string; name: string; description?: string; permissions: string[] }) =>
  apiClient.post<AdminRole>('/api/admin/roles', body);
export const setRolePermissions = (code: string, permissions: string[]) =>
  apiClient.put<{ code: string; permissions: string[] }>(
    `/api/admin/roles/${code}/permissions`, { permissions });

export const fetchAdminSettings = () => apiClient.get<AdminSettingRow[]>('/api/admin/settings');
export const setSetting = (key: string, value: unknown) =>
  apiClient.put<AdminSettingRow>(`/api/admin/settings/${key}`, { value });

export const fetchAdminCatalog = () => apiClient.get<AdminCatalogResponse>('/api/admin/catalog');
export const createTest = (body: { code: string; name: string; domain: string; requiresNabl?: boolean; typicalTatDays?: number }) =>
  apiClient.post<AdminCatalogTest>('/api/admin/catalog/tests', body);
export const updateTest = (code: string, body: { name?: string; requiresNabl?: boolean; typicalTatDays?: number; isActive?: boolean }) =>
  apiClient.put<AdminCatalogTest>(`/api/admin/catalog/tests/${code}`, body);
export const setTestStages = (code: string, stageCodes: string[]) =>
  apiClient.put<{ code: string; stageCodes: string[] }>(
    `/api/admin/catalog/tests/${code}/stages`, { stageCodes });
```

- [ ] **Step 3: Create `web/src/features/admin/useAdmin.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminKeys, createRole, createTest, createUser, fetchAdminCatalog,
  fetchAdminOrgUnits, fetchAdminRoles, fetchAdminSettings, fetchAdminUsers,
  grantRole, revokeRole, setRolePermissions, setSetting, setTestStages, updateTest,
} from './api';

export const useAdminUsers = (q: string) =>
  useQuery({ queryKey: adminKeys.users(q), queryFn: () => fetchAdminUsers(q) });
export const useAdminOrgUnits = () =>
  useQuery({ queryKey: adminKeys.orgUnits, queryFn: fetchAdminOrgUnits, staleTime: 5 * 60_000 });
export const useAdminRoles = () =>
  useQuery({ queryKey: adminKeys.roles, queryFn: fetchAdminRoles });
export const useAdminSettings = () =>
  useQuery({ queryKey: adminKeys.settings, queryFn: fetchAdminSettings });
export const useAdminCatalog = () =>
  useQuery({ queryKey: adminKeys.catalog, queryFn: fetchAdminCatalog });

function useInvalidating<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>, keys: readonly (readonly unknown[])[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => fn(...args),
    onSuccess: () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k as unknown[] })),
  });
}

export const useCreateUser = () =>
  useInvalidating((body: Parameters<typeof createUser>[0]) => createUser(body), [['admin', 'users']]);
export const useGrantRole = () =>
  useInvalidating((userId: string, body: { roleCode: string; orgUnitId: string }) =>
    grantRole(userId, body), [['admin', 'users']]);
export const useRevokeRole = () =>
  useInvalidating((userId: string, roleCode: string, orgUnitId: string) =>
    revokeRole(userId, roleCode, orgUnitId), [['admin', 'users']]);
export const useCreateRole = () =>
  useInvalidating((body: Parameters<typeof createRole>[0]) => createRole(body), [adminKeys.roles]);
export const useSetRolePermissions = () =>
  useInvalidating((code: string, permissions: string[]) =>
    setRolePermissions(code, permissions), [adminKeys.roles]);
export const useSetSetting = () =>
  useInvalidating((key: string, value: unknown) => setSetting(key, value), [adminKeys.settings]);
export const useCreateTest = () =>
  useInvalidating((body: Parameters<typeof createTest>[0]) => createTest(body), [adminKeys.catalog]);
export const useUpdateTest = () =>
  useInvalidating((code: string, body: Parameters<typeof updateTest>[1]) =>
    updateTest(code, body), [adminKeys.catalog]);
export const useSetTestStages = () =>
  useInvalidating((code: string, stageCodes: string[]) =>
    setTestStages(code, stageCodes), [adminKeys.catalog]);
```

Note the mutation call convention this produces: `mutate([arg1, arg2])` — a single tuple argument (e.g. `grantRoleMutation.mutate([userId, { roleCode, orgUnitId }])`). Tabs in Tasks 9–12 use exactly that form.

- [ ] **Step 4: Verify it compiles**

Run: `cd web && npx tsc -b`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/types/domain.ts web/src/features/admin/api.ts web/src/features/admin/useAdmin.ts
git commit -m "feat(admin): frontend data layer for the admin module

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Admin shell — route, nav, i18n, permission-gated tabs

**Files:**
- Create: `web/src/features/admin/AdminPage.tsx`
- Modify: `web/src/App.tsx` (add route under `/gov`)
- Modify: `web/src/lib/navConfig.ts` (add GOV_ALL item)
- Modify: `web/src/lib/navIcons.tsx` (icon for `nav.admin` — follow the existing icon map pattern; use lucide `Settings`)
- Modify: `web/src/i18n/en.json`, `web/src/i18n/ta.json` (new `admin` namespace + `nav.admin`)
- Create: `web/src/features/admin/admin.test.tsx`

**Interfaces:**
- Consumes: `useSession` (`@/auth/useSession`), `hasPermission` (`@/auth/permissions`), hooks from Task 7.
- Produces: `AdminPage` (default tab = first visible one); tab components imported from `./UsersTab`, `./RolesTab`, `./SettingsTab`, `./CatalogTab` (Tasks 9–12 — create them as stubs here so the shell compiles, each stub rendering `<FeedSkeleton />` replaced in its own task).

- [ ] **Step 1: Write the failing test**

Create `web/src/features/admin/admin.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import type { Session } from '@/types/domain';

const sessionState: { session: Session } = {
  session: { authenticated: true, permissions: ['user.manage', 'catalog.manage'], roles: [] },
};

vi.mock('@/auth/useSession', () => ({
  useSession: () => ({ data: sessionState.session, isPending: false }),
}));
vi.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(async () => []),
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  },
}));

const { AdminPage } = await import('./AdminPage');

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminPage tab gating', () => {
  it('shows all four tabs with both permissions', () => {
    sessionState.session = { authenticated: true, permissions: ['user.manage', 'catalog.manage'], roles: [] };
    renderPage();
    expect(screen.getByRole('tab', { name: /users/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /roles/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /catalog/i })).toBeInTheDocument();
  });

  it('hides user/role/settings tabs without user.manage', () => {
    sessionState.session = { authenticated: true, permissions: ['catalog.manage'], roles: [] };
    renderPage();
    expect(screen.queryByRole('tab', { name: /users/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /settings/i })).toBeNull();
    expect(screen.getByRole('tab', { name: /catalog/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/features/admin/admin.test.tsx`
Expected: FAIL — `./AdminPage` does not exist.

- [ ] **Step 3: Add i18n strings**

In `web/src/i18n/en.json`, add `"admin"` to `nav` and a top-level `admin` namespace:

```json
"nav": { "...existing keys unchanged...": "", "admin": "Admin" },
"admin": {
  "title": "Administration",
  "tabUsers": "Users & roles",
  "tabRoles": "Roles & permissions",
  "tabSettings": "Settings",
  "tabCatalog": "Test catalog",
  "searchUsers": "Search by name or phone",
  "addUser": "Add user",
  "fullName": "Full name",
  "phone": "Phone",
  "orgUnit": "Org unit",
  "role": "Role",
  "grantRole": "Grant role",
  "revokeRole": "Remove",
  "lastHeadAdmin": "You cannot remove the last head admin.",
  "userCreated": "User added. They can sign in with their phone number.",
  "addRole": "Add role",
  "roleCode": "Code (UPPER_SNAKE, cannot be changed later)",
  "roleName": "Name",
  "roleDescription": "Description",
  "builtinWarning": "This is a built-in role. Changing its permissions affects every user who holds it.",
  "savePermissions": "Save permissions",
  "settingSaved": "Saved.",
  "editJson": "Edit as JSON",
  "invalidJson": "This is not valid JSON.",
  "addTest": "Add test",
  "testCode": "Code (cannot be changed later)",
  "testName": "Test name",
  "domain": "Domain",
  "tatDays": "Turnaround (days)",
  "requiresNabl": "Needs NABL accreditation",
  "activeFlag": "Active",
  "stages": "Stages",
  "saveStages": "Save stage mapping",
  "noAccess": "You do not have access to this section.",
  "settingLabels": {
    "vendor_max_service_radius_km": "Maximum vendor service radius (km)",
    "geofence_radius_m": "Check-in geofence radius (metres)",
    "geofence_max_accuracy_m": "Maximum GPS accuracy accepted (metres)",
    "max_clock_skew_seconds": "Maximum device clock skew (seconds)"
  }
}
```

In `web/src/i18n/ta.json`, the same keys in Tamil:

```json
"nav": { "admin": "நிர்வாகம்" },
"admin": {
  "title": "நிர்வாகம்",
  "tabUsers": "பயனர்கள் & பங்குகள்",
  "tabRoles": "பங்குகள் & அனுமதிகள்",
  "tabSettings": "அமைப்புகள்",
  "tabCatalog": "சோதனை பட்டியல்",
  "searchUsers": "பெயர் அல்லது தொலைபேசி எண்ணால் தேடுங்கள்",
  "addUser": "பயனரைச் சேர்",
  "fullName": "முழுப் பெயர்",
  "phone": "தொலைபேசி",
  "orgUnit": "அலுவலக அலகு",
  "role": "பங்கு",
  "grantRole": "பங்கு வழங்கு",
  "revokeRole": "நீக்கு",
  "lastHeadAdmin": "கடைசி தலைமை நிர்வாகியை நீக்க முடியாது.",
  "userCreated": "பயனர் சேர்க்கப்பட்டார். தொலைபேசி எண்ணுடன் உள்நுழையலாம்.",
  "addRole": "பங்கைச் சேர்",
  "roleCode": "குறியீடு (UPPER_SNAKE, பின்னர் மாற்ற முடியாது)",
  "roleName": "பெயர்",
  "roleDescription": "விளக்கம்",
  "builtinWarning": "இது உள்ளமைந்த பங்கு. அனுமதிகளை மாற்றினால் அதை வைத்திருக்கும் எல்லா பயனர்களுக்கும் பாதிப்பு ஏற்படும்.",
  "savePermissions": "அனுமதிகளைச் சேமி",
  "settingSaved": "சேமிக்கப்பட்டது.",
  "editJson": "JSON ஆக திருத்து",
  "invalidJson": "இது சரியான JSON அல்ல.",
  "addTest": "சோதனையைச் சேர்",
  "testCode": "குறியீடு (பின்னர் மாற்ற முடியாது)",
  "testName": "சோதனை பெயர்",
  "domain": "துறை",
  "tatDays": "முடிக்க நாட்கள்",
  "requiresNabl": "NABL அங்கீகாரம் தேவை",
  "activeFlag": "செயலில்",
  "stages": "கட்டங்கள்",
  "saveStages": "கட்ட வரைபடத்தைச் சேமி",
  "noAccess": "இந்தப் பகுதிக்கு உங்களுக்கு அணுகல் இல்லை.",
  "settingLabels": {
    "vendor_max_service_radius_km": "விற்பனையாளர் சேவை ஆரம் உச்சவரம்பு (கி.மீ)",
    "geofence_radius_m": "செக்-இன் புவிவேலி ஆரம் (மீட்டர்)",
    "geofence_max_accuracy_m": "ஏற்கத்தக்க GPS துல்லிய உச்சவரம்பு (மீட்டர்)",
    "max_clock_skew_seconds": "சாதன கடிகார பிழை உச்சவரம்பு (வினாடிகள்)"
  }
}
```

- [ ] **Step 4: Create `AdminPage.tsx` + tab stubs**

`web/src/features/admin/AdminPage.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/auth/useSession';
import { hasPermission } from '@/auth/permissions';
import { UsersTab } from './UsersTab';
import { RolesTab } from './RolesTab';
import { SettingsTab } from './SettingsTab';
import { CatalogTab } from './CatalogTab';

type TabKey = 'users' | 'roles' | 'settings' | 'catalog';

export function AdminPage() {
  const { t } = useTranslation();
  const { data: session } = useSession();

  const tabs = useMemo(() => {
    const canUsers = hasPermission(session, 'user.manage');
    const canCatalog = hasPermission(session, ['user.manage', 'catalog.manage']);
    const list: { key: TabKey; label: string }[] = [];
    if (canUsers) {
      list.push({ key: 'users', label: t('admin.tabUsers') });
      list.push({ key: 'roles', label: t('admin.tabRoles') });
      list.push({ key: 'settings', label: t('admin.tabSettings') });
    }
    if (canCatalog) list.push({ key: 'catalog', label: t('admin.tabCatalog') });
    return list;
  }, [session, t]);

  const [active, setActive] = useState<TabKey | null>(null);
  const current = active ?? tabs[0]?.key ?? null;

  if (tabs.length === 0) {
    return <section className="gov-card p-6 text-sm text-ink-2">{t('admin.noAccess')}</section>;
  }

  return (
    <section className="space-y-4">
      <h2 className="font-display text-xl font-bold text-ink">{t('admin.title')}</h2>
      <div role="tablist" aria-label={t('admin.title')} className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={current === tab.key}
            onClick={() => setActive(tab.key)}
            className={current === tab.key ? 'gov-btn-primary' : 'gov-btn-secondary'}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {current === 'users' && <UsersTab />}
        {current === 'roles' && <RolesTab />}
        {current === 'settings' && <SettingsTab />}
        {current === 'catalog' && <CatalogTab />}
      </div>
    </section>
  );
}
```

Create four stubs so this compiles (each replaced by its own task) — e.g. `web/src/features/admin/UsersTab.tsx`:

```tsx
import { FeedSkeleton } from '@/components/Skeleton';

export function UsersTab() {
  return <FeedSkeleton />;
}
```

…and identical stubs exporting `RolesTab`, `SettingsTab`, `CatalogTab` in their own files.

Check `hasPermission`'s array semantics in `web/src/auth/permissions.ts` first: if an array argument means "all required" rather than "any", write the any-of check inline (`['user.manage','catalog.manage'].some((p) => hasPermission(session, p))`) both here and in navConfig.

- [ ] **Step 5: Wire route + nav**

`web/src/App.tsx` — import `AdminPage` and add under the `/gov` route block (after `audit`):

```tsx
<Route path="admin" element={<AdminPage />} />
```

`web/src/lib/navConfig.ts` — append to `GOV_ALL`:

```ts
{ to: '/gov/admin', labelKey: 'nav.admin', requiresPermission: ['user.manage', 'catalog.manage'] },
```

`web/src/lib/navIcons.tsx` — add a `'nav.admin'` entry using the lucide `Settings` icon, following the file's existing map shape.

Add a nav test to `web/src/lib/navConfig.test.ts` following its existing style: a session with only `order.read` must NOT see `/gov/admin`; a session with `user.manage` must.

- [ ] **Step 6: Run tests**

Run: `cd web && npx vitest run src/features/admin/admin.test.tsx src/lib/navConfig.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/admin web/src/App.tsx web/src/lib/navConfig.ts web/src/lib/navConfig.test.ts web/src/lib/navIcons.tsx web/src/i18n/en.json web/src/i18n/ta.json
git commit -m "feat(admin): /gov/admin shell with permission-gated tabs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: UsersTab — list, search, add user, grant/revoke

**Files:**
- Modify: `web/src/features/admin/UsersTab.tsx` (replace stub)
- Modify: `web/src/features/admin/admin.test.tsx` (append a describe block)

**Interfaces:**
- Consumes: `useAdminUsers`, `useAdminOrgUnits`, `useAdminRoles`, `useCreateUser`, `useGrantRole`, `useRevokeRole` from Task 7 (tuple-arg `mutate([...])` convention); `FeedSkeleton`; `StatusPill`; `ApiError` from `@/lib/apiClient`.

- [ ] **Step 1: Write the failing test**

Append to `admin.test.tsx` (extend the apiClient mock at the top of the file so `get` answers per-path instead of always `[]`):

```tsx
// Replace the get mock line in the vi.mock('@/lib/apiClient') factory with:
    get: vi.fn(async (path: string) => {
      if (path.startsWith('/api/admin/users')) {
        return [{
          userId: 'u1', phone: '9000000004', fullName: 'Coimbatore Section Engineer', isActive: true,
          roles: [{ roleCode: 'SITE_ENGINEER', roleName: 'Site engineer (JE/AE)',
                    orgUnitId: 'o6', orgName: 'Coimbatore Section 1', orgLevel: 'SECTION',
                    orgPath: 'TN.COIMBATORE' }],
        }];
      }
      if (path === '/api/admin/org-units') {
        return [{ id: 'o2', name: 'Coimbatore', level: 'DISTRICT', path: 'TN.COIMBATORE' }];
      }
      if (path === '/api/admin/roles') {
        return { roles: [{ code: 'SITE_ENGINEER', name: 'Site engineer (JE/AE)', description: null, permissions: [] }], permissions: [] };
      }
      if (path === '/api/admin/settings') return [];
      if (path === '/api/admin/catalog') return { stages: [], tests: [] };
      return [];
    }),
```

```tsx
describe('UsersTab', () => {
  it('lists users with their role grants and shows the add-user form', async () => {
    sessionState.session = { authenticated: true, permissions: ['user.manage'], roles: [] };
    renderPage();
    expect(await screen.findByText('Coimbatore Section Engineer')).toBeInTheDocument();
    expect(screen.getByText(/Site engineer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/features/admin/admin.test.tsx`; the stub renders a skeleton, so `findByText` times out → FAIL.

- [ ] **Step 3: Implement `UsersTab.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { StatusPill } from '@/components/StatusPill';
import { ApiError } from '@/lib/apiClient';
import {
  useAdminOrgUnits, useAdminRoles, useAdminUsers,
  useCreateUser, useGrantRole, useRevokeRole,
} from './useAdmin';

export function UsersTab() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const users = useAdminUsers(q);
  const orgUnits = useAdminOrgUnits();
  const roles = useAdminRoles();
  const createUser = useCreateUser();
  const grantRole = useGrantRole();
  const revokeRole = useRevokeRole();

  const [form, setForm] = useState({ fullName: '', phone: '', orgUnitId: '', roleCode: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    createUser.mutate([form], {
      onSuccess: () => {
        setNotice(t('admin.userCreated'));
        setForm({ fullName: '', phone: '', orgUnitId: '', roleCode: '' });
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
    });
  };

  const revoke = (userId: string, roleCode: string, orgUnitId: string) => {
    setError(null);
    revokeRole.mutate([userId, roleCode, orgUnitId], {
      onError: (err) => setError(
        err instanceof ApiError && err.message.includes('last head admin')
          ? t('admin.lastHeadAdmin')
          : err instanceof ApiError ? err.message : String(err)),
    });
  };

  if (users.isPending || orgUnits.isPending || roles.isPending) return <FeedSkeleton />;

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="gov-card space-y-3 p-4">
        <h3 className="font-display text-base font-bold text-ink">{t('admin.addUser')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            {t('admin.fullName')}
            <input required value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              className="gov-input mt-1 w-full" />
          </label>
          <label className="text-sm">
            {t('admin.phone')}
            <input required inputMode="numeric" pattern="[6-9][0-9]{9}" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="gov-input mt-1 w-full" />
          </label>
          <label className="text-sm">
            {t('admin.orgUnit')}
            <select required value={form.orgUnitId}
              onChange={(e) => setForm({ ...form, orgUnitId: e.target.value })}
              className="gov-input mt-1 w-full">
              <option value="" />
              {orgUnits.data?.map((o) => (
                <option key={o.id} value={o.id}>{o.name} ({o.level})</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t('admin.role')}
            <select required value={form.roleCode}
              onChange={(e) => setForm({ ...form, roleCode: e.target.value })}
              className="gov-input mt-1 w-full">
              <option value="" />
              {roles.data?.roles.map((r) => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {notice && <p role="status" className="text-sm text-success">{notice}</p>}
        <button type="submit" disabled={createUser.isPending} className="gov-btn-primary">
          {t('admin.addUser')}
        </button>
      </form>

      <input
        type="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={t('admin.searchUsers')} aria-label={t('admin.searchUsers')}
        className="gov-input w-full"
      />

      <ul className="space-y-2">
        {users.data?.map((u) => (
          <li key={u.userId} className="gov-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-ink">{u.fullName}</span>
              <span className="text-sm text-ink-2">{u.phone}</span>
            </div>
            <ul className="mt-2 space-y-1">
              {u.roles.map((g) => (
                <li key={`${g.roleCode}-${g.orgUnitId}`} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    <StatusPill tone="accent">{g.roleName ?? g.roleCode}</StatusPill>
                    <span className="ml-2 text-ink-2">{g.orgName}</span>
                  </span>
                  <button type="button" className="gov-btn-secondary"
                    onClick={() => revoke(u.userId, g.roleCode, g.orgUnitId)}>
                    {t('admin.revokeRole')}
                  </button>
                </li>
              ))}
            </ul>
            <GrantForm
              userId={u.userId}
              onGrant={(roleCode, orgUnitId) => grantRole.mutate([u.userId, { roleCode, orgUnitId }])}
              roleOptions={roles.data?.roles ?? []}
              orgOptions={orgUnits.data ?? []}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function GrantForm(props: {
  userId: string;
  onGrant: (roleCode: string, orgUnitId: string) => void;
  roleOptions: { code: string; name: string }[];
  orgOptions: { id: string; name: string; level: string }[];
}) {
  const { t } = useTranslation();
  const [roleCode, setRoleCode] = useState('');
  const [orgUnitId, setOrgUnitId] = useState('');
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => { e.preventDefault(); if (roleCode && orgUnitId) props.onGrant(roleCode, orgUnitId); }}
    >
      <select aria-label={t('admin.role')} value={roleCode}
        onChange={(e) => setRoleCode(e.target.value)} className="gov-input text-sm">
        <option value="" />
        {props.roleOptions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
      </select>
      <select aria-label={t('admin.orgUnit')} value={orgUnitId}
        onChange={(e) => setOrgUnitId(e.target.value)} className="gov-input text-sm">
        <option value="" />
        {props.orgOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <button type="submit" className="gov-btn-secondary text-sm">{t('admin.grantRole')}</button>
    </form>
  );
}
```

If `gov-input` does not exist in `web/src/index.css`, use the input classes the KYC wizard uses (check `OnboardingWizard.tsx` step 0) — do not invent a new utility.

- [ ] **Step 4: Run tests** — `npx vitest run src/features/admin/admin.test.tsx` → PASS; then `npx tsc -b` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/admin/UsersTab.tsx web/src/features/admin/admin.test.tsx
git commit -m "feat(admin): users tab — search, add user, grant/revoke roles

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: RolesTab — permission matrix + add role

**Files:**
- Modify: `web/src/features/admin/RolesTab.tsx` (replace stub)
- Modify: `web/src/features/admin/admin.test.tsx`

**Interfaces:**
- Consumes: `useAdminRoles`, `useCreateRole`, `useSetRolePermissions` from Task 7. Built-in role codes (warning banner, no code edits): `FIELD_TECHNICIAN, LAB_VENDOR, SITE_ENGINEER, EXECUTIVE_ENGINEER, DISTRICT_OFFICER, AUDITOR, HEAD_ADMIN, AI_SERVICE, CONTRACTOR`.

- [ ] **Step 1: Write the failing test**

Extend the `/api/admin/roles` branch of the apiClient mock to return a real matrix:

```tsx
      if (path === '/api/admin/roles') {
        return {
          roles: [
            { code: 'HEAD_ADMIN', name: 'Head admin (department)', description: null,
              permissions: ['user.manage', 'audit.read_all'] },
            { code: 'AUDITOR', name: 'Auditor', description: null, permissions: ['audit.read'] },
          ],
          permissions: [
            { code: 'user.manage', description: 'Manage users' },
            { code: 'audit.read', description: 'Read audit log in scope' },
            { code: 'audit.read_all', description: 'Read audit log statewide' },
          ],
        };
      }
```

```tsx
describe('RolesTab', () => {
  it('renders the matrix with checked cells and a built-in warning', async () => {
    sessionState.session = { authenticated: true, permissions: ['user.manage'], roles: [] };
    renderPage();
    const rolesTab = await screen.findByRole('tab', { name: /roles/i });
    rolesTab.click();
    expect(await screen.findByRole('checkbox', { name: 'HEAD_ADMIN user.manage' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'AUDITOR user.manage' })).not.toBeChecked();
    expect(screen.getAllByText(/built-in role/i).length).toBeGreaterThan(0);
  });
});
```

(Use `fireEvent.click(rolesTab)` from `@testing-library/react` if plain `.click()` doesn't flush — import it at the top.)

- [ ] **Step 2: Run to verify it fails** — stub has no checkboxes → FAIL.

- [ ] **Step 3: Implement `RolesTab.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { ApiError } from '@/lib/apiClient';
import { useAdminRoles, useCreateRole, useSetRolePermissions } from './useAdmin';

const BUILTIN_ROLES = new Set([
  'FIELD_TECHNICIAN', 'LAB_VENDOR', 'SITE_ENGINEER', 'EXECUTIVE_ENGINEER',
  'DISTRICT_OFFICER', 'AUDITOR', 'HEAD_ADMIN', 'AI_SERVICE', 'CONTRACTOR',
]);

export function RolesTab() {
  const { t } = useTranslation();
  const { data, isPending } = useAdminRoles();
  const setPerms = useSetRolePermissions();
  const createRole = useCreateRole();

  // Local draft of the matrix; “Save permissions” per row keeps writes explicit.
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState({ code: '', name: '', description: '' });

  useEffect(() => {
    if (!data) return;
    setDraft(Object.fromEntries(data.roles.map((r) => [r.code, new Set(r.permissions)])));
  }, [data]);

  if (isPending || !data) return <FeedSkeleton />;

  const toggle = (roleCode: string, perm: string) => {
    setDraft((d) => {
      const next = new Set(d[roleCode]);
      if (next.has(perm)) next.delete(perm); else next.add(perm);
      return { ...d, [roleCode]: next };
    });
  };

  const save = (roleCode: string) => {
    setError(null);
    setPerms.mutate([roleCode, [...(draft[roleCode] ?? [])].sort()], {
      onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
    });
  };

  const dirty = (roleCode: string) => {
    const server = data.roles.find((r) => r.code === roleCode)?.permissions ?? [];
    const local = [...(draft[roleCode] ?? [])];
    return server.length !== local.length || server.some((p) => !draft[roleCode]?.has(p));
  };

  const submitNewRole = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    createRole.mutate([{ ...newRole, permissions: [] }], {
      onSuccess: () => setNewRole({ code: '', name: '', description: '' }),
      onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
    });
  };

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <div className="gov-card overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th scope="col" className="text-left">{t('admin.role')}</th>
              {data.permissions.map((p) => (
                <th key={p.code} scope="col" title={p.description}
                  className="px-1 text-left align-bottom" style={{ writingMode: 'vertical-rl' }}>
                  {p.code}
                </th>
              ))}
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {data.roles.map((role) => (
              <tr key={role.code} className="border-t border-hair">
                <th scope="row" className="py-2 pr-2 text-left font-semibold">
                  {role.name}
                  {BUILTIN_ROLES.has(role.code) && (
                    <span className="block text-xs font-normal text-warn">{t('admin.builtinWarning')}</span>
                  )}
                </th>
                {data.permissions.map((p) => (
                  <td key={p.code} className="px-1 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${role.code} ${p.code}`}
                      checked={draft[role.code]?.has(p.code) ?? false}
                      onChange={() => toggle(role.code, p.code)}
                    />
                  </td>
                ))}
                <td className="pl-2">
                  {dirty(role.code) && (
                    <button type="button" className="gov-btn-secondary text-xs"
                      onClick={() => save(role.code)} disabled={setPerms.isPending}>
                      {t('admin.savePermissions')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={submitNewRole} className="gov-card space-y-3 p-4">
        <h3 className="font-display text-base font-bold text-ink">{t('admin.addRole')}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            {t('admin.roleCode')}
            <input required pattern="[A-Z_]+" value={newRole.code}
              onChange={(e) => setNewRole({ ...newRole, code: e.target.value.toUpperCase() })}
              className="gov-input mt-1 w-full" />
          </label>
          <label className="text-sm">
            {t('admin.roleName')}
            <input required value={newRole.name}
              onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
              className="gov-input mt-1 w-full" />
          </label>
          <label className="text-sm">
            {t('admin.roleDescription')}
            <input value={newRole.description}
              onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
              className="gov-input mt-1 w-full" />
          </label>
        </div>
        <button type="submit" disabled={createRole.isPending} className="gov-btn-primary">
          {t('admin.addRole')}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run tests** — admin suite + `tsc -b` green.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/admin/RolesTab.tsx web/src/features/admin/admin.test.tsx
git commit -m "feat(admin): roles tab — permission matrix and add-role form

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: SettingsTab — typed inputs + JSON fallback

**Files:**
- Modify: `web/src/features/admin/SettingsTab.tsx` (replace stub)
- Modify: `web/src/features/admin/admin.test.tsx`

**Interfaces:**
- Consumes: `useAdminSettings`, `useSetSetting` from Task 7. Known keys get friendly labels from `t('admin.settingLabels.<key>')` and a number input; unknown keys fall back to a JSON textarea.

- [ ] **Step 1: Write the failing test**

Extend the `/api/admin/settings` mock branch:

```tsx
      if (path === '/api/admin/settings') {
        return [
          { key: 'geofence_radius_m', value: 150, updatedAt: '2026-07-01T00:00:00Z' },
          { key: 'mystery_flag', value: { on: true }, updatedAt: '2026-07-01T00:00:00Z' },
        ];
      }
```

```tsx
describe('SettingsTab', () => {
  it('renders a labelled number input for known keys and JSON for unknown', async () => {
    sessionState.session = { authenticated: true, permissions: ['user.manage'], roles: [] };
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: /settings/i }));
    const known = await screen.findByLabelText(/geofence radius/i);
    expect(known).toHaveValue(150);
    expect(screen.getByLabelText('mystery_flag')).toHaveValue('{"on":true}');
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `SettingsTab.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { ApiError } from '@/lib/apiClient';
import type { AdminSettingRow } from '@/types/domain';
import { useAdminSettings, useSetSetting } from './useAdmin';

const KNOWN_NUMBER_KEYS = new Set([
  'vendor_max_service_radius_km', 'geofence_radius_m',
  'geofence_max_accuracy_m', 'max_clock_skew_seconds',
]);

export function SettingsTab() {
  const { t } = useTranslation();
  const { data, isPending } = useAdminSettings();

  if (isPending || !data) return <FeedSkeleton />;
  if (data.length === 0) {
    return <div className="gov-card p-6 text-center text-sm text-ink-2">{t('states.emptyTitle')}</div>;
  }

  return (
    <ul className="space-y-3">
      {data.map((row) => <SettingRow key={row.key} row={row} />)}
    </ul>
  );
}

function SettingRow({ row }: { row: AdminSettingRow }) {
  const { t } = useTranslation();
  const setSetting = useSetSetting();
  const known = KNOWN_NUMBER_KEYS.has(row.key);
  const [text, setText] = useState(known ? String(row.value) : JSON.stringify(row.value));
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const label = known ? t(`admin.settingLabels.${row.key}`) : row.key;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    let value: unknown;
    if (known) {
      value = Number(text);
    } else {
      try {
        value = JSON.parse(text);
      } catch {
        setState('error');
        setMessage(t('admin.invalidJson'));
        return;
      }
    }
    setSetting.mutate([row.key, value], {
      onSuccess: () => { setState('saved'); setMessage(t('admin.settingSaved')); },
      onError: (err) => {
        setState('error');
        setMessage(err instanceof ApiError ? err.message : String(err));
      },
    });
  };

  return (
    <li className="gov-card p-4">
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <label className="grow text-sm">
          {label}
          {known ? (
            <input type="number" value={text} onChange={(e) => { setText(e.target.value); setState('idle'); }}
              className="gov-input mt-1 w-full" />
          ) : (
            <textarea rows={2} value={text} onChange={(e) => { setText(e.target.value); setState('idle'); }}
              className="gov-input mt-1 w-full font-mono text-xs" />
          )}
        </label>
        <button type="submit" disabled={setSetting.isPending} className="gov-btn-secondary">
          {t('admin.settingSaved') === message && state === 'saved' ? '✓' : t('states.retry') === '' ? '' : 'Save'}
        </button>
      </form>
      {state !== 'idle' && (
        <p role={state === 'error' ? 'alert' : 'status'}
          className={`mt-2 text-sm ${state === 'error' ? 'text-danger' : 'text-success'}`}>
          {message}
        </p>
      )}
    </li>
  );
}
```

Correction the implementer must apply: the Save button label above is wrong — add `"save": "Save"` (en) / `"save": "சேமி"` (ta) to the `admin` namespace and render `{t('admin.save')}` instead of that conditional. (Left explicit here so it isn't silently reinvented.)

- [ ] **Step 4: Run tests** — admin suite + `tsc -b` green.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/admin/SettingsTab.tsx web/src/features/admin/admin.test.tsx web/src/i18n/en.json web/src/i18n/ta.json
git commit -m "feat(admin): settings tab with typed inputs and JSON fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: CatalogTab — grouped read view + gated editing

**Files:**
- Modify: `web/src/features/admin/CatalogTab.tsx` (replace stub)
- Modify: `web/src/features/admin/admin.test.tsx`

**Interfaces:**
- Consumes: `useAdminCatalog`, `useCreateTest`, `useUpdateTest`, `useSetTestStages` from Task 7; `hasPermission` for the `catalog.manage` edit gate (read view renders for `user.manage`-only admins with edit controls hidden).

- [ ] **Step 1: Write the failing test**

Extend the `/api/admin/catalog` mock branch:

```tsx
      if (path === '/api/admin/catalog') {
        return {
          stages: [
            { code: 'FOUNDATION', name: 'Foundation', sequence: 30 },
            { code: 'SUPERSTRUCTURE', name: 'Superstructure', sequence: 50 },
          ],
          tests: [{
            id: 't1', code: 'CONCRETE_CUBE_STRENGTH', name: 'Cube compressive strength',
            domain: 'CONCRETE', requiresNabl: true, typicalTatDays: 28, isActive: true,
            stageCodes: ['FOUNDATION', 'SUPERSTRUCTURE'],
          }],
        };
      }
```

```tsx
describe('CatalogTab', () => {
  it('shows tests grouped by stage; edit controls only with catalog.manage', async () => {
    sessionState.session = { authenticated: true, permissions: ['user.manage'], roles: [] };
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: /catalog/i }));
    expect(await screen.findByText('Cube compressive strength')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add test/i })).toBeNull();

    sessionState.session = { authenticated: true, permissions: ['user.manage', 'catalog.manage'], roles: [] };
    renderPage();
    fireEvent.click(await screen.findAllByRole('tab', { name: /catalog/i }).then((tabs) => tabs.at(-1)!));
    expect((await screen.findAllByRole('button', { name: /add test/i })).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `CatalogTab.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/auth/useSession';
import { hasPermission } from '@/auth/permissions';
import { FeedSkeleton } from '@/components/Skeleton';
import { ApiError } from '@/lib/apiClient';
import type { AdminCatalogTest } from '@/types/domain';
import { useAdminCatalog, useCreateTest, useSetTestStages, useUpdateTest } from './useAdmin';

export function CatalogTab() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const canEdit = hasPermission(session, 'catalog.manage');
  const { data, isPending } = useAdminCatalog();
  const createTest = useCreateTest();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', domain: '', tatDays: '1', requiresNabl: false });

  if (isPending || !data) return <FeedSkeleton />;

  const domains = [...new Set(data.tests.map((x) => x.domain))].sort();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    createTest.mutate([{
      code: form.code, name: form.name, domain: form.domain,
      requiresNabl: form.requiresNabl, typicalTatDays: Number(form.tatDays),
    }], {
      onSuccess: () => setForm({ code: '', name: '', domain: '', tatDays: '1', requiresNabl: false }),
      onError: (err) => setError(err instanceof ApiError ? err.message : String(err)),
    });
  };

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {canEdit && (
        <form onSubmit={submit} className="gov-card space-y-3 p-4">
          <h3 className="font-display text-base font-bold text-ink">{t('admin.addTest')}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {t('admin.testCode')}
              <input required pattern="[A-Z0-9_]+" value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                className="gov-input mt-1 w-full" />
            </label>
            <label className="text-sm">
              {t('admin.testName')}
              <input required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="gov-input mt-1 w-full" />
            </label>
            <label className="text-sm">
              {t('admin.domain')}
              <select required value={form.domain}
                onChange={(e) => setForm({ ...form, domain: e.target.value })}
                className="gov-input mt-1 w-full">
                <option value="" />
                {domains.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="text-sm">
              {t('admin.tatDays')}
              <input type="number" min={0} value={form.tatDays}
                onChange={(e) => setForm({ ...form, tatDays: e.target.value })}
                className="gov-input mt-1 w-full" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requiresNabl}
                onChange={(e) => setForm({ ...form, requiresNabl: e.target.checked })} />
              {t('admin.requiresNabl')}
            </label>
          </div>
          <button type="submit" disabled={createTest.isPending} className="gov-btn-primary">
            {t('admin.addTest')}
          </button>
        </form>
      )}

      {data.stages.map((stage) => {
        const tests = data.tests.filter((x) => x.stageCodes.includes(stage.code));
        if (tests.length === 0) return null;
        return (
          <div key={stage.code} className="gov-card p-4">
            <h3 className="font-display text-base font-bold text-ink">{stage.name}</h3>
            <ul className="mt-2 divide-y divide-hair">
              {tests.map((test) => (
                <TestRow key={test.id} test={test} canEdit={canEdit}
                  allStages={data.stages} onError={setError} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function TestRow(props: {
  test: AdminCatalogTest;
  canEdit: boolean;
  allStages: { code: string; name: string }[];
  onError: (m: string) => void;
}) {
  const { t } = useTranslation();
  const updateTest = useUpdateTest();
  const setStages = useSetTestStages();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(props.test.name);
  const [tat, setTat] = useState(String(props.test.typicalTatDays));
  const [nabl, setNabl] = useState(props.test.requiresNabl);
  const [stages, setStagesLocal] = useState(new Set(props.test.stageCodes));

  const save = () => {
    updateTest.mutate([props.test.code, {
      name, typicalTatDays: Number(tat), requiresNabl: nabl,
    }], {
      onSuccess: () => {
        setStages.mutate([props.test.code, [...stages].sort()], {
          onSuccess: () => setEditing(false),
          onError: (err) => props.onError(err instanceof ApiError ? err.message : String(err)),
        });
      },
      onError: (err) => props.onError(err instanceof ApiError ? err.message : String(err)),
    });
  };

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-3 py-2 text-sm">
        <span>
          <span className="font-semibold text-ink">{props.test.name}</span>
          <span className="ml-2 text-xs text-ink-2">{props.test.code}</span>
          {props.test.requiresNabl && <span className="ml-2 text-xs text-accent">NABL</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-ink-2">{t('admin.tatDays')}: {props.test.typicalTatDays}</span>
          {props.canEdit && (
            <button type="button" className="gov-btn-secondary text-xs" onClick={() => setEditing(true)}>
              {t('states.retry') /* placeholder-free: see note below */}
            </button>
          )}
        </span>
      </li>
    );
  }

  return (
    <li className="space-y-2 py-2 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <input aria-label={t('admin.testName')} value={name}
          onChange={(e) => setName(e.target.value)} className="gov-input" />
        <input aria-label={t('admin.tatDays')} type="number" min={0} value={tat}
          onChange={(e) => setTat(e.target.value)} className="gov-input" />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={nabl} onChange={(e) => setNabl(e.target.checked)} />
          {t('admin.requiresNabl')}
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="text-xs text-ink-2">{t('admin.stages')}</legend>
        {props.allStages.map((s) => (
          <label key={s.code} className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={stages.has(s.code)}
              onChange={() => setStagesLocal((prev) => {
                const next = new Set(prev);
                if (next.has(s.code)) next.delete(s.code); else next.add(s.code);
                return next;
              })} />
            {s.name}
          </label>
        ))}
      </fieldset>
      <button type="button" className="gov-btn-primary text-xs"
        disabled={updateTest.isPending || setStages.isPending} onClick={save}>
        {t('admin.saveStages')}
      </button>
    </li>
  );
}
```

Correction the implementer must apply (same pattern as Task 11): add `"edit": "Edit"` (en) / `"edit": "திருத்து"` (ta) to the `admin` namespace and use `{t('admin.edit')}` for the edit button — the `states.retry` reference above is a deliberate marker, not the intended label.

- [ ] **Step 4: Run tests** — admin suite + `tsc -b` green.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/admin/CatalogTab.tsx web/src/features/admin/admin.test.tsx web/src/i18n/en.json web/src/i18n/ta.json
git commit -m "feat(admin): catalog tab — stage-grouped tests with gated editing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: i18n parity test

**Files:**
- Create: `web/src/i18n/parity.test.ts`

**Interfaces:**
- Consumes: `en.json`, `ta.json`. Guards the spec's "every new string exists in both en and ta" for this module and everything after it.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest';
import en from './en.json';
import ta from './ta.json';

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('i18n parity', () => {
  it('en and ta expose identical key sets', () => {
    expect(flatKeys(ta as Record<string, unknown>).sort())
      .toEqual(flatKeys(en as Record<string, unknown>).sort());
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/i18n/parity.test.ts`. If it fails, the diff in the assertion output lists exactly which keys are missing on which side; fix `ta.json`/`en.json` until green. This is the one test in the plan expected to pass immediately if Tasks 8–12 kept parity.

- [ ] **Step 3: Commit**

```bash
git add web/src/i18n/parity.test.ts
git commit -m "test(i18n): en/ta key-set parity guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Full verification

**Files:** none new.

- [ ] **Step 1: Web suite** — `cd web && npx vitest run` → all files pass (expect ~20+ files: 16 existing + admin.test.mjs + admin.db.test.mjs + admin.test.tsx + parity.test.ts).
- [ ] **Step 2: Types + lint** — `cd web && npx tsc -b` → exit 0; `npx oxlint` → no NEW warnings (pre-existing ones in OnboardingWizard/seed scripts/env.test are known).
- [ ] **Step 3: SQL suite** — repo root `bash scripts/db-test.sh` → `RESULT: 386 checks passed`. **This drops and reseeds the local DB** — re-run `cd web && EWORKS_USE_LOCAL_PG=1 node server/seed-dev.mjs` afterwards if you want demo data back.
- [ ] **Step 4: Drive it for real** (verification-before-completion): start BFF + vite, sign in as Head Admin (phone 9000000001, OTP from BFF console), open `/gov/admin`, add a user, grant SITE_ENGINEER, flip a setting, edit a catalog test — then check `/gov/audit` shows the four `admin.*` actions.
- [ ] **Step 5: Commit anything outstanding; do not merge** — integration decision goes through superpowers:finishing-a-development-branch.

---

## Deferred to the companion plans (not this one)

- **Part A** (one front door, next-step dashboards, onboarding effort cuts, one-tap bid flow, plain-language copy, HowItWorks sheets) and **Part C** (help routes) — separate plan; depends on the uncommitted vendor rate-card work being committed first (spec D1).
- **Part D2** (nav hidden by permission) is largely satisfied for the new module by Task 8; the audit of existing nav items belongs to the Part A plan.
- Settings keys the spec names but the DB does not have yet (bid window defaults, payment hold days, OTP mode) are creatable at runtime through the B3 upsert; no seed needed.

## Self-review notes

- Spec coverage: B1 → Tasks 2–3 + 9; B2 → Tasks 4 + 10; B3 → Tasks 5 + 11; B4 → Tasks 6 + 12; audit-everything → each mutation task; E's named tests → Tasks 1, 3 (isolation + guard), 5 (settings gate), 6 (catalog gate), 13 (parity).
- Known judgment calls, recorded: revoke-out-of-scope surfaces as 404 (RLS DELETE semantics); last-HEAD_ADMIN guard counts under RLS and errs safe; stage unmapping deactivates instead of deleting; `roles`/`settings` audit rows use `org_path null` (visible to `audit.read_all` holders only).
- Two deliberate in-plan corrections are flagged inline (Tasks 11 and 12 button labels) so the implementer adds `admin.save`/`admin.edit` keys rather than shipping the marker labels.
