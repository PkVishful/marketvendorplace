-- Phase 5a verification: geo-fenced check-in, serialized QR, hash-chained
-- chain of custody.

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

-- A technician employed by Vendor A.
begin;
insert into eworks.user_profiles (id, phone, full_name) values
  ('44444444-0000-0000-0000-00000000000f', '9100000009', 'Vendor A Technician')
on conflict (id) do nothing;
insert into eworks.user_roles (user_id, role_code, org_unit_id) values
  ('44444444-0000-0000-0000-00000000000f','FIELD_TECHNICIAN',
   '11111111-0000-0000-0000-000000000002')
on conflict do nothing;
commit;

-- Runs a complete auction and returns an AWARDED order won by Vendor A.
create or replace function pg_temp.awarded_order(p_id uuid)
returns void language plpgsql as $$
begin
  insert into eworks.test_orders
    (id, project_id, org_unit_id, milestone, stage_id, site, status,
     floated_at, bid_close_at, reveal_close_at, required_by, created_by)
  select p_id, '11111111-0000-0000-0000-000000000008',
         '11111111-0000-0000-0000-000000000006', 'Pour X', cs.id,
         st_makepoint(76.9558, 11.0168)::geography, 'FLOATED',
         now() - interval '1 hour', now() + interval '1 minute',
         now() + interval '2 hours', current_date + 30,
         '22222222-0000-0000-0000-00000000000d'
    from eworks.construction_stage cs where cs.code = 'SUPERSTRUCTURE';

  insert into eworks.order_items (order_id, test_id, quantity, test_ages_days)
  select p_id, id, 6, '{7,28}' from eworks.test_catalog
   where code = 'CONCRETE_CUBE_STRENGTH';

  perform set_config('app.user_id','44444444-0000-0000-0000-00000000000a', true);
  perform eworks.submit_bid_commitment(p_id,
    eworks.bid_commitment(p_id,'55555555-0000-0000-0000-00000000000a', 250000,'n'));

  update eworks.test_orders
     set bid_close_at = now() - interval '1 minute',
         reveal_close_at = now() + interval '1 hour'
   where id = p_id;
  perform eworks.close_bidding(p_id);
  perform eworks.reveal_bid(p_id, 250000, 'n');

  update eworks.test_orders set reveal_close_at = now() - interval '1 second'
   where id = p_id;
  perform eworks.finalize_award(p_id);

  insert into eworks.test_jobs (id, order_id, vendor_id, technician_id)
  values (p_id, p_id, '55555555-0000-0000-0000-00000000000a',
          '44444444-0000-0000-0000-00000000000f');
end;
$$;


-- ===========================================================================
-- 1. A job exists only for an AWARDED order, and only for the winner.
-- ===========================================================================
begin;
insert into eworks.test_orders
  (id, project_id, org_unit_id, milestone, stage_id, site, required_by, created_by)
select '88888888-0000-0000-0000-00000000000d',
       '11111111-0000-0000-0000-000000000008','11111111-0000-0000-0000-000000000006',
       'Draft', cs.id, st_makepoint(76.9558,11.0168)::geography,
       current_date+30, '22222222-0000-0000-0000-00000000000d'
  from eworks.construction_stage cs where cs.code='SUPERSTRUCTURE';

select pg_temp.check_raises('No job for a DRAFT order',
  $$insert into eworks.test_jobs (order_id, vendor_id)
    values ('88888888-0000-0000-0000-00000000000d',
            '55555555-0000-0000-0000-00000000000a')$$);
rollback;

begin;
select pg_temp.awarded_order('88888888-0000-0000-0000-000000000001');
select pg_temp.check('A job exists for the awarded order',
  (select count(*) from eworks.test_jobs
    where id='88888888-0000-0000-0000-000000000001') = 1);

select pg_temp.check_raises('A losing vendor cannot be given the job',
  $$update eworks.test_jobs set vendor_id='55555555-0000-0000-0000-00000000000c'
     where id='88888888-0000-0000-0000-000000000001'$$);
rollback;


-- ===========================================================================
-- 2. The geofence. Distance is computed by PostGIS, never sent by the client.
-- ===========================================================================
begin;
select pg_temp.awarded_order('88888888-0000-0000-0000-000000000002');

set local role eworks_authenticated;
select set_config('app.user_id','44444444-0000-0000-0000-00000000000f', true); -- technician

-- ~910 m north of the site. The device can claim whatever it likes; PostGIS
-- disagrees.
select pg_temp.check_raises('Check-in outside the 150 m fence is rejected',
  $$select eworks.check_in('88888888-0000-0000-0000-000000000002',
      11.0250, 76.9558, 10, 'device-1', decode(repeat('a1',32),'hex'), now())$$);

-- Inside the fence, but the reading is worthless.
select pg_temp.check_raises('Check-in with 200 m GPS accuracy is rejected',
  $$select eworks.check_in('88888888-0000-0000-0000-000000000002',
      11.01760, 76.9558, 200, 'device-1', decode(repeat('a2',32),'hex'), now())$$);

-- The device clock is attacker-controlled.
select pg_temp.check_raises('Check-in with a 2-hour clock skew is rejected',
  $$select eworks.check_in('88888888-0000-0000-0000-000000000002',
      11.01760, 76.9558, 10, 'device-1', decode(repeat('a3',32),'hex'),
      now() - interval '2 hours')$$);

-- Only the assigned technician.
select set_config('app.user_id','44444444-0000-0000-0000-00000000000a', true); -- vendor owner
select pg_temp.check_raises('A different user cannot check in for the technician',
  $$select eworks.check_in('88888888-0000-0000-0000-000000000002',
      11.01760, 76.9558, 10, 'device-1', decode(repeat('a4',32),'hex'), now())$$);

-- The honest path.
select set_config('app.user_id','44444444-0000-0000-0000-00000000000f', true);
select pg_temp.check('A valid check-in succeeds',
  (eworks.check_in('88888888-0000-0000-0000-000000000002',
     11.01760, 76.9558, 10, 'device-1', decode(repeat('a5',32),'hex'), now())).id
   is not null);

set local role postgres;
select pg_temp.check('The server recorded a distance under the fence',
  (select distance_m < 150 and distance_m > 50
     from eworks.site_checkins where job_id='88888888-0000-0000-0000-000000000002'));

select pg_temp.check('The job is CHECKED_IN and the device is bound',
  (select status = 'CHECKED_IN' and device_id = 'device-1'
     from eworks.test_jobs where id='88888888-0000-0000-0000-000000000002'));

set local role eworks_authenticated;
select set_config('app.user_id','44444444-0000-0000-0000-00000000000f', true);
select pg_temp.check_raises('A job cannot be checked in twice',
  $$select eworks.check_in('88888888-0000-0000-0000-000000000002',
      11.01760, 76.9558, 10, 'device-1', decode(repeat('a6',32),'hex'), now())$$);
rollback;


-- A photo may be used exactly once, anywhere. Re-using yesterday's site photo
-- for today's pour is the cheapest fraud there is.
begin;
select pg_temp.awarded_order('88888888-0000-0000-0000-000000000003');
select pg_temp.awarded_order('88888888-0000-0000-0000-000000000004');

set local role eworks_authenticated;
select set_config('app.user_id','44444444-0000-0000-0000-00000000000f', true);
select eworks.check_in('88888888-0000-0000-0000-000000000003',
  11.01760, 76.9558, 10, 'device-1', decode(repeat('bb',32),'hex'), now());

select pg_temp.check_raises('The same photo cannot be reused on another job',
  $$select eworks.check_in('88888888-0000-0000-0000-000000000004',
      11.01760, 76.9558, 10, 'device-1', decode(repeat('bb',32),'hex'), now())$$);
rollback;


-- ===========================================================================
-- 3. Serialized QR.
-- ===========================================================================
begin;
select pg_temp.awarded_order('88888888-0000-0000-0000-000000000005');
set local role eworks_authenticated;
select set_config('app.user_id','44444444-0000-0000-0000-00000000000f', true);
select eworks.check_in('88888888-0000-0000-0000-000000000005',
  11.01760, 76.9558, 10, 'device-1', decode(repeat('c1',32),'hex'), now());

insert into eworks.samples (job_id, test_id, qr_code, specimen_no, test_age_days)
select '88888888-0000-0000-0000-000000000005', id, 'EW-ABCDEFGH2345', 1, 7
  from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH';

select pg_temp.check('A specimen with a serialized QR exists',
  (select count(*) from eworks.samples
    where job_id='88888888-0000-0000-0000-000000000005') = 1);

-- A QR sticker attached to two specimens is the classic swap.
select pg_temp.check_raises('A QR code cannot be reused',
  $$insert into eworks.samples (job_id, test_id, qr_code, specimen_no, test_age_days)
    select '88888888-0000-0000-0000-000000000005', id, 'EW-ABCDEFGH2345', 2, 28
      from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH'$$);

-- The alphabet excludes I, O, 0, 1 so a human transcribing a smudged label
-- cannot produce a different valid code.
select pg_temp.check_raises('A malformed QR code is rejected',
  $$insert into eworks.samples (job_id, test_id, qr_code, specimen_no)
    select '88888888-0000-0000-0000-000000000005', id, 'not-a-qr', 3
      from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH'$$);
rollback;


-- ===========================================================================
-- 4. Chain of custody: per-specimen hash chain.
-- ===========================================================================
begin;
select pg_temp.awarded_order('88888888-0000-0000-0000-000000000006');
set local role eworks_authenticated;
select set_config('app.user_id','44444444-0000-0000-0000-00000000000f', true);
select eworks.check_in('88888888-0000-0000-0000-000000000006',
  11.01760, 76.9558, 10, 'device-1', decode(repeat('c2',32),'hex'), now());

insert into eworks.samples (job_id, test_id, qr_code, specimen_no, test_age_days)
select '88888888-0000-0000-0000-000000000006', id, 'EW-QRCDEF234567', 1, 28
  from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH';

select eworks.record_custody('EW-QRCDEF234567','MOLDED', 11.0176, 76.9558, 'device-1');
select eworks.record_custody('EW-QRCDEF234567','SEALED', 11.0176, 76.9558, 'device-1');
select eworks.record_custody('EW-QRCDEF234567','PICKED_UP', 11.0176, 76.9558, 'device-1');

set local role postgres;
create temp table sid on commit drop as
  select id from eworks.samples where qr_code='EW-QRCDEF234567';

select pg_temp.check('The custody chain verifies',
  eworks.verify_custody_chain((select id from sid)) is null);

select pg_temp.check('The first event is anchored to the specimen genesis',
  (select prev_hash = eworks.custody_genesis_hash((select id from sid))
     from eworks.chain_of_custody
    where sample_id = (select id from sid) order by seq limit 1));

select pg_temp.check('Three events are chained',
  (select count(*) from eworks.chain_of_custody
    where sample_id=(select id from sid)) = 3);

-- A cube cannot be received at the lab twice; the second scan is a swap.
select pg_temp.check_raises('The same custody event cannot be recorded twice',
  $$select eworks.record_custody('EW-QRCDEF234567','SEALED')$$);

-- A different handset mid-chain is an unrecorded hand-off.
select pg_temp.check_raises('A device not bound to the job is rejected',
  $$select eworks.record_custody('EW-QRCDEF234567','IN_TRANSIT',
      11.0176, 76.9558, 'other-device')$$);

select pg_temp.check_raises('An unknown QR code is rejected',
  $$select eworks.record_custody('EW-ZZZZZZZZZZZZ','MOLDED')$$);

-- Append-only on the ordinary path.
select pg_temp.check_raises('UPDATE on chain_of_custody is rejected',
  $$update eworks.chain_of_custody set event='TESTED'
     where sample_id=(select id from sid) and seq=(select min(seq)
       from eworks.chain_of_custody where sample_id=(select id from sid))$$);

select pg_temp.check_raises('DELETE on chain_of_custody is rejected',
  $$delete from eworks.chain_of_custody where sample_id=(select id from sid)$$);

-- The DBA tamper. Triggers disabled exactly as an attacker would.
alter table eworks.chain_of_custody disable trigger custody_no_change_trg;
update eworks.chain_of_custody set event = 'TESTED'
 where sample_id = (select id from sid)
   and seq = (select min(seq) from eworks.chain_of_custody
               where sample_id = (select id from sid));
alter table eworks.chain_of_custody enable trigger custody_no_change_trg;

select pg_temp.check('A tampered custody event is detected',
  eworks.verify_custody_chain((select id from sid))
    = (select min(seq) from eworks.chain_of_custody where sample_id=(select id from sid)));
rollback;


-- Chains are per-specimen: breaking one must not invalidate another.
begin;
select pg_temp.awarded_order('88888888-0000-0000-0000-000000000007');
set local role eworks_authenticated;
select set_config('app.user_id','44444444-0000-0000-0000-00000000000f', true);
select eworks.check_in('88888888-0000-0000-0000-000000000007',
  11.01760, 76.9558, 10, 'device-1', decode(repeat('c3',32),'hex'), now());

insert into eworks.samples (job_id, test_id, qr_code, specimen_no, test_age_days)
select '88888888-0000-0000-0000-000000000007', id, 'EW-AAAAAAAA2222', 1, 7
  from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH';
insert into eworks.samples (job_id, test_id, qr_code, specimen_no, test_age_days)
select '88888888-0000-0000-0000-000000000007', id, 'EW-BBBBBBBB3333', 2, 28
  from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH';

select eworks.record_custody('EW-AAAAAAAA2222','MOLDED');
select eworks.record_custody('EW-BBBBBBBB3333','MOLDED');

set local role postgres;
create temp table two on commit drop as
  select (select id from eworks.samples where qr_code='EW-AAAAAAAA2222') as a,
         (select id from eworks.samples where qr_code='EW-BBBBBBBB3333') as b;

alter table eworks.chain_of_custody disable trigger custody_no_change_trg;
update eworks.chain_of_custody set event='TESTED'
 where sample_id = (select a from two);
alter table eworks.chain_of_custody enable trigger custody_no_change_trg;

select pg_temp.check('Specimen A''s chain is broken',
  eworks.verify_custody_chain((select a from two)) is not null);
select pg_temp.check('Specimen B''s chain is untouched',
  eworks.verify_custody_chain((select b from two)) is null);
rollback;


-- ===========================================================================
-- 5. RLS: one lab cannot see another lab's job, specimens, or custody trail.
-- ===========================================================================
begin;
select pg_temp.awarded_order('88888888-0000-0000-0000-000000000008');
set local role eworks_authenticated;
select set_config('app.user_id','44444444-0000-0000-0000-00000000000f', true);
select eworks.check_in('88888888-0000-0000-0000-000000000008',
  11.01760, 76.9558, 10, 'device-1', decode(repeat('c4',32),'hex'), now());
insert into eworks.samples (job_id, test_id, qr_code, specimen_no, test_age_days)
select '88888888-0000-0000-0000-000000000008', id, 'EW-CCCCCCCC4444', 1, 28
  from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH';
select eworks.record_custody('EW-CCCCCCCC4444','MOLDED');

select pg_temp.check('The technician sees their own job',
  (select count(*) from eworks.test_jobs
    where id='88888888-0000-0000-0000-000000000008') = 1);

select set_config('app.user_id','44444444-0000-0000-0000-00000000000a', true); -- Vendor A owner
select pg_temp.check('The winning vendor sees the job',
  (select count(*) from eworks.test_jobs
    where id='88888888-0000-0000-0000-000000000008') = 1);

select set_config('app.user_id','44444444-0000-0000-0000-00000000000c', true); -- Vendor C
select pg_temp.check('A rival lab sees NO job',
  (select count(*) from eworks.test_jobs
    where id='88888888-0000-0000-0000-000000000008') = 0);
select pg_temp.check('A rival lab sees NO specimens',
  (select count(*) from eworks.samples where qr_code='EW-CCCCCCCC4444') = 0);
select pg_temp.check('A rival lab sees NO custody events',
  (select count(*) from eworks.chain_of_custody) = 0);
select pg_temp.check('A rival lab sees NO check-in photo hashes',
  (select count(*) from eworks.site_checkins) = 0);

select set_config('app.user_id','22222222-0000-0000-0000-00000000000d', true); -- Section engineer
select pg_temp.check('The officer with order.read sees the job',
  (select count(*) from eworks.test_jobs
    where id='88888888-0000-0000-0000-000000000008') = 1);
select pg_temp.check('The officer sees the custody trail',
  (select count(*) from eworks.chain_of_custody) = 1);

select set_config('app.user_id','22222222-0000-0000-0000-00000000000c', true); -- Salem officer
select pg_temp.check('The Salem officer sees NO Coimbatore job',
  (select count(*) from eworks.test_jobs
    where id='88888888-0000-0000-0000-000000000008') = 0);
rollback;

\echo ''
\echo ' PHASE 5a CHECKS COMPLETE'
