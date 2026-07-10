-- Phase 2 verification: pricing windows, effective price, service catalog.

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
-- 1. Overlapping price windows are impossible.
-- ===========================================================================
begin;
create temp table slump on commit drop as
  select id from eworks.test_catalog where code = 'CONCRETE_SLUMP';

insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from, effective_to)
  select '55555555-0000-0000-0000-00000000000a', id, 100000, '2026-01-01', '2026-04-01' from slump;

select pg_temp.check_raises('Exactly overlapping window rejected',
  $$insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from, effective_to)
    select '55555555-0000-0000-0000-00000000000a', id, 200000, '2026-01-01', '2026-04-01' from slump$$);

select pg_temp.check_raises('Partially overlapping window rejected',
  $$insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from, effective_to)
    select '55555555-0000-0000-0000-00000000000a', id, 200000, '2026-03-01', '2026-06-01' from slump$$);

select pg_temp.check_raises('Enclosed window rejected',
  $$insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from, effective_to)
    select '55555555-0000-0000-0000-00000000000a', id, 200000, '2026-02-01', '2026-03-01' from slump$$);

select pg_temp.check_raises('Open-ended window overlapping an existing one rejected',
  $$insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from, effective_to)
    select '55555555-0000-0000-0000-00000000000a', id, 200000, '2026-03-31', null from slump$$);

-- '[)' half-open: a window starting exactly where the previous one ends is
-- adjacent, not overlapping. This is the normal price-change case and must work.
insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from, effective_to)
  select '55555555-0000-0000-0000-00000000000a', id, 200000, '2026-04-01', null from slump;

select pg_temp.check('Abutting window at the exact boundary IS allowed',
  (select count(*) from eworks.vendor_test_pricing
    where vendor_id = '55555555-0000-0000-0000-00000000000a'
      and test_id = (select id from slump)) = 2);

-- A different vendor may hold the same window for the same test.
insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from, effective_to)
  select '55555555-0000-0000-0000-00000000000d', id, 150000, '2026-01-01', '2026-04-01' from slump;
select pg_temp.check('A different vendor may price the same test in the same window',
  (select count(*) from eworks.vendor_test_pricing where test_id = (select id from slump)) = 3);
rollback;


-- ===========================================================================
-- 2. vendor_effective_price picks exactly one row, by date.
-- ===========================================================================
begin;
create temp table slump on commit drop as
  select id from eworks.test_catalog where code = 'CONCRETE_SLUMP';

insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from, effective_to)
  select '55555555-0000-0000-0000-00000000000a', id, 100000, '2026-01-01', '2026-04-01' from slump;
insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise, effective_from, effective_to)
  select '55555555-0000-0000-0000-00000000000a', id, 200000, '2026-04-01', null from slump;

select pg_temp.check('Price inside the first window',
  eworks.vendor_effective_price('55555555-0000-0000-0000-00000000000a',
    (select id from slump), '2026-02-15') = 100000);

select pg_temp.check('On the boundary date, the LATER window wins (half-open)',
  eworks.vendor_effective_price('55555555-0000-0000-0000-00000000000a',
    (select id from slump), '2026-04-01') = 200000);

select pg_temp.check('Day before the boundary, the earlier window still applies',
  eworks.vendor_effective_price('55555555-0000-0000-0000-00000000000a',
    (select id from slump), '2026-03-31') = 100000);

select pg_temp.check('Before any window, price is NULL (not zero)',
  eworks.vendor_effective_price('55555555-0000-0000-0000-00000000000a',
    (select id from slump), '2025-12-31') is null);

select pg_temp.check('Unpriced test returns NULL',
  eworks.vendor_effective_price('55555555-0000-0000-0000-00000000000a',
    (select id from eworks.test_catalog where code='BRICK_COMPRESSIVE')) is null);
rollback;


-- ===========================================================================
-- 3. vendor_can_quote = qualified AND priced.
-- ===========================================================================
begin;
create temp table cube on commit drop as
  select id from eworks.test_catalog where code = 'CONCRETE_CUBE_STRENGTH';
create temp table slump on commit drop as
  select id from eworks.test_catalog where code = 'CONCRETE_SLUMP';

-- Vendor A: qualified for cube (live NABL) and priced by the fixtures.
select pg_temp.check('Qualified + priced => can quote',
  eworks.vendor_can_quote('55555555-0000-0000-0000-00000000000a',
    (select id from cube)) = true);

-- Vendor D: capable of slump and it needs no NABL, but has no price row.
select pg_temp.check('Qualified but unpriced => cannot quote',
  eworks.vendor_can_quote('55555555-0000-0000-0000-00000000000d',
    (select id from slump)) = false);

-- Vendor D: priced for cube by the fixtures, but its NABL expired.
select pg_temp.check('Priced but unqualified (expired NABL) => cannot quote',
  eworks.vendor_can_quote('55555555-0000-0000-0000-00000000000d',
    (select id from cube)) = false);

insert into eworks.vendor_test_pricing (vendor_id, test_id, price_paise)
  select '55555555-0000-0000-0000-00000000000d', id, 50000 from slump;
select pg_temp.check('Adding a price flips D to quotable for the non-NABL test',
  eworks.vendor_can_quote('55555555-0000-0000-0000-00000000000d',
    (select id from slump)) = true);
rollback;


-- ===========================================================================
-- 4. The service-catalog view must not become a hole through RLS.
--    security_invoker = true is the only thing standing between a vendor and
--    every competitor's price list.
-- ===========================================================================
begin;
select pg_temp.check('View is declared security_invoker',
  (select 'security_invoker=true' = any(reloptions)
     from pg_class where relname = 'vendor_service_catalog'));
rollback;

begin;
set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000a', true); -- Vendor A

select pg_temp.check('Vendor A sees only its own rows in the service catalog',
  (select count(*) from eworks.vendor_service_catalog
    where vendor_id <> '55555555-0000-0000-0000-00000000000a') = 0);

select pg_temp.check('Vendor A sees its own cube capability',
  (select count(*) from eworks.vendor_service_catalog
    where test_code = 'CONCRETE_CUBE_STRENGTH') = 1);

select pg_temp.check('Vendor A cube row is qualified and priced today',
  (select is_qualified_today and is_priced_today
     from eworks.vendor_service_catalog where test_code = 'CONCRETE_CUBE_STRENGTH'));
rollback;

-- Vendor D: expired NABL. The catalog must show the capability but mark it
-- unqualified, so the dashboard can say "your accreditation lapsed" instead of
-- silently hiding the row and leaving the lab wondering where its work went.
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '44444444-0000-0000-0000-00000000000d', true); -- Vendor D

select pg_temp.check('Vendor D still SEES the cube row',
  (select count(*) from eworks.vendor_service_catalog
    where test_code = 'CONCRETE_CUBE_STRENGTH') = 1);

select pg_temp.check('...but it is flagged not-qualified (expired NABL)',
  (select is_qualified_today = false
     from eworks.vendor_service_catalog where test_code = 'CONCRETE_CUBE_STRENGTH'));

select pg_temp.check('...and its accredited_to is in the past',
  (select accredited_to < current_date
     from eworks.vendor_service_catalog where test_code = 'CONCRETE_CUBE_STRENGTH'));
rollback;

-- An officer with vendor.read sees vendors, but pricing is owner-only, so the
-- price column must come back NULL rather than leaking the bid field.
begin;
set local role eworks_authenticated;
select set_config('app.user_id', '22222222-0000-0000-0000-00000000000b', true); -- Coimbatore DO

select pg_temp.check('Officer sees vendor capabilities',
  (select count(*) from eworks.vendor_service_catalog) > 0);

select pg_temp.check('Officer sees NO prices through the view',
  (select count(*) from eworks.vendor_service_catalog
    where price_paise is not null) = 0);
rollback;

\echo ''
\echo ' PHASE 2 CHECKS COMPLETE'
