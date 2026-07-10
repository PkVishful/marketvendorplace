-- Phase 1 verification: vendor isolation, KYC review, NABL eligibility, and
-- geo-radius matching (master prompt s6, s7, s11, s14).

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
  begin
    execute stmt;
  exception when others then
    raise notice 'pass: % (rejected: %)', label, left(sqlerrm, 55);
    return;
  end;
  raise exception 'FAIL: % -- accepted but should have been rejected', label;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures. Coimbatore ~ (76.9558, 11.0168); Salem ~ (78.1460, 11.6643).
-- The two are roughly 135 km apart, which is what makes the radius tests real.
-- ---------------------------------------------------------------------------
begin;

insert into eworks.user_profiles (id, phone, full_name) values
  ('44444444-0000-0000-0000-00000000000a', '9100000001', 'Vendor A Owner (Coimbatore)'),
  ('44444444-0000-0000-0000-00000000000b', '9100000002', 'Vendor B Owner (Salem, small radius)'),
  ('44444444-0000-0000-0000-00000000000c', '9100000003', 'Vendor C Owner (Salem, wide radius)'),
  ('44444444-0000-0000-0000-00000000000d', '9100000004', 'Vendor D Owner (expired NABL)'),
  ('44444444-0000-0000-0000-00000000000e', '9100000005', 'Vendor E Owner (not approved)');

insert into eworks.user_roles (user_id, role_code, org_unit_id) values
  ('44444444-0000-0000-0000-00000000000a','LAB_VENDOR','11111111-0000-0000-0000-000000000002'),
  ('44444444-0000-0000-0000-00000000000b','LAB_VENDOR','11111111-0000-0000-0000-000000000009'),
  ('44444444-0000-0000-0000-00000000000c','LAB_VENDOR','11111111-0000-0000-0000-000000000009'),
  ('44444444-0000-0000-0000-00000000000d','LAB_VENDOR','11111111-0000-0000-0000-000000000002'),
  ('44444444-0000-0000-0000-00000000000e','LAB_VENDOR','11111111-0000-0000-0000-000000000002');

insert into eworks.vendors
  (id, owner_user_id, org_unit_id, legal_name, gstin, pan, address,
   location, service_radius_km, status, approved_by, approved_at,
   nabl_no, nabl_valid_until)
values
  -- A: 3 km from the site, 50 km radius, live NABL. Must match.
  ('55555555-0000-0000-0000-00000000000a','44444444-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000002','Kovai Testing Labs Pvt Ltd',
   '33ABCDE1234F1Z5','ABCDE1234F','Coimbatore',
   st_makepoint(76.9800, 11.0200)::geography, 50, 'APPROVED',
   '22222222-0000-0000-0000-00000000000b', now(), 'TC-1001', current_date + 365),

  -- B: in Salem, 50 km radius. Site is ~135 km away. Must NOT match.
  ('55555555-0000-0000-0000-00000000000b','44444444-0000-0000-0000-00000000000b',
   '11111111-0000-0000-0000-000000000009','Salem Small Labs',
   '33BCDEF2345G1Z6','BCDEF2345G','Salem',
   st_makepoint(78.1460, 11.6643)::geography, 50, 'APPROVED',
   '22222222-0000-0000-0000-00000000000c', now(), 'TC-1002', current_date + 365),

  -- C: in Salem, 200 km radius. Reaches the site. Must match.
  ('55555555-0000-0000-0000-00000000000c','44444444-0000-0000-0000-00000000000c',
   '11111111-0000-0000-0000-000000000009','Salem Statewide Labs',
   '33CDEFG3456H1Z7','CDEFG3456H','Salem',
   st_makepoint(78.1460, 11.6643)::geography, 200, 'APPROVED',
   '22222222-0000-0000-0000-00000000000c', now(), 'TC-1003', current_date + 365),

  -- D: next door, but its NABL lapsed yesterday. Must NOT match a NABL test.
  ('55555555-0000-0000-0000-00000000000d','44444444-0000-0000-0000-00000000000d',
   '11111111-0000-0000-0000-000000000002','Lapsed Accreditation Labs',
   '33DEFGH4567I1Z8','DEFGH4567I','Coimbatore',
   st_makepoint(76.9700, 11.0180)::geography, 50, 'APPROVED',
   '22222222-0000-0000-0000-00000000000b', now(), 'TC-1004', current_date - 1),

  -- E: next door, fully accredited, but never approved. Must NOT match.
  ('55555555-0000-0000-0000-00000000000e','44444444-0000-0000-0000-00000000000e',
   '11111111-0000-0000-0000-000000000002','Unapproved Labs',
   '33EFGHI5678J1Z9','EFGHI5678J','Coimbatore',
   st_makepoint(76.9650, 11.0170)::geography, 50, 'SUBMITTED',
   null, null, 'TC-1005', current_date + 365);

-- Capabilities for CONCRETE_CUBE_STRENGTH (requires_nabl = true)
insert into eworks.vendor_test_capabilities
  (vendor_id, test_id, is_nabl_accredited, nabl_scope_ref, accredited_from, accredited_to)
select v.id, tc.id, true, 'SCOPE-'||v.legal_name,
       current_date - 365,
       case when v.id = '55555555-0000-0000-0000-00000000000d'
            then current_date - 1     -- expired
            else current_date + 365 end
  from eworks.vendors v, eworks.test_catalog tc
 where tc.code = 'CONCRETE_CUBE_STRENGTH';

-- Capability for CONCRETE_SLUMP (requires_nabl = false), vendor D only, with
-- no accreditation at all -- proving a non-NABL test does not demand one.
insert into eworks.vendor_test_capabilities (vendor_id, test_id, is_nabl_accredited)
select '55555555-0000-0000-0000-00000000000d', tc.id, false
  from eworks.test_catalog tc where tc.code = 'CONCRETE_SLUMP';

insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise)
select v.id, tc.id, 250000   -- Rs 2,500.00
  from eworks.vendors v, eworks.test_catalog tc
 where tc.code = 'CONCRETE_CUBE_STRENGTH';

commit;


-- ===========================================================================
-- 1. Geo-radius + capability + accreditation matching.  s7 step 2, s11
-- ===========================================================================
begin;

create temp table site on commit drop as
  select st_makepoint(76.9558, 11.0168)::geography as g;

create temp table cube on commit drop as
  select id from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH';

select pg_temp.check('Vendor A (near, live NABL) matches',
  exists (select 1 from eworks.match_vendors_for_test(
    (select id from cube), (select g from site))
   where vendor_id = '55555555-0000-0000-0000-00000000000a'));

select pg_temp.check('Vendor B (Salem, 50km radius) does NOT reach the site',
  not exists (select 1 from eworks.match_vendors_for_test(
    (select id from cube), (select g from site))
   where vendor_id = '55555555-0000-0000-0000-00000000000b'));

select pg_temp.check('Vendor C (Salem, 200km radius) DOES reach the site',
  exists (select 1 from eworks.match_vendors_for_test(
    (select id from cube), (select g from site))
   where vendor_id = '55555555-0000-0000-0000-00000000000c'));

select pg_temp.check('Vendor D (expired NABL) is excluded from a NABL test',
  not exists (select 1 from eworks.match_vendors_for_test(
    (select id from cube), (select g from site))
   where vendor_id = '55555555-0000-0000-0000-00000000000d'));

select pg_temp.check('Vendor E (not APPROVED) is excluded',
  not exists (select 1 from eworks.match_vendors_for_test(
    (select id from cube), (select g from site))
   where vendor_id = '55555555-0000-0000-0000-00000000000e'));

select pg_temp.check('Exactly two vendors match',
  (select count(*) from eworks.match_vendors_for_test(
    (select id from cube), (select g from site))) = 2);

select pg_temp.check('Results are ordered nearest-first',
  (select vendor_id from eworks.match_vendors_for_test(
    (select id from cube), (select g from site)) limit 1)
   = '55555555-0000-0000-0000-00000000000a');

-- Salem is ~135 km from the site: sanity-check the geography, not just the code.
select pg_temp.check('Salem-to-site distance is between 120 and 150 km',
  (select distance_m from eworks.match_vendors_for_test(
    (select id from cube), (select g from site))
    where vendor_id = '55555555-0000-0000-0000-00000000000c')
   between 120000 and 150000);
rollback;


-- ===========================================================================
-- 2. The eligibility lock.  s7 step 3: "auto-rejects expired NABL/PWD"
-- ===========================================================================
begin;
create temp table cube on commit drop as
  select id from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH';
create temp table slump on commit drop as
  select id from eworks.test_catalog where code = 'CONCRETE_SLUMP';

select pg_temp.check('Live NABL vendor qualifies for a NABL test',
  eworks.vendor_qualified_for('55555555-0000-0000-0000-00000000000a',
    (select id from cube)) = true);

select pg_temp.check('Expired NABL vendor is disqualified for a NABL test',
  eworks.vendor_qualified_for('55555555-0000-0000-0000-00000000000d',
    (select id from cube)) = false);

select pg_temp.check('Expired NABL vendor STILL qualifies for a non-NABL test',
  eworks.vendor_qualified_for('55555555-0000-0000-0000-00000000000d',
    (select id from slump)) = true);

select pg_temp.check('Qualification is date-sensitive: valid a year ago, not in two years',
  eworks.vendor_qualified_for('55555555-0000-0000-0000-00000000000a',
    (select id from cube), current_date + 400) = false);

select pg_temp.check('Unapproved vendor never qualifies',
  eworks.vendor_qualified_for('55555555-0000-0000-0000-00000000000e',
    (select id from cube)) = false);
rollback;


-- ===========================================================================
-- 3. Vendor isolation.  s9: a vendor must not see the bidding field.
-- ===========================================================================
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true); -- Vendor A

select pg_temp.check('Vendor A sees its own row',
  (select count(*) from eworks.vendors
    where id = '55555555-0000-0000-0000-00000000000a') = 1);

-- Regression: vendor_A holds a LAB_VENDOR role anchored at Coimbatore, so
-- eworks.in_scope('TN.COIMBATORE') is TRUE for them. An earlier version of
-- vendors_read used in_scope() for the officer branch, which let every lab in
-- a district enumerate its competitors. Scope is not permission.
select pg_temp.check('Vendor A IS in scope of its own district (the trap)',
  eworks.in_scope('TN.COIMBATORE') = true);

select pg_temp.check('...but Vendor A does NOT hold vendor.read',
  eworks.has_permission('vendor.read', 'TN.COIMBATORE') = false);

select pg_temp.check('Vendor A sees NO other vendor rows',
  (select count(*) from eworks.vendors) = 1);

select pg_temp.check('Vendor A cannot see the other 2 Coimbatore vendors',
  (select count(*) from eworks.vendors
    where org_unit_id = '11111111-0000-0000-0000-000000000002') = 1);

select pg_temp.check('Vendor A sees NO competitor pricing',
  (select count(*) from eworks.vendor_test_pricing
    where vendor_id <> '55555555-0000-0000-0000-00000000000a') = 0);

select pg_temp.check('Vendor A sees its own pricing',
  (select count(*) from eworks.vendor_test_pricing) = 1);
rollback;


-- Officers are scoped too: Coimbatore cannot review Salem's vendors.
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000b', true); -- Coimbatore DO

select pg_temp.check('Coimbatore officer sees the 3 Coimbatore vendors',
  (select count(*) from eworks.vendors) = 3);

select pg_temp.check('Coimbatore officer sees ZERO Salem vendors',
  (select count(*) from eworks.vendors
    where org_unit_id = '11111111-0000-0000-0000-000000000009') = 0);

-- s9: pricing is commercially sensitive and must not leak to officers either,
-- or the sealed bid is sealed in name only.
select pg_temp.check('Officer cannot browse vendor pricing',
  (select count(*) from eworks.vendor_test_pricing) = 0);
rollback;


-- ===========================================================================
-- 4. Approval is the officer's privilege, never the vendor's.
-- ===========================================================================
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000e', true); -- Vendor E (SUBMITTED)

-- This does NOT raise. Vendor E is SUBMITTED, so the vendors_self_update USING
-- clause excludes the row entirely and the UPDATE matches zero rows. RLS refuses
-- by making the row invisible, not by erroring.
--
-- That distinction matters operationally: the BFF must check the affected row
-- count and surface a 403. An UPDATE that quietly changes nothing looks like
-- success to a careless caller.
--
-- approved_by/approved_at are supplied so the CHECK constraint is satisfied and
-- the only thing that can stop this write is RLS.
update eworks.vendors
   set status = 'APPROVED',
       approved_by = '22222222-0000-0000-0000-00000000000b',
       approved_at = now()
 where id = '55555555-0000-0000-0000-00000000000e';

select pg_temp.check('Vendor cannot approve itself (row unchanged)',
  (select status from eworks.vendors
    where id = '55555555-0000-0000-0000-00000000000e') = 'SUBMITTED');

rollback;


-- Now the DRAFT case. A DRAFT vendor's row IS visible to the USING clause, so
-- WITH CHECK is what fires, and these genuinely raise rather than no-op.
--
-- The precondition is set as the table owner: the vendor cannot move itself
-- back to DRAFT either, so doing it under RLS would silently no-op and leave
-- the assertions below testing nothing at all.
begin;
update eworks.vendors set status = 'DRAFT', approved_by = null, approved_at = null
 where id = '55555555-0000-0000-0000-00000000000e';

set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000e', true);

select pg_temp.check('Precondition: vendor E is DRAFT and visible to USING',
  (select status from eworks.vendors
    where id = '55555555-0000-0000-0000-00000000000e') = 'DRAFT');

select pg_temp.check_raises('DRAFT vendor cannot write itself to APPROVED',
  $$update eworks.vendors
       set status = 'APPROVED',
           approved_by = '22222222-0000-0000-0000-00000000000b',
           approved_at = now()
     where id = '55555555-0000-0000-0000-00000000000e'$$);

select pg_temp.check_raises('DRAFT vendor cannot write itself to SUSPENDED',
  $$update eworks.vendors set status = 'SUSPENDED'
     where id = '55555555-0000-0000-0000-00000000000e'$$);

-- The legitimate transition a vendor may make: submit for review.
update eworks.vendors set status = 'SUBMITTED'
 where id = '55555555-0000-0000-0000-00000000000e';
select pg_temp.check('DRAFT vendor CAN submit itself for review',
  (select status from eworks.vendors
    where id = '55555555-0000-0000-0000-00000000000e') = 'SUBMITTED');
rollback;


-- An APPROVED vendor editing its own row is silently a no-op, because the
-- USING clause excludes the row. Silent no-ops are dangerous, so assert it:
-- the API layer must check the affected row count and surface an error.
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true); -- Vendor A (APPROVED)

update eworks.vendors set legal_name = 'Renamed By Vendor'
 where id = '55555555-0000-0000-0000-00000000000a';

select pg_temp.check('APPROVED vendor cannot mutate its own row (0 rows affected)',
  (select legal_name from eworks.vendors
    where id = '55555555-0000-0000-0000-00000000000a') = 'Kovai Testing Labs Pvt Ltd');
rollback;


begin;
set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000b', true); -- Coimbatore DO

update eworks.vendors
   set status = 'APPROVED',
       approved_by = '22222222-0000-0000-0000-00000000000b',
       approved_at = now()
 where id = '55555555-0000-0000-0000-00000000000e';

select pg_temp.check('Coimbatore officer CAN approve a Coimbatore vendor',
  (select status from eworks.vendors
    where id = '55555555-0000-0000-0000-00000000000e') = 'APPROVED');
rollback;


-- Cross-district approval must fail. Coimbatore officer, Salem vendor.
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000b', true);

update eworks.vendors set status = 'SUSPENDED'
 where id = '55555555-0000-0000-0000-00000000000b';   -- Salem vendor

set local role postgres;
select pg_temp.check('Coimbatore officer cannot suspend a Salem vendor',
  (select status from eworks.vendors
    where id = '55555555-0000-0000-0000-00000000000b') = 'APPROVED');
rollback;


-- ===========================================================================
-- 5. Data integrity.
-- ===========================================================================
begin;
select pg_temp.check_raises('Malformed GSTIN rejected',
  $$insert into eworks.vendors (owner_user_id, org_unit_id, legal_name, gstin, pan,
      address, location, service_radius_km)
    values ('44444444-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000002',
      'Bad GST','NOTAGSTIN','ABCDE1234F','x', st_makepoint(76.9,11.0)::geography, 10)$$);

select pg_temp.check_raises('Malformed PAN rejected',
  $$insert into eworks.vendors (owner_user_id, org_unit_id, legal_name, gstin, pan,
      address, location, service_radius_km)
    values ('44444444-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000002',
      'Bad PAN','33ZZZZZ9999Z1Z1','12345','x', st_makepoint(76.9,11.0)::geography, 10)$$);

select pg_temp.check_raises('APPROVED without an approver rejected',
  $$insert into eworks.vendors (owner_user_id, org_unit_id, legal_name, gstin, pan,
      address, location, service_radius_km, status)
    values ('44444444-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000002',
      'Unattributed','33ZZZZZ9999Z1Z1','ABCDE1234F','x',
      st_makepoint(76.9,11.0)::geography, 10, 'APPROVED')$$);

select pg_temp.check_raises('NABL number without an expiry rejected',
  $$insert into eworks.vendors (owner_user_id, org_unit_id, legal_name, gstin, pan,
      address, location, service_radius_km, nabl_no)
    values ('44444444-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000002',
      'No Expiry','33ZZZZZ9999Z1Z1','ABCDE1234F','x',
      st_makepoint(76.9,11.0)::geography, 10, 'TC-9999')$$);

select pg_temp.check_raises('Vendor anchored to a SECTION (not DISTRICT) rejected',
  $$insert into eworks.vendors (owner_user_id, org_unit_id, legal_name, gstin, pan,
      address, location, service_radius_km)
    values ('44444444-0000-0000-0000-00000000000a','11111111-0000-0000-0000-000000000006',
      'Wrong Level','33ZZZZZ9999Z1Z1','ABCDE1234F','x',
      st_makepoint(76.9,11.0)::geography, 10)$$);

select pg_temp.check_raises('Zero or negative price rejected',
  $$insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise)
    select '55555555-0000-0000-0000-00000000000a', id, 0
      from eworks.test_catalog where code = 'CONCRETE_SLUMP'$$);

select pg_temp.check_raises('Accredited capability without a validity window rejected',
  $$insert into eworks.vendor_test_capabilities (vendor_id, test_id, is_nabl_accredited)
    select '55555555-0000-0000-0000-00000000000a', id, true
      from eworks.test_catalog where code = 'CONCRETE_NDT_UPV'$$);

select pg_temp.check_raises('Rejected document without a reason rejected',
  $$insert into eworks.vendor_documents (vendor_id, doc_type, storage_path, mime_type,
      sha256, status, reviewed_by, reviewed_at)
    values ('55555555-0000-0000-0000-00000000000a','PAN_COMPANY','p','image/png',
      decode(repeat('00',32),'hex'),'REJECTED',
      '22222222-0000-0000-0000-00000000000b', now())$$);
rollback;

\echo ''
\echo ' PHASE 1 CHECKS COMPLETE'
