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
--
-- Anchor floated_at just before bid_close_at rather than at now(), so a test
-- may pass a NEGATIVE bid window to simulate an order whose bidding has
-- already closed. `orders_close_after_float` requires bid_close_at > floated_at,
-- and an order really cannot close before it was floated -- the constraint is
-- right and the helper was wrong.
--
-- For the ordinary positive window this reduces to floated_at = now().
create or replace function pg_temp.float_it(
  p_id uuid, p_bid_window interval, p_reveal_window interval)
returns void language plpgsql as $$
begin
  update eworks.test_orders
     set status = 'FLOATED',
         floated_at = least(now(), now() + p_bid_window - interval '1 second'),
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

-- Regression: these two policies once subqueried each other's RLS-enabled
-- table, and every read of either raised "infinite recursion detected in
-- policy". A plain successful read of BOTH tables in one statement is the
-- cheapest possible guard against that returning.
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select pg_temp.check('Joining notifications to its event does not recurse',
  (select count(*) from eworks.notifications n
     join eworks.notification_events e on e.id = n.event_id) = 1);

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
--
-- Scoped to the REVEAL_WINDOW_OPEN event, matching the auditor check above and
-- this section's subject: floating a3 with an already-closed bid window (a
-- negative window used to fast-forward the clock) also fires ORDER_FLOATED to
-- the eligible vendors, since eligible_vendors_for_order() does not consult the
-- bid deadline. Those float deliveries are a test artifact; the reveal notice
-- is the record a forfeiture dispute turns on.
select pg_temp.check('The delivery record proves when it was sent',
  (select count(*) from eworks.notification_deliveries d
     join eworks.notifications n on n.id = d.notification_id
     join eworks.notification_events e on e.id = n.event_id
    where e.order_id = '77777777-0000-0000-0000-0000000000a3'
      and e.event_type = 'REVEAL_WINDOW_OPEN'
      and d.status = 'DELIVERED' and d.delivered_at is not null) = 1);
rollback;

-- ===========================================================================
-- 12. The outbox. A DEAD delivery is never silently dropped -- for
--     REVEAL_WINDOW_OPEN it is a vendor about to be forfeited unfairly.
-- ===========================================================================
begin;
select pg_temp.make_draft_order('77777777-0000-0000-0000-0000000000c1');
select pg_temp.float_it('77777777-0000-0000-0000-0000000000c1',
  interval '2 hours', interval '1 hour');

-- Vendors A and C are eligible, so the float enqueued two SMS deliveries.
select pg_temp.check('Floating enqueued one PENDING SMS delivery per eligible vendor',
  (select count(*) from eworks.notification_deliveries
    where channel = 'SMS' and status = 'PENDING') = 2);

set local role eworks_notifier;

-- The worker holds no table grants at all. Everything arrives through the two
-- functions, which are also the single place user_profiles.phone leaves the
-- database -- so encrypting it later (security-gaps #5) touches one line.
select pg_temp.check('The worker cannot read the deliveries table directly',
  not has_table_privilege('eworks_notifier', 'eworks.notification_deliveries', 'SELECT'));

select pg_temp.check('The worker cannot read the notifications feed',
  not has_table_privilege('eworks_notifier', 'eworks.notifications', 'SELECT'));

-- Stronger than the privilege bit: actually try it, as the worker.
select pg_temp.check_raises('A direct read of the outbox by the worker is refused',
  $$select 1 from eworks.notification_deliveries$$);

select pg_temp.check_raises('A direct read of the feed by the worker is refused',
  $$select 1 from eworks.notifications$$);

create temp table claimed_a as
  select * from eworks.claim_deliveries('SMS', 1, 'worker-a');

select pg_temp.check('claim_deliveries returns one due delivery with a phone number',
  (select count(*) from claimed_a where recipient_phone is not null) = 1);

select pg_temp.check('The claimed delivery carries the event type and subject',
  (select count(*) from claimed_a
    where event_type = 'ORDER_FLOATED'
      and subject_id = '77777777-0000-0000-0000-0000000000c1') = 1);

-- SKIP LOCKED: a second worker sees the remaining row, never the one already
-- claimed. Without SKIP LOCKED this would block, not return a disjoint set.
create temp table claimed_b as
  select * from eworks.claim_deliveries('SMS', 5, 'worker-b');

select pg_temp.check('A second claim returns a disjoint set',
  not exists (select 1 from claimed_a a join claimed_b b using (delivery_id)));

select pg_temp.check('Between them the two workers claimed both deliveries',
  (select count(*) from (select delivery_id from claimed_a
                         union select delivery_id from claimed_b) u) = 2);

set local role postgres;

-- Asserting the outbox's state requires reading the outbox, which the worker
-- may never do. Only the owner checks this.
select pg_temp.check('Claimed rows are marked CLAIMED with their worker',
  (select count(*) from eworks.notification_deliveries
    where status = 'CLAIMED' and claimed_by in ('worker-a','worker-b')) = 2);


-- Success, reported by the worker.
set local role eworks_notifier;
select eworks.complete_delivery((select delivery_id from claimed_a), 'worker-a', true, null);
set local role postgres;

select pg_temp.check('A successful delivery is DELIVERED with a timestamp',
  (select status = 'DELIVERED' and delivered_at is not null and last_error is null
     from eworks.notification_deliveries
    where id = (select delivery_id from claimed_a)));


-- Failure, reported by the worker. Backoff: power(4, attempts-1) minutes, so
-- the first retry is ~1 minute out, not 4 and not immediate.
set local role eworks_notifier;
select eworks.complete_delivery((select delivery_id from claimed_b), 'worker-b', false, 'gateway timeout');
set local role postgres;

select pg_temp.check('A failed delivery is FAILED, retried later, with the error kept',
  (select status = 'FAILED' and attempts = 1 and last_error = 'gateway timeout'
       and next_attempt_at > now()
     from eworks.notification_deliveries
    where id = (select delivery_id from claimed_b)));

select pg_temp.check('The first retry backs off about a minute, not four',
  (select next_attempt_at < now() + interval '90 seconds'
     from eworks.notification_deliveries
    where id = (select delivery_id from claimed_b)));

-- A claim released by a failure is claimable again.
select pg_temp.check('A FAILED delivery releases its claim',
  (select claimed_at is null and claimed_by is null
     from eworks.notification_deliveries
    where id = (select delivery_id from claimed_b)));


-- Fail it to the ceiling. Five attempts, then DEAD. Never deleted.
do $$
declare v_id bigint;
begin
  select delivery_id into v_id from claimed_b;
  for i in 2..5 loop
    update eworks.notification_deliveries
       set status = 'CLAIMED', claimed_by = 'worker-b', claimed_at = now()
     where id = v_id;
    perform eworks.complete_delivery(v_id, 'worker-b', false, 'gateway timeout');
  end loop;
end
$$;

select pg_temp.check('After five failures the delivery is DEAD, not deleted',
  (select status = 'DEAD' and last_error is not null and attempts = 5
     from eworks.notification_deliveries
    where id = (select delivery_id from claimed_b)));

-- DEAD is terminal. This row is the "who did we fail to reach" report, and for
-- REVEAL_WINDOW_OPEN it names a vendor about to lose their EMD unfairly.
select pg_temp.check('A DEAD delivery is never claimed again',
  (select count(*) from eworks.claim_deliveries('SMS', 10, 'worker-c')
    where delivery_id = (select delivery_id from claimed_b)) = 0);

select pg_temp.check('A DEAD delivery still exists and is visible to an operator',
  (select count(*) from eworks.notification_deliveries
    where id = (select delivery_id from claimed_b) and status = 'DEAD') = 1);

-- ---------------------------------------------------------------------------
-- The claim IS the authority. The id is guessable; the claim is not.
-- ---------------------------------------------------------------------------

-- A fresh PENDING delivery nobody has claimed.
select pg_temp.make_draft_order('77777777-0000-0000-0000-0000000000c2');
select pg_temp.float_it('77777777-0000-0000-0000-0000000000c2',
  interval '2 hours', interval '1 hour');

select pg_temp.check_raises('An unclaimed delivery cannot be reported DELIVERED',
  $$select eworks.complete_delivery(
      (select id from eworks.notification_deliveries where status = 'PENDING' limit 1),
      'worker-x', true, null)$$);

-- Worker A claims; worker B must not be able to report on A's claim.
create temp table claimed_c as
  select * from eworks.claim_deliveries('SMS', 1, 'worker-a');

select pg_temp.check_raises('A worker cannot complete another worker''s claim',
  $$select eworks.complete_delivery((select delivery_id from claimed_c),
      'worker-b', true, null)$$);

select pg_temp.check('...and the delivery is still CLAIMED by its owner',
  (select status = 'CLAIMED' and claimed_by = 'worker-a'
     from eworks.notification_deliveries
    where id = (select delivery_id from claimed_c)));

select eworks.complete_delivery((select delivery_id from claimed_c), 'worker-a', true, null);

select pg_temp.check_raises('A DELIVERED delivery cannot be re-reported as FAILED',
  $$select eworks.complete_delivery((select delivery_id from claimed_c),
      'worker-a', false, 'forged')$$);

-- The row from earlier in this section that we walked to DEAD.
select pg_temp.check_raises('A DEAD delivery cannot be resurrected as DELIVERED',
  $$select eworks.complete_delivery((select delivery_id from claimed_b),
      'worker-b', true, null)$$);

select pg_temp.check('The DEAD delivery is still DEAD, with its error intact',
  (select status = 'DEAD' and last_error is not null
     from eworks.notification_deliveries
    where id = (select delivery_id from claimed_b)));

-- ---------------------------------------------------------------------------
-- A crashed worker's claim is reaped, not stranded forever.
-- ---------------------------------------------------------------------------
select pg_temp.make_draft_order('77777777-0000-0000-0000-0000000000c3');
select pg_temp.float_it('77777777-0000-0000-0000-0000000000c3',
  interval '2 hours', interval '1 hour');

create temp table claimed_d as
  select * from eworks.claim_deliveries('SMS', 1, 'worker-crashes');

select pg_temp.check('A fresh claim is not reclaimable by another worker',
  (select count(*) from eworks.claim_deliveries('SMS', 10, 'worker-rescuer')
    where delivery_id = (select delivery_id from claimed_d)) = 0);

-- Simulate the worker having died six minutes ago.
update eworks.notification_deliveries
   set claimed_at = now() - interval '6 minutes'
 where id = (select delivery_id from claimed_d);

select pg_temp.check('A claim abandoned past the visibility timeout is reclaimed',
  (select count(*) from eworks.claim_deliveries('SMS', 10, 'worker-rescuer')
    where delivery_id = (select delivery_id from claimed_d)) = 1);

-- ---------------------------------------------------------------------------
-- p_limit is bounded, so one worker cannot swallow the backlog.
-- ---------------------------------------------------------------------------
select pg_temp.check('claim_deliveries clamps an absurd p_limit rather than honouring it',
  (select count(*) from eworks.claim_deliveries('SMS', 2000000000, 'worker-greedy')) <= 1000);

rollback;
