-- Phase 4 verification: commit-reveal sealed bidding and atomic L1 award.

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

-- Builds a FLOATED order whose windows are positioned relative to now(), so a
-- test can place it in the past to simulate a close without waiting.
create or replace function pg_temp.make_order(
  p_id uuid, p_float_offset interval, p_bid_window interval, p_reveal_window interval)
returns void language plpgsql as $$
begin
  insert into eworks.test_orders
    (id, project_id, org_unit_id, milestone, stage_id, site, status,
     floated_at, bid_close_at, reveal_close_at, required_by, created_by)
  select p_id, '11111111-0000-0000-0000-000000000008',
         '11111111-0000-0000-0000-000000000006', 'Pour '||left(p_id::text,4), cs.id,
         st_makepoint(76.9558, 11.0168)::geography, 'FLOATED',
         now() + p_float_offset,
         now() + p_float_offset + p_bid_window,
         now() + p_float_offset + p_bid_window + p_reveal_window,
         current_date + 30, '22222222-0000-0000-0000-00000000000d'
    from eworks.construction_stage cs where cs.code = 'SUPERSTRUCTURE';

  insert into eworks.order_items (order_id, test_id, quantity)
  select p_id, id, 6 from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH';
end;
$$;

-- Vendor A and Vendor C are both eligible for a cube order at the Coimbatore
-- site: A is 3 km away, C is in Salem but carries a 200 km service radius. Both
-- are priced by the fixtures, so both can quote. That gives a real two-horse
-- auction. Note the catalog price and the bid price are independent -- the bid
-- is what the lab actually quotes for this RFQ.

-- ===========================================================================
-- 1. The sealing property. This is the reason the scheme exists.
-- ===========================================================================
begin;
select pg_temp.make_order('77777777-0000-0000-0000-000000000001',
  interval '-1 hour', interval '2 hours', interval '1 hour');

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true); -- Vendor A

select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000001',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000001',
    '55555555-0000-0000-0000-00000000000a', 250000, 'nonce-a'));

set local role postgres;

-- The database physically does not hold the price. Not encrypted -- absent.
select pg_temp.check('A COMMITTED bid stores NO price anywhere',
  (select revealed_price_paise is null and nonce is null
     from eworks.order_bids where order_id = '77777777-0000-0000-0000-000000000001'));

select pg_temp.check('The stored commitment is a 32-byte digest',
  (select length(commitment) = 32
     from eworks.order_bids where order_id = '77777777-0000-0000-0000-000000000001'));

-- Even the table owner cannot recover the price. There is no key to steal.
select pg_temp.check('Even a superuser cannot read a price before reveal',
  (select count(*) from eworks.order_bids
    where order_id = '77777777-0000-0000-0000-000000000001'
      and revealed_price_paise is not null) = 0);

-- The audit trail must not become the side channel the sealing removed.
select pg_temp.check('The bid.commit audit row carries no price',
  (select not (payload ? 'price_paise') from eworks.audit_logs
    where action = 'bid.commit'));
rollback;


-- ===========================================================================
-- 2. The commitment binds order and vendor.
-- ===========================================================================
begin;
select pg_temp.check('Same price+nonce hashes differently per order',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000001',
    '55555555-0000-0000-0000-00000000000a', 250000, 'n')
  is distinct from
  eworks.bid_commitment('77777777-0000-0000-0000-000000000002',
    '55555555-0000-0000-0000-00000000000a', 250000, 'n'));

select pg_temp.check('Same price+nonce hashes differently per vendor',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000001',
    '55555555-0000-0000-0000-00000000000a', 250000, 'n')
  is distinct from
  eworks.bid_commitment('77777777-0000-0000-0000-000000000001',
    '55555555-0000-0000-0000-00000000000c', 250000, 'n'));

select pg_temp.check('A one-paisa price change changes the digest',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000001',
    '55555555-0000-0000-0000-00000000000a', 250000, 'n')
  is distinct from
  eworks.bid_commitment('77777777-0000-0000-0000-000000000001',
    '55555555-0000-0000-0000-00000000000a', 250001, 'n'));
rollback;


-- ===========================================================================
-- 3. Bid window enforcement and the eligibility lock.
-- ===========================================================================
begin;
-- Bidding already closed an hour ago.
select pg_temp.make_order('77777777-0000-0000-0000-000000000003',
  interval '-3 hours', interval '2 hours', interval '1 hour');

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select pg_temp.check_raises('A bid after bid_close_at is rejected on wall-clock',
  $$select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000003',
      eworks.bid_commitment('77777777-0000-0000-0000-000000000003',
        '55555555-0000-0000-0000-00000000000a', 250000, 'x'))$$);
rollback;

begin;
select pg_temp.make_order('77777777-0000-0000-0000-000000000004',
  interval '-1 hour', interval '2 hours', interval '1 hour');

set local role eworks_authenticated;

-- Vendor D: expired NABL. Must not be able to bid on a NABL test.
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000d', true);
select pg_temp.check_raises('Expired-NABL vendor cannot commit a bid',
  $$select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000004',
      eworks.bid_commitment('77777777-0000-0000-0000-000000000004',
        '55555555-0000-0000-0000-00000000000d', 1, 'x'))$$);

-- Vendor B: out of radius.
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000b', true);
select pg_temp.check_raises('Out-of-radius vendor cannot commit a bid',
  $$select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000004',
      eworks.bid_commitment('77777777-0000-0000-0000-000000000004',
        '55555555-0000-0000-0000-00000000000b', 1, 'x'))$$);

-- Vendor A: eligible. One bid only.
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000004',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000004',
    '55555555-0000-0000-0000-00000000000a', 250000, 'n'));

select pg_temp.check_raises('A vendor cannot commit twice to one order',
  $$select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000004',
      eworks.bid_commitment('77777777-0000-0000-0000-000000000004',
        '55555555-0000-0000-0000-00000000000a', 240000, 'n2'))$$);

-- Direct DML must be impossible: the functions carry the window, eligibility
-- and hash checks, so a raw INSERT would bypass every one of them.
select pg_temp.check('eworks_authenticated has no INSERT on order_bids',
  has_table_privilege('eworks_authenticated','eworks.order_bids','INSERT') = false);
select pg_temp.check('eworks_authenticated has no UPDATE on order_bids',
  has_table_privilege('eworks_authenticated','eworks.order_bids','UPDATE') = false);
rollback;


-- ===========================================================================
-- 4. Bid secrecy between the parties.
-- ===========================================================================
begin;
select pg_temp.make_order('77777777-0000-0000-0000-000000000005',
  interval '-1 hour', interval '2 hours', interval '1 hour');

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000005',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000005',
    '55555555-0000-0000-0000-00000000000a', 250000, 'na'));

select set_config('app.user_id', '44444444-0000-0000-0000-00000000000c', true); -- Vendor C
select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000005',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000005',
    '55555555-0000-0000-0000-00000000000c', 300000, 'nc'));

select pg_temp.check('Vendor C sees only its own bid',
  (select count(*) from eworks.order_bids
    where order_id = '77777777-0000-0000-0000-000000000005') = 1);

-- An officer who can count bids during the float knows how much competition a
-- favoured vendor faces. Even the bid COUNT is information.
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000b', true); -- District officer
select pg_temp.check('Officer sees ZERO bids while the order is still FLOATED',
  (select count(*) from eworks.order_bids
    where order_id = '77777777-0000-0000-0000-000000000005') = 0);
rollback;


-- ===========================================================================
-- 5. Reveal verification. The heart of the scheme.
-- ===========================================================================
begin;
select pg_temp.make_order('77777777-0000-0000-0000-000000000006',
  interval '-3 hours', interval '2 hours', interval '2 hours');

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);

-- Committed a moment before close: rewind the window so the bid lands inside it.
set local role postgres;
update eworks.test_orders set bid_close_at = now() + interval '1 minute'
 where id = '77777777-0000-0000-0000-000000000006';
set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000006',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000006',
    '55555555-0000-0000-0000-00000000000a', 250000, 'secret-nonce'));

-- Cannot reveal while bidding is still open.
select pg_temp.check_raises('Cannot reveal before the order reaches REVEALING',
  $$select eworks.reveal_bid('77777777-0000-0000-0000-000000000006', 250000, 'secret-nonce')$$);

set local role postgres;
update eworks.test_orders set bid_close_at = now() - interval '1 minute'
 where id = '77777777-0000-0000-0000-000000000006';
select eworks.close_bidding('77777777-0000-0000-0000-000000000006');
select pg_temp.check('close_bidding moves FLOATED -> REVEALING',
  (select status from eworks.test_orders
    where id='77777777-0000-0000-0000-000000000006') = 'REVEALING');

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);

-- A vendor who wants to undercut a rival must produce a preimage of the digest
-- for a different price. They cannot.
select pg_temp.check_raises('Revealing a LOWER price than committed is rejected',
  $$select eworks.reveal_bid('77777777-0000-0000-0000-000000000006', 100000, 'secret-nonce')$$);

select pg_temp.check_raises('Revealing with the wrong nonce is rejected',
  $$select eworks.reveal_bid('77777777-0000-0000-0000-000000000006', 250000, 'wrong-nonce')$$);

select pg_temp.check('The honest reveal succeeds',
  (eworks.reveal_bid('77777777-0000-0000-0000-000000000006', 250000, 'secret-nonce')).status
    = 'REVEALED');

select pg_temp.check_raises('Cannot reveal the same bid twice',
  $$select eworks.reveal_bid('77777777-0000-0000-0000-000000000006', 250000, 'secret-nonce')$$);
rollback;


-- ===========================================================================
-- 6. Award: L1 among the qualified, exactly one winner.
-- ===========================================================================
begin;
select pg_temp.make_order('77777777-0000-0000-0000-000000000007',
  interval '-5 hours', interval '2 hours', interval '2 hours');
-- Reopen the bid window. reveal_close_at must move with it: the check
-- constraint requires reveal_close_at > bid_close_at, and make_order()
-- placed both in the past.
update eworks.test_orders
   set bid_close_at    = now() + interval '1 minute',
       reveal_close_at = now() + interval '2 hours'
 where id='77777777-0000-0000-0000-000000000007';

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000007',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000007',
    '55555555-0000-0000-0000-00000000000a', 250000, 'na'));
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000c', true);
select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000007',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000007',
    '55555555-0000-0000-0000-00000000000c', 180000, 'nc'));   -- C is cheaper

set local role postgres;
update eworks.test_orders
   set bid_close_at = now() - interval '1 minute',
       reveal_close_at = now() + interval '1 hour'
 where id='77777777-0000-0000-0000-000000000007';
select eworks.close_bidding('77777777-0000-0000-0000-000000000007');

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select eworks.reveal_bid('77777777-0000-0000-0000-000000000007', 250000, 'na');
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000c', true);
select eworks.reveal_bid('77777777-0000-0000-0000-000000000007', 180000, 'nc');

set local role postgres;
select pg_temp.check_raises('Cannot award while the reveal window is open',
  $$select eworks.finalize_award('77777777-0000-0000-0000-000000000007')$$);

update eworks.test_orders set reveal_close_at = now() - interval '1 second'
 where id='77777777-0000-0000-0000-000000000007';

select pg_temp.check('L1 wins: the cheaper qualified bid takes the award',
  (eworks.finalize_award('77777777-0000-0000-0000-000000000007')).vendor_id
    = '55555555-0000-0000-0000-00000000000c');

select pg_temp.check('The award records the revealed price',
  (select price_paise from eworks.order_award
    where order_id='77777777-0000-0000-0000-000000000007') = 180000);

select pg_temp.check('The award records how many qualified bids it beat',
  (select qualified_bid_count from eworks.order_award
    where order_id='77777777-0000-0000-0000-000000000007') = 2);

select pg_temp.check('Order is now AWARDED',
  (select status from eworks.test_orders
    where id='77777777-0000-0000-0000-000000000007') = 'AWARDED');

-- Exactly one winner, enforced by the primary key rather than by hope.
select pg_temp.check_raises('A second award for the same order is impossible',
  $$insert into eworks.order_award (order_id, bid_id, vendor_id, price_paise,
      eval_method, qualified_bid_count)
    select '77777777-0000-0000-0000-000000000007', id,
           '55555555-0000-0000-0000-00000000000a', 250000, 'L1', 1
      from eworks.order_bids
     where order_id='77777777-0000-0000-0000-000000000007'
       and vendor_id='55555555-0000-0000-0000-00000000000a'$$);

select pg_temp.check_raises('Re-awarding an AWARDED order is refused',
  $$select eworks.finalize_award('77777777-0000-0000-0000-000000000007')$$);

select pg_temp.check('The audit chain survives the whole auction',
  eworks.verify_audit_chain() is null);
rollback;


-- ===========================================================================
-- 7. Forfeiture, disqualification, and failure modes.
-- ===========================================================================
begin;
select pg_temp.make_order('77777777-0000-0000-0000-000000000008',
  interval '-5 hours', interval '2 hours', interval '2 hours');
-- Reopen the bid window. reveal_close_at must move with it: the check
-- constraint requires reveal_close_at > bid_close_at, and make_order()
-- placed both in the past.
update eworks.test_orders
   set bid_close_at    = now() + interval '1 minute',
       reveal_close_at = now() + interval '2 hours'
 where id='77777777-0000-0000-0000-000000000008';

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000008',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000008',
    '55555555-0000-0000-0000-00000000000a', 250000, 'na'));
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000c', true);
select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000008',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000008',
    '55555555-0000-0000-0000-00000000000c', 180000, 'nc'));

set local role postgres;
update eworks.test_orders
   set bid_close_at = now() - interval '1 minute', reveal_close_at = now() + interval '1 hour'
 where id='77777777-0000-0000-0000-000000000008';
select eworks.close_bidding('77777777-0000-0000-0000-000000000008');

-- Only A reveals. C -- the cheaper bidder -- stays silent, hoping to walk away.
set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select eworks.reveal_bid('77777777-0000-0000-0000-000000000008', 250000, 'na');

set local role postgres;
update eworks.test_orders set reveal_close_at = now() - interval '1 second'
 where id='77777777-0000-0000-0000-000000000008';
select eworks.finalize_award('77777777-0000-0000-0000-000000000008');

select pg_temp.check('The silent bidder is FORFEITED',
  (select status from eworks.order_bids
    where order_id='77777777-0000-0000-0000-000000000008'
      and vendor_id='55555555-0000-0000-0000-00000000000c') = 'FORFEITED');

select pg_temp.check('The award goes to the only revealer, at its own price',
  (select vendor_id = '55555555-0000-0000-0000-00000000000a' and price_paise = 250000
     from eworks.order_award where order_id='77777777-0000-0000-0000-000000000008'));

select pg_temp.check('A single-bid tender is recorded as such',
  (select qualified_bid_count from eworks.order_award
    where order_id='77777777-0000-0000-0000-000000000008') = 1);
rollback;


-- Accreditation lapsing between commit and award must disqualify.
begin;
select pg_temp.make_order('77777777-0000-0000-0000-000000000009',
  interval '-5 hours', interval '2 hours', interval '2 hours');
-- Reopen the bid window. reveal_close_at must move with it: the check
-- constraint requires reveal_close_at > bid_close_at, and make_order()
-- placed both in the past.
update eworks.test_orders
   set bid_close_at    = now() + interval '1 minute',
       reveal_close_at = now() + interval '2 hours'
 where id='77777777-0000-0000-0000-000000000009';

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select eworks.submit_bid_commitment('77777777-0000-0000-0000-000000000009',
  eworks.bid_commitment('77777777-0000-0000-0000-000000000009',
    '55555555-0000-0000-0000-00000000000a', 250000, 'na'));

set local role postgres;
update eworks.test_orders
   set bid_close_at = now() - interval '1 minute', reveal_close_at = now() + interval '1 hour'
 where id='77777777-0000-0000-0000-000000000009';
select eworks.close_bidding('77777777-0000-0000-0000-000000000009');

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select eworks.reveal_bid('77777777-0000-0000-0000-000000000009', 250000, 'na');

-- Vendor A's NABL lapses after it revealed. It cannot legally perform the test.
set local role postgres;
update eworks.vendors set nabl_valid_until = current_date - 1
 where id = '55555555-0000-0000-0000-00000000000a';
update eworks.test_orders set reveal_close_at = now() - interval '1 second'
 where id='77777777-0000-0000-0000-000000000009';

select pg_temp.check('finalize_award returns NULL when nobody qualifies',
  eworks.finalize_award('77777777-0000-0000-0000-000000000009') is null);

select pg_temp.check('The lapsed bidder is DISQUALIFIED, not awarded',
  (select status from eworks.order_bids
    where order_id='77777777-0000-0000-0000-000000000009') = 'DISQUALIFIED');

select pg_temp.check('The order FAILED rather than awarding to an unqualified lab',
  (select status from eworks.test_orders
    where id='77777777-0000-0000-0000-000000000009') = 'FAILED');

select pg_temp.check('No award row exists',
  (select count(*) from eworks.order_award
    where order_id='77777777-0000-0000-0000-000000000009') = 0);
rollback;


-- An order that attracts no bids at all must FAIL at close, not hang in
-- REVEALING waiting for reveals that can never arrive.
begin;
select pg_temp.make_order('77777777-0000-0000-0000-00000000000a',
  interval '-3 hours', interval '2 hours', interval '1 hour');
select eworks.close_bidding('77777777-0000-0000-0000-00000000000a');
select pg_temp.check('An order with zero bids FAILS at close',
  (select status from eworks.test_orders
    where id='77777777-0000-0000-0000-00000000000a') = 'FAILED');
rollback;


-- ===========================================================================
-- 8. Bid immutability and the pg_cron sweepers.
-- ===========================================================================
begin;
select pg_temp.make_order('77777777-0000-0000-0000-00000000000b',
  interval '-1 hour', interval '2 hours', interval '1 hour');

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true);
select eworks.submit_bid_commitment('77777777-0000-0000-0000-00000000000b',
  eworks.bid_commitment('77777777-0000-0000-0000-00000000000b',
    '55555555-0000-0000-0000-00000000000a', 250000, 'na'));

set local role postgres;
select pg_temp.check_raises('The commitment itself is immutable',
  $$update eworks.order_bids set commitment = decode(repeat('ff',32),'hex')
     where order_id='77777777-0000-0000-0000-00000000000b'$$);

select pg_temp.check_raises('A bid cannot be moved to another vendor',
  $$update eworks.order_bids set vendor_id='55555555-0000-0000-0000-00000000000c'
     where order_id='77777777-0000-0000-0000-00000000000b'$$);
rollback;


begin;
-- Two orders due to close, one not yet due.
select pg_temp.make_order('77777777-0000-0000-0000-00000000000c',
  interval '-3 hours', interval '2 hours', interval '1 hour');
select pg_temp.make_order('77777777-0000-0000-0000-00000000000d',
  interval '-3 hours', interval '2 hours', interval '1 hour');
select pg_temp.make_order('77777777-0000-0000-0000-00000000000e',
  interval '-1 minute', interval '2 hours', interval '1 hour');

select pg_temp.check('sweep_close_bidding closes exactly the two due orders',
  eworks.sweep_close_bidding() = 2);

select pg_temp.check('The not-yet-due order is untouched and still FLOATED',
  (select status from eworks.test_orders
    where id='77777777-0000-0000-0000-00000000000e') = 'FLOATED');

select pg_temp.check('Both due orders FAILED (they had no bids)',
  (select count(*) from eworks.test_orders
    where id in ('77777777-0000-0000-0000-00000000000c',
                 '77777777-0000-0000-0000-00000000000d')
      and status = 'FAILED') = 2);

select pg_temp.check('The sweeper is idempotent: a second pass closes nothing',
  eworks.sweep_close_bidding() = 0);
rollback;

\echo ''
\echo ' PHASE 4 CHECKS COMPLETE'
