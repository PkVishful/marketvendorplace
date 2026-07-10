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
