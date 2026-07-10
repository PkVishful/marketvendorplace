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
  (select array_agg(a.attname::text order by k.ord)
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

-- `found` is a PL/pgSQL-only variable and is not visible to a top-level psql
-- SELECT, so the affected-row count is captured with a CTE instead. The intent
-- is unchanged: the own-row UPDATE touches exactly one row.
with u as (
  update eworks.notifications set read_at = now()
   where id = '99999999-0000-0000-0000-000000000002'
  returning 1
)
select pg_temp.check('Marking own notification read succeeds',
  (select count(*) from u) = 1);

-- RLS refuses by making the row invisible. The UPDATE affects zero rows and
-- returns success -- which is exactly why the BFF must check the row count.
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000c', true); -- Vendor C
with u as (
  update eworks.notifications set read_at = now()
   where id = '99999999-0000-0000-0000-000000000002'
  returning 1
)
select pg_temp.check('Vendor C marking Vendor A''s notification read affects zero rows',
  (select count(*) from u) = 0);

-- The outbox is not user-facing at all. Not "policied" -- ungranted.
select pg_temp.check('eworks_authenticated has NO privilege on notification_deliveries',
  not has_table_privilege('eworks_authenticated', 'eworks.notification_deliveries', 'SELECT')
  and not has_table_privilege('eworks_authenticated', 'eworks.notification_deliveries', 'INSERT')
  and not has_table_privilege('eworks_authenticated', 'eworks.notification_deliveries', 'UPDATE')
  and not has_table_privilege('eworks_authenticated', 'eworks.notification_deliveries', 'DELETE'));

set local role postgres;
rollback;


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
