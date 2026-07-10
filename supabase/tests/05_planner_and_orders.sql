-- Phase 3 verification: requirement planner + sealed order floating.

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
-- 1. The IS 456 sampling ladder, evaluated from jsonb.
--    1-5 m3 -> 1 sample; 6-15 -> 2; 16-30 -> 3; 31-50 -> 4;
--    >50    -> 4 + one per additional 50 m3 (or part thereof).
-- ===========================================================================
begin;
create temp table cuberule on commit drop as
  select tsr.frequency_type, tsr.frequency_spec
    from eworks.test_stage_rules tsr
    join eworks.test_catalog tc on tc.id = tsr.test_id
   where tc.code = 'CONCRETE_CUBE_STRENGTH';

create or replace function pg_temp.samples(q numeric) returns int
language sql as $$
  select eworks.compute_sample_count(frequency_type, frequency_spec, q) from cuberule;
$$;

select pg_temp.check('1 m3 -> 1 sample',    pg_temp.samples(1)  = 1);
select pg_temp.check('5 m3 -> 1 sample (tier boundary)',  pg_temp.samples(5)  = 1);
select pg_temp.check('6 m3 -> 2 samples (next tier)',     pg_temp.samples(6)  = 2);
select pg_temp.check('15 m3 -> 2 samples', pg_temp.samples(15) = 2);
select pg_temp.check('16 m3 -> 3 samples', pg_temp.samples(16) = 3);
select pg_temp.check('30 m3 -> 3 samples', pg_temp.samples(30) = 3);
select pg_temp.check('31 m3 -> 4 samples', pg_temp.samples(31) = 4);
select pg_temp.check('50 m3 -> 4 samples (top tier)',     pg_temp.samples(50) = 4);

-- "or part thereof" -- the reason ceil() matters. 51 m3 owes the extra sample.
select pg_temp.check('51 m3 -> 5 samples (part thereof, not 4.02)',
  pg_temp.samples(51) = 5);
select pg_temp.check('100 m3 -> 5 samples (exactly one extra 50)',
  pg_temp.samples(100) = 5);
select pg_temp.check('101 m3 -> 6 samples', pg_temp.samples(101) = 6);
select pg_temp.check('150 m3 -> 6 samples', pg_temp.samples(150) = 6);

select pg_temp.check('0 m3 -> 0 samples (nothing poured, nothing tested)',
  pg_temp.samples(0) = 0);
select pg_temp.check('NULL quantity -> 0 samples', pg_temp.samples(null) = 0);
rollback;


-- ONCE ignores quantity entirely. PER_HEAT / PER_CONSIGNMENT multiply.
begin;
select pg_temp.check('ONCE -> 1 regardless of quantity',
  eworks.compute_sample_count('ONCE', '{}'::jsonb, 9999) = 1);

select pg_temp.check('PER_HEAT: 3 heats, 1 sample each -> 3',
  eworks.compute_sample_count('PER_HEAT', '{"unit":"heat","samples":1}'::jsonb, 3) = 3);

select pg_temp.check('PER_CONSIGNMENT: 2 consignments, 2 samples each -> 4',
  eworks.compute_sample_count('PER_CONSIGNMENT', '{"unit":"consignment","samples":2}'::jsonb, 2) = 4);

-- A partial consignment is still a consignment.
select pg_temp.check('PER_CONSIGNMENT: 2.3 consignments -> 3 samples (ceil)',
  eworks.compute_sample_count('PER_CONSIGNMENT', '{"unit":"consignment","samples":1}'::jsonb, 2.3) = 3);

-- A tiered rule whose quantity runs past the top tier with no `above` clause
-- must refuse, not silently under-test.
select pg_temp.check_raises('PER_VOLUME past top tier with no `above` clause raises',
  $$select eworks.compute_sample_count('PER_VOLUME',
      '{"unit":"m3","tiers":[{"upto":5,"samples":1}]}'::jsonb, 500)$$);
rollback;


-- ===========================================================================
-- 2. Rule resolution: most specific org override wins.
-- ===========================================================================
begin;
create temp table ids on commit drop as
  select (select id from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH') as test_id,
         (select id from eworks.construction_stage where code='SUPERSTRUCTURE')   as stage_id;

select pg_temp.check('With no override, the state-wide rule governs',
  (select (eworks.resolve_stage_rule('11111111-0000-0000-0000-000000000008',
             test_id, stage_id)).org_unit_id is null from ids));

-- A stricter Coimbatore QAP: cubes every 25 m3 rather than the IS ladder.
insert into eworks.test_stage_rules
  (test_id, stage_id, org_unit_id, frequency_type, frequency_spec, acceptance_criteria)
select test_id, stage_id, '11111111-0000-0000-0000-000000000002', 'PER_VOLUME',
  '{"unit":"m3","tiers":[{"upto":25,"samples":2}],"above":{"base_samples":2,"per_additional_m3":25,"add_samples":1}}'::jsonb,
  '{"metric":"strength_n_per_mm2","min":30,"source":"Coimbatore QAP"}'::jsonb
from ids;

select pg_temp.check('Coimbatore override now governs a Coimbatore project',
  (select (eworks.resolve_stage_rule('11111111-0000-0000-0000-000000000008',
             test_id, stage_id)).org_unit_id = '11111111-0000-0000-0000-000000000002'
     from ids));

select pg_temp.check('...but a Salem project still gets the state-wide rule',
  (select (eworks.resolve_stage_rule('11111111-0000-0000-0000-000000000010',
             test_id, stage_id)).org_unit_id is null from ids));

select pg_temp.check('Override changes the sample count for the same volume',
  (select eworks.compute_sample_count(r.frequency_type, r.frequency_spec, 30)
     from ids, lateral eworks.resolve_stage_rule(
       '11111111-0000-0000-0000-000000000008', test_id, stage_id) r) = 3);
rollback;


-- ===========================================================================
-- 3. generate_project_requirements
-- ===========================================================================
begin;
-- SUPERSTRUCTURE has rules for cube (m3), cement (consignment), steel (heat),
-- and slump (pour). Omitting any unit must raise, not silently skip.
select pg_temp.check_raises('Missing a required unit raises rather than skipping tests',
  $$select eworks.generate_project_requirements(
      '11111111-0000-0000-0000-000000000008', 'SUPERSTRUCTURE',
      '{"m3": 120}'::jsonb)$$);
rollback;

begin;
select pg_temp.check('Planner generates one requirement per governing rule',
  eworks.generate_project_requirements(
    '11111111-0000-0000-0000-000000000008', 'SUPERSTRUCTURE',
    '{"m3": 120, "consignment": 3, "heat": 2, "pour": 1}'::jsonb,
    current_date + 30) = 4);

select pg_temp.check('120 m3 -> 6 cube samples (4 + ceil(70/50))',
  (select planned_count from eworks.project_test_requirements ptr
     join eworks.test_catalog tc on tc.id = ptr.test_id
    where tc.code = 'CONCRETE_CUBE_STRENGTH') = 6);

select pg_temp.check('3 consignments -> 3 cement samples',
  (select planned_count from eworks.project_test_requirements ptr
     join eworks.test_catalog tc on tc.id = ptr.test_id
    where tc.code = 'CEMENT_PHYSICAL') = 3);

select pg_temp.check('2 heats -> 2 steel samples',
  (select planned_count from eworks.project_test_requirements ptr
     join eworks.test_catalog tc on tc.id = ptr.test_id
    where tc.code = 'STEEL_TENSILE') = 2);

select pg_temp.check('Acceptance criteria are SNAPSHOT, not referenced',
  (select acceptance_criteria ->> 'source' from eworks.project_test_requirements ptr
     join eworks.test_catalog tc on tc.id = ptr.test_id
    where tc.code = 'CONCRETE_CUBE_STRENGTH') = 'IS 456 cl.16 / project QAP');

-- Re-running must not silently double the project's obligations.
select pg_temp.check_raises('Re-planning the same stage is rejected',
  $$select eworks.generate_project_requirements(
      '11111111-0000-0000-0000-000000000008', 'SUPERSTRUCTURE',
      '{"m3": 120, "consignment": 3, "heat": 2, "pour": 1}'::jsonb)$$);

select pg_temp.check_raises('Unknown stage code raises',
  $$select eworks.generate_project_requirements(
      '11111111-0000-0000-0000-000000000008', 'NO_SUCH_STAGE', '{}'::jsonb)$$);
rollback;


-- Zero volume: a stage with nothing poured generates no cube requirement.
begin;
select pg_temp.check('0 m3 generates no cube requirement',
  eworks.generate_project_requirements(
    '11111111-0000-0000-0000-000000000008', 'SUPERSTRUCTURE',
    '{"m3": 0, "consignment": 0, "heat": 0, "pour": 0}'::jsonb) = 0);
rollback;


-- ===========================================================================
-- 4. Order lifecycle and the status state machine.
-- ===========================================================================
begin;
insert into eworks.test_orders
  (id, project_id, org_unit_id, milestone, stage_id, site, required_by, created_by)
select '66666666-0000-0000-0000-000000000001',
       '11111111-0000-0000-0000-000000000008',
       '11111111-0000-0000-0000-000000000006',      -- CBESEC1, the engineer's section
       'Pour B2 raft', cs.id,
       st_makepoint(76.9558, 11.0168)::geography,
       current_date + 30, '22222222-0000-0000-0000-00000000000d'
  from eworks.construction_stage cs where cs.code = 'SUPERSTRUCTURE';

-- Identity FIRST. Called as an anonymous superuser session, float_order() bails
-- on the permission check before it ever reaches the no-items check -- so this
-- test would pass while proving nothing about empty orders.
set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000d', true); -- Section engineer

select pg_temp.check('Precondition: the engineer DOES hold order.float here',
  eworks.has_permission('order.float',
    'TN.COIMBATORE.CBEDIV1.CBEC1.CBESD1.CBESEC1') = true);

select pg_temp.check_raises('Cannot float an order with no items',
  $$select eworks.float_order('66666666-0000-0000-0000-000000000001')$$);

insert into eworks.order_items (order_id, test_id, quantity, test_ages_days)
select '66666666-0000-0000-0000-000000000001', id, 6, '{7,28}'
  from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH';

-- Floating requires order.float at the order's org path. The Salem officer
-- does not hold it there.
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000c', true); -- Salem DO
select pg_temp.check_raises('Salem officer cannot float a Coimbatore order',
  $$select eworks.float_order('66666666-0000-0000-0000-000000000001')$$);

select set_config('app.user_id', '22222222-0000-0000-0000-00000000000d', true);
select pg_temp.check('Section engineer CAN float the order',
  (eworks.float_order('66666666-0000-0000-0000-000000000001')).status = 'FLOATED');

select pg_temp.check('Floating stamps a bid close and a reveal close',
  (select bid_close_at is not null and reveal_close_at > bid_close_at
     from eworks.test_orders where id = '66666666-0000-0000-0000-000000000001'));

select pg_temp.check_raises('Cannot float an already-FLOATED order',
  $$select eworks.float_order('66666666-0000-0000-0000-000000000001')$$);

-- The engineer holds no audit.read, so RLS correctly hides the audit row from
-- them. Read it as the owner to confirm it was actually written.
select pg_temp.check('Section engineer cannot read the audit log (no audit.read)',
  (select count(*) from eworks.audit_logs
    where action = 'order.float') = 0);

set local role postgres;
select pg_temp.check('Floating wrote an immutable audit row',
  (select count(*) from eworks.audit_logs
    where action = 'order.float'
      and entity_id = '66666666-0000-0000-0000-000000000001') = 1);

select pg_temp.check('The audit row attributes the acting engineer',
  (select actor_id from eworks.audit_logs
    where action = 'order.float'
      and entity_id = '66666666-0000-0000-0000-000000000001')
   = '22222222-0000-0000-0000-00000000000d');

select pg_temp.check('The chain still verifies after the float',
  eworks.verify_audit_chain() is null);
rollback;


-- The state machine. RLS says which rows; the trigger says which transitions.
begin;
insert into eworks.test_orders
  (id, project_id, org_unit_id, milestone, stage_id, site, required_by, created_by)
select '66666666-0000-0000-0000-000000000002',
       '11111111-0000-0000-0000-000000000008','11111111-0000-0000-0000-000000000006',
       'M1', cs.id, st_makepoint(76.9558,11.0168)::geography,
       current_date + 30, '22222222-0000-0000-0000-00000000000d'
  from eworks.construction_stage cs where cs.code='SUPERSTRUCTURE';

select pg_temp.check_raises('DRAFT cannot jump straight to AWARDED',
  $$update eworks.test_orders set status='AWARDED'
     where id='66666666-0000-0000-0000-000000000002'$$);

select pg_temp.check_raises('DRAFT cannot jump to REVEALING',
  $$update eworks.test_orders set status='REVEALING'
     where id='66666666-0000-0000-0000-000000000002'$$);

select pg_temp.check_raises('A FLOATED order needs a schedule (constraint)',
  $$update eworks.test_orders set status='FLOATED'
     where id='66666666-0000-0000-0000-000000000002'$$);

update eworks.test_orders
   set status='CANCELLED' where id='66666666-0000-0000-0000-000000000002';
select pg_temp.check('DRAFT -> CANCELLED is legal',
  (select status from eworks.test_orders
    where id='66666666-0000-0000-0000-000000000002') = 'CANCELLED');

select pg_temp.check_raises('CANCELLED is terminal',
  $$update eworks.test_orders set status='DRAFT'
     where id='66666666-0000-0000-0000-000000000002'$$);
rollback;


-- ===========================================================================
-- 5. Eligibility and vendor visibility.  s9
-- ===========================================================================
begin;
insert into eworks.test_orders
  (id, project_id, org_unit_id, milestone, stage_id, site, status, floated_at,
   bid_close_at, reveal_close_at, required_by, created_by)
select '66666666-0000-0000-0000-000000000003',
       '11111111-0000-0000-0000-000000000008','11111111-0000-0000-0000-000000000006',
       'Pour C1', cs.id, st_makepoint(76.9558,11.0168)::geography,
       'FLOATED', now(), now()+interval '48h', now()+interval '72h',
       current_date + 30, '22222222-0000-0000-0000-00000000000d'
  from eworks.construction_stage cs where cs.code='SUPERSTRUCTURE';

insert into eworks.order_items (order_id, test_id, quantity)
select '66666666-0000-0000-0000-000000000003', id, 6
  from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH';

-- Vendor A: near, live NABL, priced. Vendor C: Salem but 200 km radius, priced.
-- Vendor D: expired NABL. Vendor E: not approved. Vendor B: out of range.
select pg_temp.check('Vendor A is eligible',
  exists (select 1 from eworks.eligible_vendors_for_order('66666666-0000-0000-0000-000000000003')
           where vendor_id='55555555-0000-0000-0000-00000000000a'));

select pg_temp.check('Vendor D (expired NABL) is NOT eligible',
  not exists (select 1 from eworks.eligible_vendors_for_order('66666666-0000-0000-0000-000000000003')
               where vendor_id='55555555-0000-0000-0000-00000000000d'));

select pg_temp.check('Vendor B (out of radius) is NOT eligible',
  not exists (select 1 from eworks.eligible_vendors_for_order('66666666-0000-0000-0000-000000000003')
               where vendor_id='55555555-0000-0000-0000-00000000000b'));

-- Add a second item nobody has priced. Every vendor must drop out, because a
-- lab that can do 1 of 2 items cannot fulfil the RFQ.
insert into eworks.order_items (order_id, test_id, quantity)
select '66666666-0000-0000-0000-000000000003', id, 1
  from eworks.test_catalog where code='BRICK_COMPRESSIVE';

select pg_temp.check('An unquotable second item makes EVERY vendor ineligible',
  (select count(*) from eworks.eligible_vendors_for_order('66666666-0000-0000-0000-000000000003')) = 0);
rollback;


-- Vendor visibility of the order board.
begin;
insert into eworks.test_orders
  (id, project_id, org_unit_id, milestone, stage_id, site, status, floated_at,
   bid_close_at, reveal_close_at, required_by, created_by)
select '66666666-0000-0000-0000-000000000004',
       '11111111-0000-0000-0000-000000000008','11111111-0000-0000-0000-000000000006',
       'Visible', cs.id, st_makepoint(76.9558,11.0168)::geography,
       'FLOATED', now(), now()+interval '48h', now()+interval '72h',
       current_date + 30, '22222222-0000-0000-0000-00000000000d'
  from eworks.construction_stage cs where cs.code='SUPERSTRUCTURE';
insert into eworks.order_items (order_id, test_id, quantity)
select '66666666-0000-0000-0000-000000000004', id, 6
  from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH';

-- A DRAFT order in the same section. No vendor may see it: knowing an RFQ is
-- coming before competitors do is itself an advantage.
insert into eworks.test_orders
  (id, project_id, org_unit_id, milestone, stage_id, site, required_by, created_by)
select '66666666-0000-0000-0000-000000000005',
       '11111111-0000-0000-0000-000000000008','11111111-0000-0000-0000-000000000006',
       'Secret', cs.id, st_makepoint(76.9558,11.0168)::geography,
       current_date + 30, '22222222-0000-0000-0000-00000000000d'
  from eworks.construction_stage cs where cs.code='SUPERSTRUCTURE';
insert into eworks.order_items (order_id, test_id, quantity)
select '66666666-0000-0000-0000-000000000005', id, 6
  from eworks.test_catalog where code='CONCRETE_CUBE_STRENGTH';

set local role eworks_authenticated;

select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true); -- Vendor A

-- Regression, same shape as the vendors_read bug. Vendor A's LAB_VENDOR role is
-- anchored at Coimbatore, so in_scope() on the order's section path is TRUE.
-- The officer-read policy must therefore gate on order.read, which LAB_VENDOR
-- does not hold. Gating on in_scope() alone leaked the whole DRAFT pipeline.
select pg_temp.check('Vendor A IS in scope of the order''s section (the trap)',
  eworks.in_scope('TN.COIMBATORE.CBEDIV1.CBEC1.CBESD1.CBESEC1') = true);
select pg_temp.check('...but Vendor A does NOT hold order.read',
  eworks.has_permission('order.read',
    'TN.COIMBATORE.CBEDIV1.CBEC1.CBESD1.CBESEC1') = false);

select pg_temp.check('Eligible vendor sees the FLOATED order',
  (select count(*) from eworks.test_orders
    where id='66666666-0000-0000-0000-000000000004') = 1);
select pg_temp.check('...and CANNOT see the DRAFT order',
  (select count(*) from eworks.test_orders
    where id='66666666-0000-0000-0000-000000000005') = 0);
select pg_temp.check('...and sees NOTHING via the officer-read path',
  (select count(*) from eworks.test_orders where status = 'DRAFT') = 0);
select pg_temp.check('...and cannot read the project test requirements',
  (select count(*) from eworks.project_test_requirements) = 0);
select pg_temp.check('...and sees the order items',
  (select count(*) from eworks.order_items
    where order_id='66666666-0000-0000-0000-000000000004') = 1);
select pg_temp.check('...and CANNOT see the DRAFT order items',
  (select count(*) from eworks.order_items
    where order_id='66666666-0000-0000-0000-000000000005') = 0);

select set_config('app.user_id', '44444444-0000-0000-0000-00000000000d', true); -- Vendor D, expired
select pg_temp.check('Ineligible vendor (expired NABL) sees NO floated order',
  (select count(*) from eworks.test_orders
    where id='66666666-0000-0000-0000-000000000004') = 0);
select pg_temp.check('...and no items either',
  (select count(*) from eworks.order_items
    where order_id='66666666-0000-0000-0000-000000000004') = 0);

select set_config('app.user_id', '44444444-0000-0000-0000-00000000000b', true); -- Vendor B, far
select pg_temp.check('Out-of-radius vendor sees NO floated order',
  (select count(*) from eworks.test_orders
    where id='66666666-0000-0000-0000-000000000004') = 0);

select set_config('app.user_id', '22222222-0000-0000-0000-00000000000d', true); -- Section engineer
select pg_temp.check('Officer sees BOTH the floated and the draft order',
  (select count(*) from eworks.test_orders
    where id in ('66666666-0000-0000-0000-000000000004',
                 '66666666-0000-0000-0000-000000000005')) = 2);

select set_config('app.user_id', '22222222-0000-0000-0000-00000000000c', true); -- Salem DO
select pg_temp.check('Salem officer sees NEITHER Coimbatore order',
  (select count(*) from eworks.test_orders
    where id in ('66666666-0000-0000-0000-000000000004',
                 '66666666-0000-0000-0000-000000000005')) = 0);
rollback;

\echo ''
\echo ' PHASE 3 CHECKS COMPLETE'
