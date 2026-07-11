-- Verification of the master prompt's non-negotiables (s14).
--
-- Every check RAISEs on failure, and the runner uses ON_ERROR_STOP=1, so this
-- file exits non-zero the moment any guarantee stops holding. A test that
-- prints "ok" without having been able to fail is not a test.

\set ON_ERROR_STOP on
\set QUIET on

create or replace function pg_temp.check(label text, condition boolean)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'pass: %', label;
end;
$$;

-- Asserts that `stmt` raises. Used for the negative security tests, where the
-- interesting outcome is a refusal.
create or replace function pg_temp.check_raises(label text, stmt text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception
    when others then
      raise notice 'pass: % (rejected: %)', label, left(sqlerrm, 60);
      return;
  end;
  raise exception 'FAIL: % -- statement was accepted but should have been rejected', label;
end;
$$;


-- ===========================================================================
-- 1. Cross-district isolation.  s3: "RLS makes cross-district access impossible."
-- ===========================================================================
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000b', true); -- Coimbatore DO

select pg_temp.check(
  'Coimbatore officer sees own district subtree',
  (select count(*) from eworks.org_units where path <@ 'TN.COIMBATORE') = 8);

select pg_temp.check(
  'Coimbatore officer sees ZERO Salem rows',
  (select count(*) from eworks.org_units where path <@ 'TN.SALEM') = 0);

select pg_temp.check(
  'Coimbatore officer sees ancestors for breadcrumbs (TN only)',
  (select count(*) from eworks.org_units where level = 'STATE') = 1);

select pg_temp.check(
  'Coimbatore officer cannot approve vendors in Salem',
  eworks.has_permission('vendor.approve', 'TN.SALEM') = false);

select pg_temp.check(
  'Coimbatore officer CAN approve vendors in own district',
  eworks.has_permission('vendor.approve', 'TN.COIMBATORE.CBEDIV1') = true);

select pg_temp.check(
  'Coimbatore officer cannot enumerate Salem staff',
  (select count(*) from eworks.user_profiles
    where id = '22222222-0000-0000-0000-00000000000c') = 0);
rollback;


-- ===========================================================================
-- 2. Downward delegation, no sideways reach.  s4
-- ===========================================================================
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000d', true); -- CBESEC1 engineer

select pg_temp.check(
  'Section engineer reaches down into own subtree (project)',
  eworks.in_scope('TN.COIMBATORE.CBEDIV1.CBEC1.CBESD1.CBESEC1.CBEFU1.CBEPRJ1') = true);

select pg_temp.check(
  'Section engineer cannot reach sibling section',
  eworks.in_scope('TN.COIMBATORE.CBEDIV1.CBEC1.CBESD1.CBESEC2') = false);

select pg_temp.check(
  'Section engineer cannot reach upward to the division',
  eworks.in_scope('TN.COIMBATORE.CBEDIV1') = false);

select pg_temp.check(
  'order.float held at section resolves down to project',
  eworks.has_permission('order.float',
    'TN.COIMBATORE.CBEDIV1.CBEC1.CBESD1.CBESEC1.CBEFU1.CBEPRJ1') = true);

select pg_temp.check(
  'order.float does NOT resolve to a sibling section',
  eworks.has_permission('order.float',
    'TN.COIMBATORE.CBEDIV1.CBEC1.CBESD1.CBESEC2') = false);
rollback;


-- ===========================================================================
-- 3. Head admin at STATE dominates everything.  s3
-- ===========================================================================
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000a', true);

-- 1 state + 8 Coimbatore (incl. the sibling section) + 7 Salem.
select pg_temp.check(
  'Head admin at STATE sees every org unit',
  (select count(*) from eworks.org_units) = 16);

select pg_temp.check(
  'Head admin holds catalog.manage',
  eworks.has_permission_anywhere('catalog.manage') = true);
rollback;


-- ===========================================================================
-- 4. Unauthenticated connection is blind.  s0: "a leaked key must not read
--    outside its scope" -- with no identity, scope is empty.
-- ===========================================================================
begin;
set local role eworks_authenticated;
-- app.user_id deliberately unset.
select pg_temp.check('Anonymous identity resolves to NULL',
  eworks.current_user_id() is null);
select pg_temp.check('Anonymous sees zero org units',
  (select count(*) from eworks.org_units) = 0);
select pg_temp.check('Anonymous sees zero users',
  (select count(*) from eworks.user_profiles) = 0);
select pg_temp.check('Anonymous sees zero catalog rows',
  (select count(*) from eworks.test_catalog) = 0);
rollback;


-- ===========================================================================
-- 5. Privilege escalation.  A district officer must not be able to grant
--    themselves a State-level role.
-- ===========================================================================
begin;
-- Guard: eworks_authenticated must actually HOLD the INSERT privilege, or the
-- rejection below would come from a missing GRANT rather than from RLS, and
-- the policy would go untested while appearing to pass.
select pg_temp.check(
  'eworks_authenticated holds INSERT on user_roles (so RLS is what denies)',
  has_table_privilege('eworks_authenticated', 'eworks.user_roles', 'INSERT'));

set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000b', true); -- Coimbatore DO

select pg_temp.check(
  'District officer does not hold user.manage anywhere',
  eworks.has_permission_anywhere('user.manage') = false);

select pg_temp.check_raises(
  'District officer cannot grant themselves HEAD_ADMIN at state',
  $$insert into eworks.user_roles (user_id, role_code, org_unit_id)
    values ('22222222-0000-0000-0000-00000000000b','HEAD_ADMIN',
            '11111111-0000-0000-0000-000000000001')$$);

select pg_temp.check_raises(
  'District officer cannot grant a role in Salem',
  $$insert into eworks.user_roles (user_id, role_code, org_unit_id)
    values ('22222222-0000-0000-0000-00000000000b','SITE_ENGINEER',
            '11111111-0000-0000-0000-00000000000d')$$);
rollback;

-- The positive half. If the head admin could not grant, the policy would be
-- trivially "correct" by denying everyone, and the negative tests above would
-- prove nothing.
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000a', true); -- Head admin

insert into eworks.user_roles (user_id, role_code, org_unit_id)
  values ('22222222-0000-0000-0000-00000000000d','SITE_ENGINEER',
          '11111111-0000-0000-0000-00000000000d');

select pg_temp.check('Head admin CAN grant a role anywhere in the state',
  (select count(*) from eworks.user_roles
    where user_id = '22222222-0000-0000-0000-00000000000d'
      and org_unit_id = '11111111-0000-0000-0000-00000000000d') = 1);
rollback;


-- ===========================================================================
-- 6. Audit chain: tamper detection.  s0, s14
-- ===========================================================================
begin;

insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload) values
  ('22222222-0000-0000-0000-00000000000b','vendor.approve','vendor',
   '33333333-0000-0000-0000-000000000001','TN.COIMBATORE','{"decision":"approved"}'),
  ('22222222-0000-0000-0000-00000000000b','order.float','test_order',
   '33333333-0000-0000-0000-000000000002','TN.COIMBATORE','{"amount":50000}'),
  ('22222222-0000-0000-0000-00000000000b','order.award','test_order',
   '33333333-0000-0000-0000-000000000002','TN.COIMBATORE','{"winner":"lab-7"}');

select pg_temp.check('Fresh chain verifies', eworks.verify_audit_chain() is null);

create temp table t6 on commit drop as
  select seq, row_number() over (order by seq) as n from eworks.audit_logs;

select pg_temp.check('First row is anchored to the genesis hash',
  (select prev_hash = eworks.audit_genesis_hash()
     from eworks.audit_logs where seq = (select seq from t6 where n = 1)));

select pg_temp.check('Chain is actually linked (row 2 points at row 1)',
  (select a2.prev_hash = a1.row_hash
     from eworks.audit_logs a1, eworks.audit_logs a2
    where a1.seq = (select seq from t6 where n = 1)
      and a2.seq = (select seq from t6 where n = 2)));

-- The threat: a DBA rewrites history to hide a bribe. Triggers are disabled
-- exactly as a superuser attacker would disable them.
alter table eworks.audit_logs disable trigger audit_logs_no_update_trg;
update eworks.audit_logs set payload = '{"amount":5000}'
 where seq = (select seq from t6 where n = 2);
alter table eworks.audit_logs enable trigger audit_logs_no_update_trg;

select pg_temp.check('Tampered payload is detected at the tampered row',
  eworks.verify_audit_chain() = (select seq from t6 where n = 2));
rollback;


-- Mid-chain deletion must also be caught.
--
-- Sequence values are NOT 1,2,3 here: `seq` is an identity column and identity
-- counters do not roll back with the surrounding transaction, so by this point
-- the chain starts wherever the earlier rolled-back blocks left it. Hardcoding
-- 1/2/3 made this test assert against numbers that never existed.
begin;
insert into eworks.audit_logs (actor_id, action, entity_type, org_path, payload) values
  (null,'a','t','TN','{}'), (null,'b','t','TN','{}'), (null,'c','t','TN','{}');

create temp table chain_seqs on commit drop as
  select seq, row_number() over (order by seq) as n from eworks.audit_logs;

alter table eworks.audit_logs disable trigger audit_logs_no_update_trg;
delete from eworks.audit_logs where seq = (select seq from chain_seqs where n = 2);
alter table eworks.audit_logs enable trigger audit_logs_no_update_trg;

-- The break surfaces at the row AFTER the hole: row 3 still points at the hash
-- of the now-missing row 2.
select pg_temp.check('Mid-chain deletion is detected at the following row',
  eworks.verify_audit_chain() = (select seq from chain_seqs where n = 3));
rollback;


-- Deleting a PREFIX of the log leaves a chain that is internally consistent.
-- Only the genesis anchor catches it.
begin;
insert into eworks.audit_logs (actor_id, action, entity_type, org_path, payload) values
  (null,'p1','t','TN','{}'), (null,'p2','t','TN','{}'), (null,'p3','t','TN','{}');

create temp table prefix_seqs on commit drop as
  select seq, row_number() over (order by seq) as n from eworks.audit_logs;

alter table eworks.audit_logs disable trigger audit_logs_no_update_trg;
delete from eworks.audit_logs where seq = (select seq from prefix_seqs where n = 1);
alter table eworks.audit_logs enable trigger audit_logs_no_update_trg;

select pg_temp.check('Prefix deletion is detected by the genesis anchor',
  eworks.verify_audit_chain() = (select seq from prefix_seqs where n = 2));
rollback;


-- Honest negative result: tail truncation is NOT detectable from inside the
-- database. Deleting the most recent rows leaves a chain that verifies clean.
-- This is why eworks.audit_head() must be published to an external witness.
-- The test asserts the limitation so that nobody later mistakes it for safety.
begin;
insert into eworks.audit_logs (actor_id, action, entity_type, org_path, payload) values
  (null,'t1','t','TN','{}'), (null,'t2','t','TN','{}'), (null,'t3','t','TN','{}');

create temp table tail_seqs on commit drop as
  select seq, row_number() over (order by seq) as n from eworks.audit_logs;

alter table eworks.audit_logs disable trigger audit_logs_no_update_trg;
delete from eworks.audit_logs where seq = (select seq from tail_seqs where n = 3);
alter table eworks.audit_logs enable trigger audit_logs_no_update_trg;

select pg_temp.check(
  'KNOWN LIMITATION: tail truncation verifies clean without an external witness',
  eworks.verify_audit_chain() is null);
rollback;


-- Append-only enforcement on the ordinary path.
--
-- These statements must MATCH a row. An UPDATE matching zero rows fires no
-- row-level trigger and "succeeds" -- which is how an earlier version of this
-- test passed while proving nothing.
begin;
insert into eworks.audit_logs (actor_id, action, entity_type, org_path, payload)
  values (null,'x','t','TN','{}');

select pg_temp.check('Precondition: exactly one row to mutate',
  (select count(*) from eworks.audit_logs) = 1);

select pg_temp.check_raises('UPDATE on audit_logs is rejected',
  $$update eworks.audit_logs set action = 'y'
     where seq = (select max(seq) from eworks.audit_logs)$$);

select pg_temp.check_raises('DELETE on audit_logs is rejected',
  $$delete from eworks.audit_logs
     where seq = (select max(seq) from eworks.audit_logs)$$);

select pg_temp.check('Row survived both attempts',
  (select count(*) from eworks.audit_logs) = 1);
rollback;

-- The application role must not even hold the privilege.
begin;
select pg_temp.check('eworks_authenticated has no UPDATE on audit_logs',
  has_table_privilege('eworks_authenticated','eworks.audit_logs','UPDATE') = false);
select pg_temp.check('eworks_authenticated has no DELETE on audit_logs',
  has_table_privilege('eworks_authenticated','eworks.audit_logs','DELETE') = false);
rollback;


-- Timezone independence: the same row must hash identically regardless of the
-- session TimeZone, or a verifier in another zone would report false tampering.
begin;
insert into eworks.audit_logs (actor_id, action, entity_type, org_path, payload)
  values (null,'tz','t','TN','{}');
set local timezone = 'Asia/Kolkata';
select pg_temp.check('Chain verifies under Asia/Kolkata', eworks.verify_audit_chain() is null);
set local timezone = 'UTC';
select pg_temp.check('Chain verifies under UTC', eworks.verify_audit_chain() is null);
rollback;


-- ===========================================================================
-- 7. Audit log RLS: auditor scope.  s3
-- ===========================================================================
begin;
insert into eworks.audit_logs (actor_id, action, entity_type, org_path, payload) values
  (null,'cbe.event','t','TN.COIMBATORE','{}'),
  (null,'slm.event','t','TN.SALEM','{}'),
  (null,'system.event','t',null,'{}');

set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000e', true); -- Coimbatore auditor
select pg_temp.check('Auditor with audit.read_all sees system events',
  (select count(*) from eworks.audit_logs where org_path is null) = 1);

select set_config('app.user_id', '22222222-0000-0000-0000-00000000000b', true); -- Coimbatore DO
select pg_temp.check('District officer sees own district audit rows',
  (select count(*) from eworks.audit_logs where action = 'cbe.event') = 1);
select pg_temp.check('District officer sees NO Salem audit rows',
  (select count(*) from eworks.audit_logs where action = 'slm.event') = 0);
select pg_temp.check('District officer sees NO system audit rows',
  (select count(*) from eworks.audit_logs where org_path is null) = 0);
rollback;


-- ===========================================================================
-- 8. Hierarchy invariants.  s4: "strict FK + level validation", "no orphans"
-- ===========================================================================
begin;
select pg_temp.check_raises('Skip-level insert (DIVISION under STATE) rejected',
  $$insert into eworks.org_units (parent_id, level, code, name)
    values ('11111111-0000-0000-0000-000000000001','DIVISION','BAD','Bad')$$);

select pg_temp.check_raises('Non-STATE root (orphan) rejected',
  $$insert into eworks.org_units (parent_id, level, code, name)
    values (null,'DISTRICT','ORPHAN','Orphan')$$);

select pg_temp.check_raises('Second STATE with a parent rejected',
  $$insert into eworks.org_units (parent_id, level, code, name)
    values ('11111111-0000-0000-0000-000000000001','STATE','BAD2','Bad')$$);

select pg_temp.check_raises('Code with an ltree-illegal character rejected',
  $$insert into eworks.org_units (parent_id, level, code, name)
    values ('11111111-0000-0000-0000-000000000001','DISTRICT','BAD.CODE','Bad')$$);

select pg_temp.check_raises('Duplicate sibling code rejected',
  $$insert into eworks.org_units (parent_id, level, code, name)
    values ('11111111-0000-0000-0000-000000000001','DISTRICT','SALEM','Dup')$$);
rollback;


-- Path cascade: renaming a mid-tree unit must move every descendant with it,
-- or RLS starts matching against a tree that no longer exists.
begin;
update eworks.org_units set code = 'CBEDIV9'
 where id = '11111111-0000-0000-0000-000000000003';

select pg_temp.check('Renamed unit has new path',
  (select path from eworks.org_units where id='11111111-0000-0000-0000-000000000003')
    = 'TN.COIMBATORE.CBEDIV9');

select pg_temp.check('Descendant project path cascaded',
  (select path from eworks.org_units where id='11111111-0000-0000-0000-000000000008')
    = 'TN.COIMBATORE.CBEDIV9.CBEC1.CBESD1.CBESEC1.CBEFU1.CBEPRJ1');

select pg_temp.check('No stale paths remain under the old label',
  (select count(*) from eworks.org_units where path <@ 'TN.COIMBATORE.CBEDIV1') = 0);

select pg_temp.check('Salem subtree untouched by the Coimbatore rename',
  (select count(*) from eworks.org_units where path <@ 'TN.SALEM') = 7);
rollback;


-- ===========================================================================
-- 9. Configurable rules.  s0: "no hardcoded frequencies"
-- ===========================================================================
begin;
-- Cube is now ruled at several stages (foundation/substructure/superstructure);
-- scope to one so the scalar subquery stays single-row.
select pg_temp.check('IS 456 volume ladder is stored as data, not code',
  (select frequency_spec -> 'tiers' -> 0 ->> 'samples'
     from eworks.test_stage_rules tsr
     join eworks.test_catalog tc on tc.id = tsr.test_id
     join eworks.construction_stage cs on cs.id = tsr.stage_id
    where tc.code = 'CONCRETE_CUBE_STRENGTH' and cs.code = 'SUPERSTRUCTURE') = '1');

select pg_temp.check('Cube rule is PER_VOLUME with 3 specimens per sample',
  (select frequency_type = 'PER_VOLUME'
      and (frequency_spec ->> 'specimens_per_sample') = '3'
     from eworks.test_stage_rules tsr
     join eworks.test_catalog tc on tc.id = tsr.test_id
     join eworks.construction_stage cs on cs.id = tsr.stage_id
    where tc.code = 'CONCRETE_CUBE_STRENGTH' and cs.code = 'SUPERSTRUCTURE'));

-- Assert each test carries its expected frequency type (each present at least
-- once), robust to the same test being ruled across multiple stages.
select pg_temp.check('Steel is PER_HEAT, cement is PER_CONSIGNMENT, SBC is ONCE',
  (select count(distinct tc.code) from eworks.test_stage_rules tsr
     join eworks.test_catalog tc on tc.id = tsr.test_id
    where (tc.code,tsr.frequency_type) in
      (('STEEL_TENSILE','PER_HEAT'),
       ('CEMENT_PHYSICAL','PER_CONSIGNMENT'),
       ('SOIL_BEARING_CAPACITY','ONCE'))) = 3);

select pg_temp.check_raises('PER_VOLUME rule without tiers is rejected',
  $$insert into eworks.test_stage_rules (test_id, stage_id, frequency_type, frequency_spec)
    select tc.id, cs.id, 'PER_VOLUME', '{"unit":"m3"}'::jsonb
      from eworks.test_catalog tc, eworks.construction_stage cs
     where tc.code='CONCRETE_NDT_UPV' and cs.code='FOUNDATION'$$);

select pg_temp.check_raises('PER_HEAT rule without samples is rejected',
  $$insert into eworks.test_stage_rules (test_id, stage_id, frequency_type, frequency_spec)
    select tc.id, cs.id, 'PER_HEAT', '{}'::jsonb
      from eworks.test_catalog tc, eworks.construction_stage cs
     where tc.code='CONCRETE_NDT_UPV' and cs.code='FOUNDATION'$$);

select pg_temp.check_raises('Requirement attached to a DISTRICT (not PROJECT) is rejected',
  $$insert into eworks.project_test_requirements
      (project_id, test_id, stage_id, frequency_type, acceptance_criteria, planned_count)
    select '11111111-0000-0000-0000-000000000002', tc.id, cs.id, 'ONCE', '{}'::jsonb, 1
      from eworks.test_catalog tc, eworks.construction_stage cs
     where tc.code='SOIL_BEARING_CAPACITY' and cs.code='SITE_INVESTIGATION'$$);
rollback;

\echo ''
\echo '================================================='
\echo ' ALL CHECKS PASSED'
\echo '================================================='
