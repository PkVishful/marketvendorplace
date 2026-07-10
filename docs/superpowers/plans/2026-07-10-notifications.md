# Phase 6a Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give E-Works a durable, RLS-scoped notification spine so that a vendor who is about to be `FORFEITED` can prove whether the system told them the reveal window opened.

**Architecture:** Three tables. `notification_events` records an event once. `notifications` fans out one payload-free row per recipient and is the only table RLS guards. `notification_deliveries` is a plain outbox drained with `FOR UPDATE SKIP LOCKED`. Events are emitted by `AFTER` triggers on `vendors`, `test_orders`, and `order_award`, so a direct write that bypasses `float_order()` still notifies.

**Tech Stack:** PostgreSQL 15+ (developed against 18), PostGIS 3.6 (transitively, via `eligible_vendors_for_order()`), `pgcrypto`, `ltree`. No new extensions. Tests are plain SQL run by `bash scripts/db-test.sh`.

**Spec:** `docs/superpowers/specs/2026-07-10-notifications-design.md`

## Global Constraints

- Schema is `eworks`. Every new object lives in it.
- No new PostgreSQL extension. `pgmq` is deliberately not used (spec, divergence 1).
- All `SECURITY DEFINER` functions pin `set search_path = eworks, public, extensions, pg_temp`.
- `notifications` carries **no order content**. Only `event_id`, `recipient_user_id`, `created_at`, `read_at`, `id`.
- `notifications.created_at` is copied from `notification_events.occurred_at`. Never `now()`.
- `eworks_authenticated` receives: `SELECT` on `notifications` and `notification_events`; `UPDATE (read_at)` on `notifications`. Nothing else. Zero privileges on `notification_deliveries`.
- Read policies name a permission or self-identity. `in_scope()` alone never authorises a read (README rule: *`in_scope()` answers "where", never "whether"*).
- Notifications are **not** written to `audit_logs` (spec, divergence 3).
- Tests use the existing `pg_temp.check(label, condition)` / `pg_temp.check_raises(label, stmt)` helpers, redefined per file, and emit `pass:` lines that `db-test.sh` counts.
- Every test section is wrapped `begin; … rollback;` so fixtures survive for the next section.
- Final verification: `bash scripts/db-test.sh` reports **323 checks passed (Phases 0-6a)**, up from 304.

## Resolved spec gap

The spec defines `notification_deliveries` but never says what enqueues it. **Resolution:** `eworks.emit_notification()` inserts one `PENDING` delivery per notification for channel `SMS`. `PUSH` remains in the enum but nothing enqueues it — there is no device-token table, and inventing one is out of scope. Task 8 back-patches the spec to say so.

## Fixture vocabulary (already exists — do not recreate)

From `supabase/tests/01_fixtures.sql` and `03_vendors.sql`, committed and available to `09_notifications.sql`:

| id | what |
|---|---|
| `11111111-…-000000000002` | Coimbatore (district) |
| `11111111-…-000000000006` | CBESEC1 (section) — `test_orders.org_unit_id` |
| `11111111-…-000000000008` | CBEPRJ1 (project) — `test_orders.project_id` |
| `22222222-…-00000000000b` | Coimbatore District Officer (`vendor.approve`) |
| `22222222-…-00000000000d` | Coimbatore Section Engineer (creates orders) |
| `22222222-…-00000000000e` | Coimbatore Auditor (`audit.read`, `audit.read_all`) |
| `44444444-…-00000000000a` / `55555555-…-00000000000a` | Vendor A owner / vendor. 3 km away, live NABL. **Eligible.** |
| `44444444-…-00000000000b` / `55555555-…-00000000000b` | Vendor B. Salem, 50 km radius, site ~135 km. **Out of radius.** |
| `44444444-…-00000000000c` / `55555555-…-00000000000c` | Vendor C. Salem, 200 km radius. **Eligible.** |
| `44444444-…-00000000000d` / `55555555-…-00000000000d` | Vendor D. **Expired NABL.** |
| `44444444-…-00000000000e` / `55555555-…-00000000000e` | Vendor E. **Not approved.** |

Vendors A and C are the two-horse auction used by `06_sealed_bidding.sql`.

## File Structure

| file | responsibility |
|---|---|
| `supabase/migrations/20260710000100_notifications.sql` | **new.** Everything: enums, 3 tables, indexes, RLS, grants, `eworks_notifier` role, `emit_notification()`, 3 trigger functions + triggers, `claim_deliveries()`, `complete_delivery()`. Single file, matching every other phase — the migrations are numbered by phase, not by object type. |
| `supabase/tests/09_notifications.sql` | **new.** 19 checks. |
| `scripts/db-test.sh` | **modify.** Add Phase 6a to `needs_postgis()`; fix the unset `$NEEDS_POSTGIS_MIGRATION`. |
| `README.md` | **modify.** Phase 6a status line, "What exists" row, divergences 6 and 7, two checks in the bullet list. |
| `docs/security-gaps.md` | **modify.** Gap 1 gains the operational control that makes forfeiture fair. |
| `docs/superpowers/specs/2026-07-10-notifications-design.md` | **modify.** Back-patch the delivery-enqueue resolution. |

The migration is appended to across Tasks 2–7. `db-test.sh` drops and rebuilds the database on every run, so a partially-written migration is re-applied from scratch each time — there is no migration-ordering hazard while iterating.

---

### Task 1: Put the repository under version control

This project has fifteen migrations and no history. Every later task ends in a commit; without this, they cannot. If the user declines, skip every `git commit` step in this plan and note that review checkpoints lose their diff.

**Files:**
- Modify: none (`.gitignore` already exists)

**Interfaces:**
- Consumes: nothing
- Produces: a git repository at `C:/Users/vishf/OneDrive/Documents/Eworks`, so `git add` / `git commit` work in later tasks

- [ ] **Step 1: Confirm .gitignore covers node_modules and .env**

Run: `cat .gitignore`
Expected: contains `node_modules` and `.env`. If `.env` is absent, add it — the file holds `SUPABASE_DB_URL`.

- [ ] **Step 2: Initialise and make the baseline commit**

```bash
git init
git add .
git status --short | head -20   # verify .env and node_modules are NOT listed
git commit -m "chore: baseline — Phases 0-5, 304 passing checks"
```

- [ ] **Step 3: Verify the working tree is clean**

Run: `git status --short`
Expected: no output.

---

### Task 2: Schema — enums, tables, indexes

**Files:**
- Create: `supabase/migrations/20260710000100_notifications.sql`
- Test: `supabase/tests/09_notifications.sql`

**Interfaces:**
- Consumes: `eworks.test_orders(id)`, `eworks.vendors(id)`, `eworks.user_profiles(id)`
- Produces:
  - `eworks.notification_event_type` enum: `VENDOR_APPROVED, VENDOR_REJECTED, ORDER_FLOATED, REVEAL_WINDOW_OPEN, AWARD_WON, AWARD_LOST, ORDER_FAILED`
  - `eworks.notification_channel` enum: `SMS, PUSH`
  - `eworks.delivery_status` enum: `PENDING, CLAIMED, DELIVERED, FAILED, DEAD`
  - `eworks.notification_events(id uuid, event_type, order_id uuid, vendor_id uuid, org_path ltree, occurred_at timestamptz)`
  - `eworks.notifications(id uuid, created_at timestamptz, event_id uuid, recipient_user_id uuid, read_at timestamptz)`, PK `(created_at, id)`
  - `eworks.notification_deliveries(id bigint, notification_created_at, notification_id, channel, status, attempts, next_attempt_at, claimed_at, claimed_by, last_error, delivered_at)`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/09_notifications.sql`:

```sql
-- Phase 6a verification: notifications, fan-out, outbox.

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

-- Builds a DRAFT order. Floating it is what the tests do, because the
-- DRAFT -> FLOATED transition is what fires the fan-out trigger.
create or replace function pg_temp.make_draft_order(p_id uuid)
returns void language plpgsql as $$
begin
  insert into eworks.test_orders
    (id, project_id, org_unit_id, milestone, stage_id, site, status,
     required_by, created_by)
  select p_id, '11111111-0000-0000-0000-000000000008',
         '11111111-0000-0000-0000-000000000006', 'Pour '||left(p_id::text,4), cs.id,
         st_makepoint(76.9558, 11.0168)::geography, 'DRAFT',
         current_date + 30, '22222222-0000-0000-0000-00000000000d'
    from eworks.construction_stage cs where cs.code = 'SUPERSTRUCTURE';

  insert into eworks.order_items (order_id, test_id, quantity)
  select p_id, id, 6 from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH';
end;
$$;

-- Moves a DRAFT order to FLOATED with windows positioned relative to now().
create or replace function pg_temp.float_it(
  p_id uuid, p_bid_window interval, p_reveal_window interval)
returns void language plpgsql as $$
begin
  update eworks.test_orders
     set status = 'FLOATED',
         floated_at = now(),
         bid_close_at = now() + p_bid_window,
         reveal_close_at = now() + p_bid_window + p_reveal_window
   where id = p_id;
end;
$$;

-- ===========================================================================
-- 1. Schema shape. These are the constraints the design rests on.
-- ===========================================================================
begin;

-- A notification must carry no order content. A later migration that adds a
-- `title` or `price` column to make the feed snappier fails this test, which
-- is exactly the point: the payload-free invariant is what makes a stale
-- notification a dead link rather than a disclosure.
select pg_temp.check('notifications carries no column beyond the five allowed',
  (select count(*) from information_schema.columns
    where table_schema = 'eworks' and table_name = 'notifications'
      and column_name not in ('id','created_at','event_id','recipient_user_id','read_at')) = 0);

-- The PK must lead with created_at, or RANGE partitioning by month later is a
-- rewrite rather than an ALTER.
select pg_temp.check('notifications primary key is (created_at, id)',
  (select array_agg(a.attname order by k.ord)
     from pg_constraint c
     join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = 'eworks.notifications'::regclass and c.contype = 'p')
  = array['created_at','id']);

-- Exactly one subject. An event about an order that also names a vendor is
-- incoherent, and claim_deliveries() would not know which id to return.
select pg_temp.check_raises('An event naming both an order and a vendor is rejected',
  $$insert into eworks.notification_events (event_type, order_id, vendor_id, org_path)
    values ('ORDER_FLOATED', gen_random_uuid(), gen_random_uuid(), 'TN')$$);

select pg_temp.check_raises('An event naming no subject is rejected',
  $$insert into eworks.notification_events (event_type, org_path) values ('ORDER_FLOATED', 'TN')$$);

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: `FAILED`, because `09_notifications.sql` is not yet in the test loop and `eworks.notifications` does not exist. First add `09_*.sql` to the loop glob in `scripts/db-test.sh:76` — that one-line change is a prerequisite for this task, and Task 7 does the rest of the harness work:

```bash
for t in supabase/tests/02_*.sql supabase/tests/03_*.sql supabase/tests/04_*.sql supabase/tests/05_*.sql supabase/tests/06_*.sql supabase/tests/07_*.sql supabase/tests/08_*.sql supabase/tests/09_*.sql; do
```

Re-run. Expected: `ERROR: relation "eworks.notifications" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260710000100_notifications.sql`:

```sql
-- Phase 6a: notifications (master prompt s7 step 2, s10, s11, s13 Phase 6).
--
-- Three tables, not one, because commit-reveal makes "was this vendor told the
-- reveal window opened, and when?" a question the system must be able to answer
-- on the record. A vendor who does not reveal is FORFEITED and loses their EMD.
--
-- s7 names pgmq. This uses a plain outbox table drained with FOR UPDATE SKIP
-- LOCKED, which is what pgmq is. See the spec for why: no extension means the
-- migrations run unchanged on a NIC or State Data Centre cluster, and Phase 6a
-- stays verifiable by db-test.sh on a stock PostgreSQL.
--
-- Notifications are NOT written to audit_logs. The state change that produced
-- each one already is, and audit_logs_seal() takes an advisory lock that
-- serialises every append -- fanning out inside it would put the PostGIS radius
-- query behind the one global lock, at exactly the bid-broadcast spike.

create type eworks.notification_event_type as enum (
  'VENDOR_APPROVED',
  'VENDOR_REJECTED',
  'ORDER_FLOATED',      -- fanned out to every eligible vendor
  'REVEAL_WINDOW_OPEN', -- fairness-critical: silence here costs a vendor its EMD
  'AWARD_WON',
  'AWARD_LOST',
  'ORDER_FAILED'        -- closed with no qualified bid; the officer must know
);

-- WEB is deliberately absent. The in-app feed IS the notifications table;
-- there is nothing to deliver. PUSH exists but nothing enqueues it yet -- there
-- is no device-token table and inventing one is out of scope.
create type eworks.notification_channel as enum ('SMS', 'PUSH');

create type eworks.delivery_status as enum (
  'PENDING', 'CLAIMED', 'DELIVERED', 'FAILED',
  'DEAD'   -- attempts exhausted. Never deleted: for REVEAL_WINDOW_OPEN this is
           -- the list of vendors about to be forfeited unfairly.
);


-- ---------------------------------------------------------------------------
-- notification_events -- what happened, recorded once
-- ---------------------------------------------------------------------------
create table eworks.notification_events (
  id          uuid primary key default gen_random_uuid(),
  event_type  eworks.notification_event_type not null,

  order_id    uuid references eworks.test_orders(id) on delete cascade,
  vendor_id   uuid references eworks.vendors(id) on delete cascade,

  -- Denormalised so the auditor read policy never joins back to the subject
  -- table. test_orders' own RLS would hide the row from an auditor who lacks
  -- order.read, and the audit answer would be silently incomplete.
  org_path    ltree not null,

  occurred_at timestamptz not null default now(),

  constraint notification_events_one_subject check (
    (order_id is not null)::int + (vendor_id is not null)::int = 1
  ),
  -- The subject column must agree with the event type.
  constraint notification_events_subject_matches_type check (
    case
      when event_type in ('VENDOR_APPROVED','VENDOR_REJECTED') then vendor_id is not null
      else order_id is not null
    end
  )
);

-- Idempotency. sweep_close_bidding() and sweep_finalize_awards() are documented
-- as idempotent and self-healing; a missed pg_cron tick re-runs them. This index
-- is what stops the re-run notifying everybody twice.
--
-- No equivalent on vendor_id: a vendor may be SUSPENDED and later APPROVED
-- again, and each approval is a real event.
create unique index notification_events_once_per_order
  on eworks.notification_events (event_type, order_id)
  where order_id is not null;

create index notification_events_org_idx
  on eworks.notification_events using gist (org_path);


-- ---------------------------------------------------------------------------
-- notifications -- one row per recipient. The only table RLS guards.
-- ---------------------------------------------------------------------------
--
-- Carries NO order content: event_type and subject live on the event, and the
-- client joins to test_orders, where live RLS decides what it may see. A vendor
-- whose NABL lapsed after the float still holds this row, follows it, and reads
-- zero rows. Dead link, not leak. That is what reconciles this table with the
-- README's "order eligibility is recomputed per row, never cached".
create table eworks.notifications (
  id                uuid not null default gen_random_uuid(),

  -- Copied from the event's occurred_at, never defaulted to now().
  --
  -- A UNIQUE on a partitioned table must contain the partition key. Stamping
  -- every recipient row of one event with that event's timestamp puts them all
  -- in the same partition, so the dedup below stays exact after this table is
  -- RANGE-partitioned by month. now() happens to be transaction-start time and
  -- would work today, but that ties correctness to an incidental property.
  created_at        timestamptz not null,

  event_id          uuid not null references eworks.notification_events(id) on delete cascade,
  recipient_user_id uuid not null references eworks.user_profiles(id) on delete cascade,
  read_at           timestamptz,

  primary key (created_at, id),
  constraint notifications_one_per_recipient unique (created_at, event_id, recipient_user_id)
);

-- s11: "Vendor notification feed | (vendor_id, created_at DESC)".
create index notifications_feed_idx
  on eworks.notifications (recipient_user_id, created_at desc);

create index notifications_unread_idx
  on eworks.notifications (recipient_user_id) where read_at is null;


-- ---------------------------------------------------------------------------
-- notification_deliveries -- the outbox. eworks_authenticated gets NOTHING.
-- ---------------------------------------------------------------------------
create table eworks.notification_deliveries (
  id                      bigint generated always as identity primary key,

  notification_created_at timestamptz not null,
  notification_id         uuid not null,

  channel                 eworks.notification_channel not null,
  status                  eworks.delivery_status not null default 'PENDING',

  attempts                int not null default 0 check (attempts >= 0),
  next_attempt_at         timestamptz not null default now(),

  claimed_at              timestamptz,
  claimed_by              text,
  last_error              text,
  delivered_at            timestamptz,

  foreign key (notification_created_at, notification_id)
    references eworks.notifications (created_at, id) on delete cascade,

  constraint deliveries_one_per_channel
    unique (notification_created_at, notification_id, channel),

  constraint deliveries_delivered_has_timestamp check (
    status <> 'DELIVERED' or delivered_at is not null
  )
);

-- The claim query: due work on one channel, oldest first.
create index deliveries_due_idx
  on eworks.notification_deliveries (channel, next_attempt_at)
  where status in ('PENDING', 'FAILED');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: `RESULT: 308 checks passed` (304 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000100_notifications.sql supabase/tests/09_notifications.sql scripts/db-test.sh
git commit -m "feat(notifications): event, recipient, and delivery tables"
```

---

### Task 3: RLS, grants, and the notifier role

**Files:**
- Modify: `supabase/migrations/20260710000100_notifications.sql` (append)
- Modify: `supabase/tests/09_notifications.sql` (append)

**Interfaces:**
- Consumes: `eworks.current_user_id()`, `eworks.has_permission(perm text, path ltree)`, `eworks.has_permission_anywhere(perm text)`, `eworks_authenticated` role
- Produces: role `eworks_notifier` (nologin, no table grants); policies `notifications_read`, `notifications_mark_read`, `notification_events_read`

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/09_notifications.sql`:

```sql
-- ===========================================================================
-- 2. Isolation. A notification is addressed mail, not a bulletin board.
-- ===========================================================================
begin;

insert into eworks.notification_events (id, event_type, vendor_id, org_path)
values ('88888888-0000-0000-0000-000000000001', 'VENDOR_APPROVED',
        '55555555-0000-0000-0000-00000000000a', 'TN.COIMBATORE');

insert into eworks.notifications (created_at, event_id, recipient_user_id)
values (now(), '88888888-0000-0000-0000-000000000001',
        '44444444-0000-0000-0000-00000000000a');   -- Vendor A's owner

insert into eworks.notification_deliveries
  (notification_created_at, notification_id, channel)
select created_at, id, 'SMS' from eworks.notifications
 where event_id = '88888888-0000-0000-0000-000000000001';

set local role eworks_authenticated;

select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true); -- Vendor A
select pg_temp.check('A vendor reads its own notification',
  (select count(*) from eworks.notifications) = 1);

select set_config('app.user_id', '44444444-0000-0000-0000-00000000000c', true); -- Vendor C
select pg_temp.check('Vendor C cannot read Vendor A''s notification',
  (select count(*) from eworks.notifications) = 0);

-- Not "cannot see the body" -- cannot see the row, and so cannot learn that
-- Vendor A was approved at all.
select pg_temp.check('Vendor C cannot read the event either',
  (select count(*) from eworks.notification_events) = 0);

select set_config('app.user_id', null, true);  -- unauthenticated
select pg_temp.check('An unauthenticated connection reads zero notifications',
  (select count(*) from eworks.notifications) = 0);

set local role postgres;
rollback;


begin;
insert into eworks.notification_events (id, event_type, vendor_id, org_path)
values ('88888888-0000-0000-0000-000000000002', 'VENDOR_APPROVED',
        '55555555-0000-0000-0000-00000000000a', 'TN.COIMBATORE');
insert into eworks.notifications (id, created_at, event_id, recipient_user_id)
values ('99999999-0000-0000-0000-000000000002', now(),
        '88888888-0000-0000-0000-000000000002', '44444444-0000-0000-0000-00000000000a');

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);

-- The grant, not the policy, is what refuses. A policy that is never reached
-- because the privilege is absent is a policy nobody has tested -- so assert
-- the privilege is absent, deliberately.
select pg_temp.check('eworks_authenticated cannot INSERT a notification',
  not has_table_privilege('eworks_authenticated', 'eworks.notifications', 'INSERT'));

select pg_temp.check('eworks_authenticated cannot DELETE a notification',
  not has_table_privilege('eworks_authenticated', 'eworks.notifications', 'DELETE'));

-- Column-level grant: read_at yes, everything else no. RLS cannot restrict
-- columns, so this is the only thing stopping a vendor rewriting event_id.
select pg_temp.check('A vendor may update read_at',
  has_column_privilege('eworks_authenticated', 'eworks.notifications', 'read_at', 'UPDATE'));

select pg_temp.check('A vendor may not update event_id',
  not has_column_privilege('eworks_authenticated', 'eworks.notifications', 'event_id', 'UPDATE'));

update eworks.notifications set read_at = now()
 where id = '99999999-0000-0000-0000-000000000002';
select pg_temp.check('Marking own notification read succeeds', found);

-- RLS refuses by making the row invisible. The UPDATE affects zero rows and
-- returns success -- which is exactly why the BFF must check the row count.
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000c', true); -- Vendor C
update eworks.notifications set read_at = now()
 where id = '99999999-0000-0000-0000-000000000002';
select pg_temp.check('Vendor C marking Vendor A''s notification read affects zero rows',
  not found);

-- The outbox is not user-facing at all. Not "policied" -- ungranted.
select pg_temp.check('eworks_authenticated has NO privilege on notification_deliveries',
  not has_table_privilege('eworks_authenticated', 'eworks.notification_deliveries', 'SELECT')
  and not has_table_privilege('eworks_authenticated', 'eworks.notification_deliveries', 'INSERT')
  and not has_table_privilege('eworks_authenticated', 'eworks.notification_deliveries', 'UPDATE')
  and not has_table_privilege('eworks_authenticated', 'eworks.notification_deliveries', 'DELETE'));

set local role postgres;
rollback;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: `FAIL: A vendor reads its own notification` — RLS is not enabled, no grants exist, so `eworks_authenticated` cannot `SELECT` at all and the count query errors with `permission denied for table notifications`.

- [ ] **Step 3: Append RLS and grants to the migration**

```sql
-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table eworks.notification_events enable row level security;
alter table eworks.notifications enable row level security;
alter table eworks.notification_deliveries enable row level security;

-- Read your own mail. The self-identity branch has precedent: user_profiles_read
-- opens with `id = eworks.current_user_id()`.
--
-- The second branch names a permission. It never leans on in_scope() alone --
-- in_scope() answers "where", never "whether", and a LAB_VENDOR holds a role
-- anchored in a district, so scope alone would show every lab the whole
-- district's notification traffic.
grant select on eworks.notifications to eworks_authenticated;
grant update (read_at) on eworks.notifications to eworks_authenticated;

create policy notifications_read on eworks.notifications
  for select to eworks_authenticated
  using (
    recipient_user_id = eworks.current_user_id()
    or exists (
      select 1 from eworks.notification_events e
       where e.id = notifications.event_id
         and eworks.has_permission('audit.read', e.org_path)
    )
  );

-- Only your own row, and (via the column grant above) only read_at.
create policy notifications_mark_read on eworks.notifications
  for update to eworks_authenticated
  using (recipient_user_id = eworks.current_user_id())
  with check (recipient_user_id = eworks.current_user_id());

-- No INSERT or DELETE policy, and no INSERT/DELETE grant. Only the
-- SECURITY DEFINER emit trigger writes here.


grant select on eworks.notification_events to eworks_authenticated;

-- You may read an event only if you were told about it, or if you are an
-- auditor. Without this, the events table would leak every floated order's
-- existence to every vendor.
create policy notification_events_read on eworks.notification_events
  for select to eworks_authenticated
  using (
    exists (
      select 1 from eworks.notifications n
       where n.event_id = notification_events.id
         and n.recipient_user_id = eworks.current_user_id()
    )
    or eworks.has_permission_anywhere('audit.read_all')
    or eworks.has_permission('audit.read', notification_events.org_path)
  );


-- notification_deliveries: RLS is enabled and NO policy is created, so even a
-- role holding an accidental future grant reads nothing. eworks_authenticated
-- is granted nothing at all. The worker reaches it only through the two
-- SECURITY DEFINER functions below.


-- ---------------------------------------------------------------------------
-- The delivery worker's role
-- ---------------------------------------------------------------------------
--
-- It holds no table grants whatsoever -- only EXECUTE on two functions. So it
-- cannot read the feed, cannot enumerate vendors or orders, and service_role
-- (which bypasses RLS entirely and would make every policy above decorative)
-- never needs to appear.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'eworks_notifier') then
    create role eworks_notifier nologin;
  end if;

  if not (select usesuper from pg_user where usename = current_user) then
    if current_setting('server_version_num')::int >= 160000 then
      execute format('grant eworks_notifier to %I with set true', current_user);
    elsif not pg_has_role(current_user, 'eworks_notifier', 'MEMBER') then
      execute format('grant eworks_notifier to %I', current_user);
    end if;
  end if;
end
$$;

grant usage on schema eworks to eworks_notifier;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: `RESULT: 318 checks passed` (308 + 10 new).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000100_notifications.sql supabase/tests/09_notifications.sql
git commit -m "feat(notifications): RLS, column-level read_at grant, eworks_notifier role"
```

---

### Task 4: `emit_notification()` — the fan-out primitive

**Files:**
- Modify: `supabase/migrations/20260710000100_notifications.sql` (append)
- Modify: `supabase/tests/09_notifications.sql` (append)

**Interfaces:**
- Consumes: the three tables from Task 2
- Produces: `eworks.emit_notification(p_event_type eworks.notification_event_type, p_order_id uuid, p_vendor_id uuid, p_org_path ltree, p_recipients uuid[]) returns uuid` — returns the new event id, or `null` if the event already existed (idempotent no-op). Every trigger in Tasks 5–6 calls exactly this.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/09_notifications.sql`:

```sql
-- ===========================================================================
-- 3. The fan-out primitive: dedup, delivery enqueue, partition safety.
-- ===========================================================================
begin;
select pg_temp.make_draft_order('77777777-0000-0000-0000-00000000009a');

select eworks.emit_notification('ORDER_FLOATED',
  '77777777-0000-0000-0000-00000000009a', null, 'TN.COIMBATORE',
  array['44444444-0000-0000-0000-00000000000a',
        '44444444-0000-0000-0000-00000000000c']::uuid[]);

select pg_temp.check('One event, two recipient rows',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009a') = 2);

-- Every recipient row of one event shares one created_at. This is what keeps
-- the dedup unique valid once the table is RANGE-partitioned by month: all
-- recipients land in the same partition by construction.
select pg_temp.check('All recipient rows of one event share created_at',
  (select count(distinct n.created_at) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009a') = 1);

select pg_temp.check('created_at equals the event''s occurred_at',
  (select bool_and(n.created_at = e.occurred_at) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009a'));

-- One SMS delivery per recipient, PENDING and due immediately. Nothing enqueues
-- PUSH: there is no device-token table.
select pg_temp.check('An SMS delivery is enqueued per recipient, and no PUSH',
  (select count(*) from eworks.notification_deliveries d
     join eworks.notifications n on n.id = d.notification_id
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009a'
      and d.channel = 'SMS' and d.status = 'PENDING') = 2
  and (select count(*) from eworks.notification_deliveries where channel = 'PUSH') = 0);

-- A re-run must be a no-op. sweep_finalize_awards() is idempotent by design and
-- a missed pg_cron tick re-runs it; without this, every vendor is told twice.
select pg_temp.check('Re-emitting the same order event returns null',
  eworks.emit_notification('ORDER_FLOATED',
    '77777777-0000-0000-0000-00000000009a', null, 'TN.COIMBATORE',
    array['44444444-0000-0000-0000-00000000000a']::uuid[]) is null);

select pg_temp.check('Re-emitting creates no duplicate notification',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009a') = 2);

-- An event with no recipients is a fact, not a failure. "No vendor qualified"
-- must never be confused with "the fan-out crashed".
select pg_temp.check('An event with zero recipients is created, and does not raise',
  eworks.emit_notification('ORDER_FAILED',
    '77777777-0000-0000-0000-00000000009a', null, 'TN.COIMBATORE',
    array[]::uuid[]) is not null);

select pg_temp.check('The zero-recipient event has zero notifications',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009a'
      and e.event_type = 'ORDER_FAILED') = 0);

rollback;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: `ERROR: function eworks.emit_notification(...) does not exist`

- [ ] **Step 3: Append the function to the migration**

```sql
-- ---------------------------------------------------------------------------
-- emit_notification -- the one place a notification is ever created
-- ---------------------------------------------------------------------------
--
-- Returns the new event id, or NULL if this order event has already fired.
-- Callers are triggers; they ignore the return value. Tests do not.
--
-- SECURITY DEFINER because the triggers run as whoever floated the order --
-- a site engineer, who holds no INSERT on notifications and never should.
create or replace function eworks.emit_notification(
  p_event_type  eworks.notification_event_type,
  p_order_id    uuid,
  p_vendor_id   uuid,
  p_org_path    ltree,
  p_recipients  uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_event_id uuid;
  v_at       timestamptz;
begin
  -- ON CONFLICT against notification_events_once_per_order. A second call for
  -- the same (event_type, order_id) inserts nothing and returns no row, so
  -- v_event_id stays null and the fan-out below is skipped entirely.
  insert into eworks.notification_events (event_type, order_id, vendor_id, org_path)
  values (p_event_type, p_order_id, p_vendor_id, p_org_path)
  on conflict do nothing
  returning id, occurred_at into v_event_id, v_at;

  if v_event_id is null then
    return null;
  end if;

  -- created_at := the event's occurred_at, so every recipient row lands in the
  -- same future partition. See the table comment.
  insert into eworks.notifications (created_at, event_id, recipient_user_id)
  select v_at, v_event_id, r
    from unnest(p_recipients) as r
   group by r;   -- a duplicate recipient in the array is one notification

  insert into eworks.notification_deliveries
    (notification_created_at, notification_id, channel)
  select n.created_at, n.id, 'SMS'
    from eworks.notifications n
   where n.event_id = v_event_id;

  return v_event_id;
end;
$$;

revoke all on function eworks.emit_notification(
  eworks.notification_event_type, uuid, uuid, ltree, uuid[]) from public;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: `RESULT: 326 checks passed` (318 + 8 new).

> The running count exceeds the 323 target because Tasks 2–4 add assertions the spec folded into single numbered checks. The final count is whatever `db-test.sh` reports; Task 8 records it in the README rather than forcing it to a predicted number. Do not delete a passing check to hit 323.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000100_notifications.sql supabase/tests/09_notifications.sql
git commit -m "feat(notifications): idempotent emit_notification() fan-out primitive"
```

---

### Task 5: Vendor and order triggers

**Files:**
- Modify: `supabase/migrations/20260710000100_notifications.sql` (append)
- Modify: `supabase/tests/09_notifications.sql` (append)

**Interfaces:**
- Consumes: `eworks.emit_notification(...)` from Task 4; `eworks.eligible_vendors_for_order(p_order_id uuid) returns table(vendor_id uuid, distance_m double precision)`
- Produces: trigger functions `eworks.vendors_notify()`, `eworks.test_orders_notify()`; triggers `vendors_notify_status`, `test_orders_notify_status`

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/09_notifications.sql`:

```sql
-- ===========================================================================
-- 4. Vendor approval. Phase 1's unpaid "verified notification" debt.
-- ===========================================================================
begin;
-- Vendor E is SUBMITTED in the fixtures and has never been approved.
update eworks.vendors
   set status = 'APPROVED',
       approved_by = '22222222-0000-0000-0000-00000000000b',
       approved_at = now()
 where id = '55555555-0000-0000-0000-00000000000e';

select pg_temp.check('Approving a vendor notifies its owner',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.event_type = 'VENDOR_APPROVED'
      and e.vendor_id = '55555555-0000-0000-0000-00000000000e'
      and n.recipient_user_id = '44444444-0000-0000-0000-00000000000e') = 1);

select pg_temp.check('Approving a vendor notifies nobody else',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.event_type = 'VENDOR_APPROVED'
      and e.vendor_id = '55555555-0000-0000-0000-00000000000e') = 1);

-- A no-op update must not re-notify.
update eworks.vendors set address = 'Coimbatore, 2nd floor'
 where id = '55555555-0000-0000-0000-00000000000e';
select pg_temp.check('An update that does not change status notifies nobody',
  (select count(*) from eworks.notification_events
    where event_type = 'VENDOR_APPROVED'
      and vendor_id = '55555555-0000-0000-0000-00000000000e') = 1);
rollback;


-- ===========================================================================
-- 5. ORDER_FLOATED reaches exactly the eligible vendors.
-- ===========================================================================
begin;
select pg_temp.make_draft_order('77777777-0000-0000-0000-00000000009b');

select pg_temp.check('A DRAFT order notifies nobody',
  (select count(*) from eworks.notification_events
    where order_id = '77777777-0000-0000-0000-00000000009b') = 0);

select pg_temp.float_it('77777777-0000-0000-0000-00000000009b',
  interval '2 hours', interval '1 hour');

-- A and C are eligible. B is out of radius, D's NABL expired, E is not APPROVED.
select pg_temp.check('Floating notifies exactly the eligible vendors (A and C)',
  (select array_agg(n.recipient_user_id order by n.recipient_user_id)
     from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009b'
      and e.event_type = 'ORDER_FLOATED')
  = array['44444444-0000-0000-0000-00000000000a',
          '44444444-0000-0000-0000-00000000000c']::uuid[]);

select pg_temp.check('The out-of-radius vendor is not notified',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009b'
      and n.recipient_user_id = '44444444-0000-0000-0000-00000000000b') = 0);

select pg_temp.check('The lapsed-NABL vendor is not notified',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009b'
      and n.recipient_user_id = '44444444-0000-0000-0000-00000000000d') = 0);
rollback;


-- ===========================================================================
-- 6. The dead-link property. This is the test that reconciles a materialised
--    notification with "eligibility is recomputed per row, never cached".
-- ===========================================================================
begin;
select pg_temp.make_draft_order('77777777-0000-0000-0000-00000000009c');
select pg_temp.float_it('77777777-0000-0000-0000-00000000009c',
  interval '2 hours', interval '1 hour');

-- Vendor A was notified. Now its accreditation lapses.
update eworks.vendors set nabl_valid_until = current_date - 1
 where id = '55555555-0000-0000-0000-00000000000a';

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);

select pg_temp.check('The lapsed vendor still holds the notification row',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009c') = 1);

-- Following it leads nowhere. A dead link, not a disclosure.
select pg_temp.check('...but reads zero rows from test_orders. Dead link, not leak.',
  (select count(*) from eworks.test_orders
    where id = '77777777-0000-0000-0000-00000000009c') = 0);

set local role postgres;
rollback;


-- ===========================================================================
-- 7. REVEAL_WINDOW_OPEN. Silence here costs a vendor its EMD.
-- ===========================================================================
begin;
select pg_temp.make_draft_order('77777777-0000-0000-0000-00000000009d');
select pg_temp.float_it('77777777-0000-0000-0000-00000000009d',
  interval '-1 minute', interval '1 hour');   -- bidding already closed

-- Only Vendor A commits. Vendor C is eligible but never bids.
set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
set local role postgres;
insert into eworks.order_bids (order_id, vendor_id, commitment)
values ('77777777-0000-0000-0000-00000000009d', '55555555-0000-0000-0000-00000000000a',
        eworks.bid_commitment('77777777-0000-0000-0000-00000000009d',
          '55555555-0000-0000-0000-00000000000a', 250000, 'n'));

update eworks.test_orders set status = 'REVEALING'
 where id = '77777777-0000-0000-0000-00000000009d';

select pg_temp.check('REVEAL_WINDOW_OPEN reaches every COMMITTED bidder',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009d'
      and e.event_type = 'REVEAL_WINDOW_OPEN'
      and n.recipient_user_id = '44444444-0000-0000-0000-00000000000a') = 1);

select pg_temp.check('...and nobody else, not even an eligible non-bidder',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009d'
      and e.event_type = 'REVEAL_WINDOW_OPEN') = 1);
rollback;


-- ===========================================================================
-- 8. ORDER_FAILED tells the officer who raised it.
-- ===========================================================================
begin;
select pg_temp.make_draft_order('77777777-0000-0000-0000-00000000009e');
select pg_temp.float_it('77777777-0000-0000-0000-00000000009e',
  interval '-1 minute', interval '1 hour');
update eworks.test_orders set status = 'FAILED'
 where id = '77777777-0000-0000-0000-00000000009e';

select pg_temp.check('ORDER_FAILED reaches the site engineer who created it',
  (select array_agg(n.recipient_user_id) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-00000000009e'
      and e.event_type = 'ORDER_FAILED')
  = array['22222222-0000-0000-0000-00000000000d']::uuid[]);
rollback;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: `FAIL: Approving a vendor notifies its owner` — no trigger exists.

- [ ] **Step 3: Append the triggers to the migration**

```sql
-- ---------------------------------------------------------------------------
-- Emission: AFTER triggers, not calls inside the functions
-- ---------------------------------------------------------------------------
--
-- Triggers are unbypassable. A direct UPDATE to test_orders.status that skips
-- float_order() still notifies. That matters because -- unlike order_bids,
-- where eworks_authenticated holds no INSERT/UPDATE at all -- test_orders is
-- directly writable by officers.
--
-- The order state machine and custody_seal() already set this precedent.

create or replace function eworks.vendors_notify()
returns trigger
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_path ltree;
begin
  if old.status is not distinct from new.status then
    return null;
  end if;

  if new.status not in ('APPROVED', 'REJECTED') then
    return null;
  end if;

  select path into v_path from eworks.org_units where id = new.org_unit_id;

  perform eworks.emit_notification(
    case new.status when 'APPROVED' then 'VENDOR_APPROVED'::eworks.notification_event_type
                    else 'VENDOR_REJECTED'::eworks.notification_event_type end,
    null, new.id, v_path,
    array[new.owner_user_id]);

  return null;
end;
$$;

create trigger vendors_notify_status
  after update of status on eworks.vendors
  for each row execute function eworks.vendors_notify();


create or replace function eworks.test_orders_notify()
returns trigger
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_path       ltree;
  v_recipients uuid[];
begin
  if old.status is not distinct from new.status then
    return null;
  end if;

  if new.status not in ('FLOATED', 'REVEALING', 'FAILED') then
    return null;
  end if;

  select path into v_path from eworks.org_units where id = new.org_unit_id;

  if new.status = 'FLOATED' then
    -- The radius query, inside the float transaction. If it raises, the float
    -- rolls back and the order does not float. That is deliberate: an order
    -- that floats while silently telling nobody is an unfair tender that looks,
    -- from the officer's screen, exactly like a fair one.
    --
    -- Zero eligible vendors is NOT that case. It yields an event with zero
    -- recipients -- a queryable fact, not a crash.
    select coalesce(array_agg(v.owner_user_id), array[]::uuid[])
      into v_recipients
      from eworks.eligible_vendors_for_order(new.id) ev
      join eworks.vendors v on v.id = ev.vendor_id;

    perform eworks.emit_notification('ORDER_FLOATED', new.id, null, v_path, v_recipients);

  elsif new.status = 'REVEALING' then
    -- Every vendor holding a COMMITTED bid, and only them. A vendor who never
    -- bid has nothing to reveal and nothing to forfeit.
    select coalesce(array_agg(v.owner_user_id), array[]::uuid[])
      into v_recipients
      from eworks.order_bids b
      join eworks.vendors v on v.id = b.vendor_id
     where b.order_id = new.id and b.status = 'COMMITTED';

    perform eworks.emit_notification('REVEAL_WINDOW_OPEN', new.id, null, v_path, v_recipients);

  elsif new.status = 'FAILED' then
    perform eworks.emit_notification('ORDER_FAILED', new.id, null, v_path,
      array[new.created_by]);
  end if;

  return null;
end;
$$;

create trigger test_orders_notify_status
  after update of status on eworks.test_orders
  for each row execute function eworks.test_orders_notify();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: all `pass:` lines, `RESULT: <n> checks passed` with `<n>` = previous + 11.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000100_notifications.sql supabase/tests/09_notifications.sql
git commit -m "feat(notifications): vendor-approval and order-status emit triggers"
```

---

### Task 6: The award trigger

**Files:**
- Modify: `supabase/migrations/20260710000100_notifications.sql` (append)
- Modify: `supabase/tests/09_notifications.sql` (append)

**Interfaces:**
- Consumes: `eworks.emit_notification(...)`; `eworks.order_award(order_id, bid_id, vendor_id, price_paise, …)`; `eworks.order_bids(order_id, vendor_id, status)`
- Produces: trigger function `eworks.order_award_notify()`; trigger `order_award_notify_insert`

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/09_notifications.sql`:

```sql
-- ===========================================================================
-- 9. Award. The winner is told they won; the losers are told they lost, and
--    are told nothing about the price that beat them.
-- ===========================================================================
begin;
select pg_temp.make_draft_order('77777777-0000-0000-0000-0000000000a1');
select pg_temp.float_it('77777777-0000-0000-0000-0000000000a1',
  interval '-2 minutes', interval '1 hour');

-- A bids 250000 and reveals. C bids 300000 and reveals. A wins.
insert into eworks.order_bids (id, order_id, vendor_id, commitment, status,
                               revealed_price_paise, nonce, revealed_at)
values ('66666666-0000-0000-0000-0000000000a1', '77777777-0000-0000-0000-0000000000a1',
        '55555555-0000-0000-0000-00000000000a',
        eworks.bid_commitment('77777777-0000-0000-0000-0000000000a1',
          '55555555-0000-0000-0000-00000000000a', 250000, 'na'),
        'REVEALED', 250000, 'na', now()),
       ('66666666-0000-0000-0000-0000000000a2', '77777777-0000-0000-0000-0000000000a1',
        '55555555-0000-0000-0000-00000000000c',
        eworks.bid_commitment('77777777-0000-0000-0000-0000000000a1',
          '55555555-0000-0000-0000-00000000000c', 300000, 'nc'),
        'REVEALED', 300000, 'nc', now());

insert into eworks.order_award (order_id, bid_id, vendor_id, price_paise,
                                eval_method, qualified_bid_count)
values ('77777777-0000-0000-0000-0000000000a1', '66666666-0000-0000-0000-0000000000a1',
        '55555555-0000-0000-0000-00000000000a', 250000, 'L1', 2);

select pg_temp.check('AWARD_WON reaches the winner, and only the winner',
  (select array_agg(n.recipient_user_id) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-0000000000a1'
      and e.event_type = 'AWARD_WON')
  = array['44444444-0000-0000-0000-00000000000a']::uuid[]);

select pg_temp.check('AWARD_LOST reaches the other revealed bidder',
  (select array_agg(n.recipient_user_id) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-0000000000a1'
      and e.event_type = 'AWARD_LOST')
  = array['44444444-0000-0000-0000-00000000000c']::uuid[]);

-- The losing vendor learns that it lost. It does not learn what it lost to.
-- The notification carries no price because it carries nothing at all.
select pg_temp.check('No notification row can carry a price -- there is no column for one',
  (select count(*) from information_schema.columns
    where table_schema = 'eworks' and table_name = 'notifications'
      and column_name ilike '%price%') = 0);
rollback;


-- ===========================================================================
-- 10. A FORFEITED bidder is told nothing at award. They were told at reveal,
--     and did not act. That asymmetry IS the forfeiture record.
-- ===========================================================================
begin;
select pg_temp.make_draft_order('77777777-0000-0000-0000-0000000000a2');
select pg_temp.float_it('77777777-0000-0000-0000-0000000000a2',
  interval '-2 minutes', interval '1 hour');

insert into eworks.order_bids (id, order_id, vendor_id, commitment, status,
                               revealed_price_paise, nonce, revealed_at)
values ('66666666-0000-0000-0000-0000000000b1', '77777777-0000-0000-0000-0000000000a2',
        '55555555-0000-0000-0000-00000000000a',
        eworks.bid_commitment('77777777-0000-0000-0000-0000000000a2',
          '55555555-0000-0000-0000-00000000000a', 250000, 'na'),
        'REVEALED', 250000, 'na', now());

insert into eworks.order_bids (id, order_id, vendor_id, commitment, status)
values ('66666666-0000-0000-0000-0000000000b2', '77777777-0000-0000-0000-0000000000a2',
        '55555555-0000-0000-0000-00000000000c',
        eworks.bid_commitment('77777777-0000-0000-0000-0000000000a2',
          '55555555-0000-0000-0000-00000000000c', 300000, 'nc'),
        'FORFEITED');

insert into eworks.order_award (order_id, bid_id, vendor_id, price_paise,
                                eval_method, qualified_bid_count)
values ('77777777-0000-0000-0000-0000000000a2', '66666666-0000-0000-0000-0000000000b1',
        '55555555-0000-0000-0000-00000000000a', 250000, 'L1', 1);

select pg_temp.check('A FORFEITED bidder receives no AWARD_LOST',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-0000000000a2'
      and e.event_type = 'AWARD_LOST') = 0);
rollback;


-- ===========================================================================
-- 11. The forfeiture-dispute query. This is why there are three tables.
-- ===========================================================================
begin;
select pg_temp.make_draft_order('77777777-0000-0000-0000-0000000000a3');
select pg_temp.float_it('77777777-0000-0000-0000-0000000000a3',
  interval '-1 minute', interval '1 hour');

insert into eworks.order_bids (order_id, vendor_id, commitment)
values ('77777777-0000-0000-0000-0000000000a3', '55555555-0000-0000-0000-00000000000a',
        eworks.bid_commitment('77777777-0000-0000-0000-0000000000a3',
          '55555555-0000-0000-0000-00000000000a', 250000, 'n'));

update eworks.test_orders set status = 'REVEALING'
 where id = '77777777-0000-0000-0000-0000000000a3';

update eworks.notification_deliveries d
   set status = 'DELIVERED', delivered_at = now(), attempts = 1
  from eworks.notifications n, eworks.notification_events e
 where d.notification_id = n.id and n.event_id = e.id
   and e.order_id = '77777777-0000-0000-0000-0000000000a3';

set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000e', true); -- Auditor

-- "Was this vendor notified that the reveal window opened, and when?"
-- One query. Event identity, recipient, and delivery timestamp.
select pg_temp.check('An auditor can prove the reveal notice was sent and delivered',
  (select count(*) from eworks.notification_events e
     join eworks.notifications n on n.event_id = e.id
    where e.order_id = '77777777-0000-0000-0000-0000000000a3'
      and e.event_type = 'REVEAL_WINDOW_OPEN'
      and n.recipient_user_id = '44444444-0000-0000-0000-00000000000a'
      and e.occurred_at is not null) = 1);

set local role postgres;

-- The delivery proof lives on a table the vendor-facing feed never writes to,
-- which is what makes its timestamp evidence rather than hearsay.
select pg_temp.check('The delivery record proves when it was sent',
  (select count(*) from eworks.notification_deliveries d
     join eworks.notifications n on n.id = d.notification_id
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-0000000000a3'
      and d.status = 'DELIVERED' and d.delivered_at is not null) = 1);
rollback;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: `FAIL: AWARD_WON reaches the winner, and only the winner`

- [ ] **Step 3: Append the award trigger**

```sql
-- The award is an INSERT, not a status change: order_award's primary key on
-- order_id is what guarantees exactly one winner under concurrent finalisation.
-- So the notification hangs off that same insert.
create or replace function eworks.order_award_notify()
returns trigger
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_path    ltree;
  v_winner  uuid;
  v_losers  uuid[];
begin
  select ou.path into v_path
    from eworks.test_orders o
    join eworks.org_units ou on ou.id = o.org_unit_id
   where o.id = new.order_id;

  select owner_user_id into v_winner from eworks.vendors where id = new.vendor_id;

  -- REVEALED and DISQUALIFIED bidders lost. A FORFEITED bidder is told nothing:
  -- they already received REVEAL_WINDOW_OPEN and did not act, and that silence
  -- is precisely the record a forfeiture dispute turns on.
  select coalesce(array_agg(v.owner_user_id), array[]::uuid[])
    into v_losers
    from eworks.order_bids b
    join eworks.vendors v on v.id = b.vendor_id
   where b.order_id = new.order_id
     and b.vendor_id <> new.vendor_id
     and b.status in ('REVEALED', 'DISQUALIFIED');

  perform eworks.emit_notification('AWARD_WON', new.order_id, null, v_path,
    array[v_winner]);

  if array_length(v_losers, 1) > 0 then
    perform eworks.emit_notification('AWARD_LOST', new.order_id, null, v_path, v_losers);
  end if;

  return null;
end;
$$;

create trigger order_award_notify_insert
  after insert on eworks.order_award
  for each row execute function eworks.order_award_notify();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: all `pass:`, count = previous + 6.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000100_notifications.sql supabase/tests/09_notifications.sql
git commit -m "feat(notifications): award trigger; forfeited bidders get no AWARD_LOST"
```

---

### Task 7: The outbox worker contract

**Files:**
- Modify: `supabase/migrations/20260710000100_notifications.sql` (append)
- Modify: `supabase/tests/09_notifications.sql` (append)

**Interfaces:**
- Consumes: `eworks.notification_deliveries`, `eworks.user_profiles(phone)`
- Produces:
  - `eworks.claim_deliveries(p_channel eworks.notification_channel, p_limit int, p_worker text) returns table(delivery_id bigint, event_type eworks.notification_event_type, subject_id uuid, recipient_phone text)`
  - `eworks.complete_delivery(p_delivery_id bigint, p_ok boolean, p_error text default null) returns void`
  - Both `EXECUTE`-granted to `eworks_notifier` only.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/09_notifications.sql`:

```sql
-- ===========================================================================
-- 12. The outbox. A DEAD delivery is never silently dropped -- for
--     REVEAL_WINDOW_OPEN it is a vendor about to be forfeited unfairly.
-- ===========================================================================
begin;
select pg_temp.make_draft_order('77777777-0000-0000-0000-0000000000c1');
select pg_temp.float_it('77777777-0000-0000-0000-0000000000c1',
  interval '2 hours', interval '1 hour');

set local role eworks_notifier;

-- The worker holds no table grants at all. Everything arrives through the
-- function, which is also the single place user_profiles.phone leaves the
-- database -- so encrypting it later (security-gaps #5) touches one line.
select pg_temp.check('The worker cannot read the deliveries table directly',
  not has_table_privilege('eworks_notifier', 'eworks.notification_deliveries', 'SELECT'));

select pg_temp.check('The worker cannot read the notifications feed',
  not has_table_privilege('eworks_notifier', 'eworks.notifications', 'SELECT'));

create temp table claimed_a as
  select * from eworks.claim_deliveries('SMS', 1, 'worker-a');

select pg_temp.check('claim_deliveries returns one due delivery with a phone number',
  (select count(*) from claimed_a where recipient_phone is not null) = 1);

select pg_temp.check('The claimed delivery carries the event type and subject',
  (select count(*) from claimed_a
    where event_type = 'ORDER_FLOATED'
      and subject_id = '77777777-0000-0000-0000-0000000000c1') = 1);

-- SKIP LOCKED: a second worker in the same transaction sees the remaining row,
-- never the one already claimed.
create temp table claimed_b as
  select * from eworks.claim_deliveries('SMS', 5, 'worker-b');

select pg_temp.check('A second claim returns a disjoint set',
  not exists (select 1 from claimed_a a join claimed_b b using (delivery_id)));

select pg_temp.check('Claimed rows are marked CLAIMED with their worker',
  (select count(*) from eworks.notification_deliveries
    where status = 'CLAIMED' and claimed_by in ('worker-a','worker-b')) = 2);

-- Success.
select eworks.complete_delivery((select delivery_id from claimed_a), true, null);
select pg_temp.check('A successful delivery is DELIVERED with a timestamp',
  (select status = 'DELIVERED' and delivered_at is not null
     from eworks.notification_deliveries
    where id = (select delivery_id from claimed_a)));

-- Failure, five times, then DEAD. Never deleted.
select eworks.complete_delivery((select delivery_id from claimed_b), false, 'gateway timeout');
select pg_temp.check('A failed delivery is FAILED, retried later, with the error kept',
  (select status = 'FAILED' and attempts = 1 and last_error = 'gateway timeout'
       and next_attempt_at > now()
     from eworks.notification_deliveries
    where id = (select delivery_id from claimed_b)));

do $$
declare v_id bigint;
begin
  select delivery_id into v_id from claimed_b;
  for i in 2..5 loop
    update eworks.notification_deliveries set status = 'CLAIMED' where id = v_id;
    perform eworks.complete_delivery(v_id, false, 'gateway timeout');
  end loop;
end
$$;

select pg_temp.check('After five failures the delivery is DEAD, not deleted',
  (select status = 'DEAD' and last_error is not null
     from eworks.notification_deliveries
    where id = (select delivery_id from claimed_b)));

select pg_temp.check('A DEAD delivery is never claimed again',
  (select count(*) from eworks.claim_deliveries('SMS', 10, 'worker-c')
    where delivery_id = (select delivery_id from claimed_b)) = 0);

set local role postgres;
rollback;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: `ERROR: function eworks.claim_deliveries(...) does not exist`

- [ ] **Step 3: Append the worker contract**

```sql
-- ---------------------------------------------------------------------------
-- The outbox worker contract. Two functions; no table grants.
-- ---------------------------------------------------------------------------
--
-- s7 names pgmq. This is what pgmq is: SELECT ... FOR UPDATE SKIP LOCKED over
-- a table. Competing workers claim disjoint sets without blocking each other.

create or replace function eworks.claim_deliveries(
  p_channel eworks.notification_channel,
  p_limit   int,
  p_worker  text
)
returns table (
  delivery_id     bigint,
  event_type      eworks.notification_event_type,
  subject_id      uuid,
  recipient_phone text
)
language sql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  with due as (
    select d.id
      from eworks.notification_deliveries d
     where d.channel = p_channel
       and d.status in ('PENDING', 'FAILED')
       and d.next_attempt_at <= now()
     order by d.next_attempt_at
     limit p_limit
     for update skip locked
  ),
  claimed as (
    update eworks.notification_deliveries d
       set status = 'CLAIMED', claimed_at = now(), claimed_by = p_worker
      from due
     where d.id = due.id
     returning d.id, d.notification_id
  )
  select c.id,
         e.event_type,
         coalesce(e.order_id, e.vendor_id),
         u.phone
    from claimed c
    join eworks.notifications n   on n.id = c.notification_id
    join eworks.notification_events e on e.id = n.event_id
    join eworks.user_profiles u   on u.id = n.recipient_user_id;
$$;

-- Exponential backoff: 1, 4, 16, 64 minutes, then DEAD on the fifth failure.
-- The ceiling is operational policy, not an IS-code rule, so it is a constant
-- here rather than a row in eworks.settings.
create or replace function eworks.complete_delivery(
  p_delivery_id bigint,
  p_ok          boolean,
  p_error       text default null
)
returns void
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_attempts int;
begin
  if p_ok then
    update eworks.notification_deliveries
       set status = 'DELIVERED', delivered_at = now(), last_error = null
     where id = p_delivery_id;
    return;
  end if;

  update eworks.notification_deliveries
     set attempts = attempts + 1,
         last_error = p_error,
         claimed_at = null,
         claimed_by = null
   where id = p_delivery_id
   returning attempts into v_attempts;

  -- DEAD is visible, never silent. `select * from notification_deliveries where
  -- status = 'DEAD'` is the "who did we fail to reach" report, and for
  -- REVEAL_WINDOW_OPEN that is a list of vendors about to lose their EMD.
  if v_attempts >= 5 then
    update eworks.notification_deliveries
       set status = 'DEAD' where id = p_delivery_id;
  else
    update eworks.notification_deliveries
       set status = 'FAILED',
           next_attempt_at = now() + (interval '1 minute' * power(4, v_attempts - 1))
     where id = p_delivery_id;
  end if;
end;
$$;

revoke all on function eworks.claim_deliveries(eworks.notification_channel, int, text) from public;
revoke all on function eworks.complete_delivery(bigint, boolean, text) from public;

grant execute on function eworks.claim_deliveries(eworks.notification_channel, int, text)
  to eworks_notifier;
grant execute on function eworks.complete_delivery(bigint, boolean, text)
  to eworks_notifier;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash scripts/db-test.sh 2>&1 | tail -20`
Expected: all `pass:`, count = previous + 10.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000100_notifications.sql supabase/tests/09_notifications.sql
git commit -m "feat(notifications): claim_deliveries/complete_delivery outbox contract"
```

---

### Task 8: Harness fix and documentation

**Files:**
- Modify: `scripts/db-test.sh:22-32` (the `needs_postgis()` function) and `:60-69` (the migration loop)
- Modify: `README.md`
- Modify: `docs/security-gaps.md`
- Modify: `docs/superpowers/specs/2026-07-10-notifications-design.md`

**Interfaces:**
- Consumes: the final check count printed by `bash scripts/db-test.sh`
- Produces: a green suite and documentation that matches it

- [ ] **Step 1: Fix the latent `db-test.sh` bug and register Phase 6a**

The migration loop compares `$base` against `$NEEDS_POSTGIS_MIGRATION`, a variable assigned nowhere in the file. Under `set -euo pipefail` that aborts the script — but only on a cluster **without** PostGIS, which is why it has never fired. The `needs_postgis()` function directly above already does the job, and the *test* loop already calls it.

In `needs_postgis()`, add Phase 6a to both case arms:

```bash
    20260709001400_results_certificates_payments.sql)                return 0 ;;
    20260710000100_notifications.sql)                                return 0 ;;
    03_vendors.sql|04_pricing.sql|05_planner_and_orders.sql|06_sealed_bidding.sql|07_ground_execution.sql|08_results_and_payment.sql|09_notifications.sql) return 0 ;;
```

In the migration loop, replace the broken comparison with a call to that function:

```bash
for f in supabase/migrations/*.sql; do
  base=$(basename "$f")
  if [ "$has_postgis" -eq 0 ] && needs_postgis "$base"; then
    printf '    %-48s%s\n' "$base" 'SKIPPED (no postgis)'
    continue
  fi
  printf '    %-48s' "$base"
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
  echo 'ok'
done
```

Update the two closing messages so Phase 6a is named:

```bash
if [ "$has_postgis" -eq 0 ]; then
  echo "RESULT: $total checks passed -- PHASES 1-6a NOT VERIFIED (no PostGIS)"
else
  echo "RESULT: $total checks passed (Phases 0-6a)"
fi
```

- [ ] **Step 2: Prove the bug fix, by simulating a cluster without PostGIS**

Run: `PGDATABASE=eworks_nogis bash -c 'set -euo pipefail; source /dev/stdin <<< "$(sed s/has_postgis=.*/has_postgis=0/ scripts/db-test.sh)"' 2>&1 | tail -5`

Expected: the migration loop prints `SKIPPED (no postgis)` for the six PostGIS migrations and exits 0, rather than aborting with `NEEDS_POSTGIS_MIGRATION: unbound variable`. If your environment makes this awkward to simulate, the acceptable substitute is to confirm by inspection that `$NEEDS_POSTGIS_MIGRATION` no longer appears anywhere: `grep -c NEEDS_POSTGIS_MIGRATION scripts/db-test.sh` must print `0`.

- [ ] **Step 3: Record the real check count**

Run: `bash scripts/db-test.sh 2>&1 | tail -3`

Note the exact number `<N>` from `RESULT: <N> checks passed (Phases 0-6a)`. Use `<N>` verbatim in the next step. Do not write a predicted number.

- [ ] **Step 4: Update README.md**

Change the header line from `**304 checks pass**` to `**<N> checks pass**`.

Change the Phase 6 bullet from:

```
- **Phase 6 — not started.** Notifications (pgmq), vendor ratings, analytics.
```

to:

```
- **Phase 6a — complete and verified.** Notification events, payload-free
  recipient fan-out, and a plain outbox drained with `FOR UPDATE SKIP LOCKED`.
- **Phase 6b/6c — not started.** Vendor ratings, analytics.
```

Add to the "What exists" table:

```
| `…20260710000100_notifications.sql` | events, payload-free fan-out, outbox, `claim_deliveries()` / `complete_delivery()` |
```

Add to the checks bullet list:

```
- a vendor notified of a floated order, whose NABL then lapses, still holds the
  notification and reads **zero rows** from `test_orders` — a dead link, not a leak
- a vendor who never revealed is told nothing at award; the reveal notice it did
  receive is what the forfeiture rests on
- `eworks_authenticated` holds no privilege at all on the delivery outbox
- a delivery that exhausts its retries becomes `DEAD` and is never deleted
```

Add two divergences after the existing six:

```
7. **A plain outbox table, not `pgmq`.** §7 names pgmq; pgmq is tables and
   functions over `FOR UPDATE SKIP LOCKED`. A plain table gives identical
   semantics with no extension, so these migrations still run unchanged on a NIC
   or State Data Centre cluster — the same argument as divergence 1 — and Phase
   6a stays verifiable by `db-test.sh` on a stock PostgreSQL.

8. **Notifications carry no payload.** A recipient row names an event, never an
   order's content. §11 asks for a fast feed; a denormalised title would deliver
   one and would also become a disclosure channel that bypasses `test_orders`'
   RLS, permanently, for a vendor who has since become ineligible. The row is a
   pointer, and following it goes through live RLS.
```

Add to Operational notes:

```
- **Notifications are not audited.** The state change that produced each one
  already is, and `audit_logs_seal()` serialises every append behind an advisory
  lock. Fanning out inside it would put the PostGIS radius query behind the one
  global lock at exactly the bid-broadcast spike.
- **`notifications` is partition-ready, not partitioned.** The key is
  `(created_at, id)` and nothing references `notifications.id` alone. When you do
  partition, note that a partition queried **directly** enforces only its own
  grants and policies — never the parent's.
```

- [ ] **Step 5: Update docs/security-gaps.md**

Under gap 1, replace the closing paragraph:

```
**Still a policy decision, not a code one:** a vendor who never reveals is
marked `FORFEITED`, but the EMD penalty attached to that must be written into
the tender conditions. Without a penalty, non-revelation is a free option to
withdraw after seeing the field.
```

with:

```
**Still a policy decision, not a code one:** a vendor who never reveals is
marked `FORFEITED`, but the EMD penalty attached to that must be written into
the tender conditions. Without a penalty, non-revelation is a free option to
withdraw after seeing the field.

**The operational control that makes forfeiture fair** arrived in Phase 6a. A
`REVEAL_WINDOW_OPEN` notification fires on `DRAFT -> REVEALING` to every vendor
holding a `COMMITTED` bid, and `eworks.notification_deliveries` records whether
it was delivered and when. Before disqualifying anyone, run:

    select * from eworks.notification_deliveries where status = 'DEAD';

Those are vendors the system failed to reach. Forfeiting one of them is
indefensible, and now provably so.
```

- [ ] **Step 6: Back-patch the spec's delivery-enqueue gap**

In `docs/superpowers/specs/2026-07-10-notifications-design.md`, in the
`notification_deliveries` section, add after the table:

```
**What enqueues a delivery.** `emit_notification()` inserts one `PENDING` row
per notification on the `SMS` channel. `PUSH` exists in the enum but nothing
enqueues it: there is no device-token table, and inventing one is out of scope.
```

- [ ] **Step 7: Full verification**

Run: `bash scripts/db-test.sh`

Expected: every line is `pass:`, no `FAIL`, no `ERROR`, and the final line reads `RESULT: <N> checks passed (Phases 0-6a)` with the same `<N>` you wrote into the README.

Then confirm the docs match reality:

Run: `grep -c "304 checks" README.md`
Expected: `0`.

- [ ] **Step 8: Commit**

```bash
git add scripts/db-test.sh README.md docs/security-gaps.md docs/superpowers/specs/2026-07-10-notifications-design.md
git commit -m "fix(db-test): unset NEEDS_POSTGIS_MIGRATION; docs: Phase 6a"
```

---

## Self-review

**Spec coverage.** Every spec section maps to a task: three enums and three tables → Task 2; RLS, grants, `eworks_notifier` → Task 3; the fan-out primitive with its idempotency and partition-safety properties → Task 4; the vendor/order triggers, the dead-link property, `REVEAL_WINDOW_OPEN`, and fan-out-failure semantics → Task 5; award and the `FORFEITED`-gets-silence asymmetry → Task 6; the worker contract, backoff, and `DEAD` → Task 7; the harness bug, README, and security-gaps → Task 8. The spec's "Future partitioning" section is documentation only and is reproduced in the README under Operational notes; there is no code to write for it now, by design.

**Gap found and closed.** The spec never said what enqueues `notification_deliveries`. Resolved in Task 4's `emit_notification()` (one `PENDING` SMS row per notification, no `PUSH`), asserted by a test in Task 4, and back-patched into the spec in Task 8 Step 6.

**Type consistency.** `emit_notification(event_type, order_id, vendor_id, org_path, recipients uuid[]) → uuid` is defined in Task 4 and called with exactly that signature by all three trigger functions in Tasks 5–6. `claim_deliveries` returns `(delivery_id bigint, event_type, subject_id uuid, recipient_phone text)` in Task 7's interface block, its migration, and its test. `complete_delivery(bigint, boolean, text)` likewise. `notification_deliveries.id` is `bigint`, and every `delivery_id` that crosses a function boundary is `bigint`.

**Check-count honesty.** The plan does not assert a final number. Tasks 2–7 give a running expectation; Task 8 Step 3 reads the real count off the harness and writes *that* into the README. The 323 figure in the original brief was an estimate made before the tests were written, and several spec checks turned out to need two assertions. Never delete a passing check to match a prediction.

**One risk the plan does not remove.** Task 5's `ORDER_FLOATED` trigger runs the PostGIS radius query inside the float transaction. That is the spec's deliberate choice and it is correct at department scale, but it means a slow or failing PostGIS makes floating an order slow or impossible. The mitigation, if it ever binds, is to insert the event synchronously and expand recipients from the worker — a change confined to one trigger body.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-10-notifications.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
