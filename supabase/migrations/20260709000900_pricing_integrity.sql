-- Phase 2: vendor capabilities and pricing (master prompt s13).
--
-- The tables landed in Phase 1. What was missing is the integrity that makes
-- them safe to bid against.
--
-- The bug this migration exists to prevent: two overlapping price rows for the
-- same (vendor, test). "The vendor's price on date D" then has two answers, and
-- which one a query returns depends on plan order. In an L1 auction that is not
-- a data-quality problem, it is a procurement dispute.

create extension if not exists btree_gist;   -- lets an exclusion constraint mix
                                             -- uuid equality with range overlap

-- Effective window as a real daterange, so PostgreSQL can enforce
-- non-overlap rather than the application promising to.
--
-- '[)' is deliberate: a row effective_to = 2026-03-31 and the next starting
-- 2026-03-31 must NOT overlap. Half-open intervals make the boundary
-- unambiguous, and mean a price change takes effect at midnight rather than
-- leaving a one-day hole or a one-day overlap.
alter table eworks.vendor_test_pricing
  add column effective_range daterange
  generated always as (
    daterange(effective_from, effective_to, '[)')
  ) stored;

alter table eworks.vendor_test_pricing
  add constraint vtp_no_overlapping_windows
  exclude using gist (
    vendor_id with =,
    test_id   with =,
    effective_range with &&
  );

create index vtp_effective_idx
  on eworks.vendor_test_pricing using gist (effective_range);


-- The price a vendor charges for a test on a given date, or NULL if they have
-- not priced it. Exactly one row can match, because of the constraint above.
create or replace function eworks.vendor_effective_price(
  p_vendor_id uuid,
  p_test_id   uuid,
  p_on_date   date default current_date
)
returns bigint
language sql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select price_paise
    from eworks.vendor_test_pricing
   where vendor_id = p_vendor_id
     and test_id   = p_test_id
     and effective_range @> p_on_date;
$$;


-- What a vendor can actually sell: accredited for the test AND has a live
-- price. The dashboard reads this; so, later, does the RFQ broadcast, because
-- notifying a lab about work it cannot price is noise that trains people to
-- ignore notifications.
--
-- A plain view, so RLS on the underlying tables still applies. A vendor sees
-- only its own rows; nobody sees a competitor's price through it. (A
-- SECURITY DEFINER function here would have bypassed exactly that.)
create view eworks.vendor_service_catalog as
  select
    v.id            as vendor_id,
    v.legal_name,
    tc.id           as test_id,
    tc.code         as test_code,
    tc.name         as test_name,
    tc.requires_nabl,
    c.is_nabl_accredited,
    c.accredited_to,
    p.price_paise,
    p.effective_from,
    p.effective_to,
    eworks.vendor_qualified_for(v.id, tc.id) as is_qualified_today,
    (p.price_paise is not null)              as is_priced_today
  from eworks.vendors v
  join eworks.vendor_test_capabilities c
    on c.vendor_id = v.id and c.is_active
  join eworks.test_catalog tc
    on tc.id = c.test_id and tc.is_active
  left join eworks.vendor_test_pricing p
    on p.vendor_id = v.id
   and p.test_id   = tc.id
   and p.effective_range @> current_date;

-- security_invoker: the view runs with the caller's privileges, so the RLS
-- policies on vendors / capabilities / pricing are enforced against the caller
-- and not against the view's owner. Without this the view would be a hole
-- straight through every policy Phase 1 established.
alter view eworks.vendor_service_catalog set (security_invoker = true);

grant select on eworks.vendor_service_catalog to eworks_authenticated;


-- A vendor cannot bid on a test it is not qualified for and has not priced.
-- Enforced here as a reusable predicate rather than re-derived at bid time,
-- so the RFQ broadcast and the bid gate cannot drift apart.
create or replace function eworks.vendor_can_quote(
  p_vendor_id uuid,
  p_test_id   uuid,
  p_on_date   date default current_date
)
returns boolean
language sql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select eworks.vendor_qualified_for(p_vendor_id, p_test_id, p_on_date)
     and eworks.vendor_effective_price(p_vendor_id, p_test_id, p_on_date) is not null;
$$;

comment on constraint vtp_no_overlapping_windows on eworks.vendor_test_pricing is
  'Guarantees at most one live price per (vendor, test, date). Without it, L1 '
  'selection could pick either of two rows depending on plan order.';
