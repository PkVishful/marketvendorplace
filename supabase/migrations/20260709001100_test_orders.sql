-- Phase 3b: sealed RFQ orders (master prompt s6, s7 step 2, s9, s11).
--
-- Bids themselves arrive in Phase 4 (commit-reveal). This migration builds the
-- order the bids will attach to, and the visibility rule that decides which
-- vendors ever learn the order exists.

create type eworks.order_status as enum (
  'DRAFT',        -- being assembled by the site engineer
  'FLOATED',      -- open for bidding; vendors may commit
  'REVEALING',    -- bidding closed; vendors reveal price + nonce
  'AWARDED',
  'CANCELLED',
  'FAILED'        -- closed with no technically-qualified bid
);

-- s6: `test_orders (sealed RFQ, eval_method, status)`. Only L1 exists today.
-- The enum is here so that adding QCBS later is a migration, not a redesign.
create type eworks.eval_method as enum ('L1');

create table eworks.test_orders (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references eworks.org_units(id) on delete restrict,

  -- Denormalised from the project so that RLS and the live-order-board index
  -- never have to join org_units. s11 wants a partial index on
  -- (org_unit_id, milestone, required_by) for the board.
  org_unit_id    uuid not null references eworks.org_units(id) on delete restrict,

  milestone      text not null check (length(trim(milestone)) > 0),
  stage_id       uuid not null references eworks.construction_stage(id) on delete restrict,

  -- Where the samples are collected. Drives vendor matching (s7 step 2).
  site           geography(Point, 4326) not null,

  eval_method    eworks.eval_method not null default 'L1',
  status         eworks.order_status not null default 'DRAFT',

  floated_at     timestamptz,
  -- s7: pg_cron opens bids at the scheduled close.
  bid_close_at   timestamptz,
  -- Commit-reveal: vendors who committed a hash must reveal before this, or
  -- forfeit. See docs/security-gaps.md #1.
  reveal_close_at timestamptz,
  required_by    date not null,

  created_by     uuid not null references eworks.user_profiles(id),
  created_at     timestamptz not null default now(),

  -- A FLOATED order without a close time would never close. pg_cron would have
  -- nothing to fire on and the order would hang open forever.
  --
  -- Only the statuses that imply bidding actually happened require a schedule.
  -- A DRAFT order cancelled before it was ever floated has no schedule and
  -- never will -- demanding one here made DRAFT -> CANCELLED impossible.
  constraint orders_floated_has_schedule check (
    status not in ('FLOATED', 'REVEALING', 'AWARDED')
    or (floated_at is not null and bid_close_at is not null
        and reveal_close_at is not null)
  ),
  constraint orders_reveal_after_close check (
    bid_close_at is null or reveal_close_at is null or reveal_close_at > bid_close_at
  ),
  constraint orders_close_after_float check (
    floated_at is null or bid_close_at is null or bid_close_at > floated_at
  )
);

-- s11: live order board. Partial index -- the board only ever asks for FLOATED.
create index orders_board_idx
  on eworks.test_orders (org_unit_id, milestone, required_by)
  where status = 'FLOATED';
create index orders_site_gist on eworks.test_orders using gist (site);
create index orders_project_idx on eworks.test_orders (project_id);
-- pg_cron sweeps for orders whose window has elapsed.
create index orders_close_due_idx on eworks.test_orders (bid_close_at)
  where status = 'FLOATED';

create or replace function eworks.orders_project_level_check()
returns trigger language plpgsql as $$
declare lvl eworks.org_level;
begin
  select level into lvl from eworks.org_units where id = new.project_id;
  if lvl is distinct from 'PROJECT' then
    raise exception 'test_orders.project_id must reference a PROJECT org_unit, got %', lvl;
  end if;
  return new;
end;
$$;

create trigger orders_project_level_trg
  before insert or update of project_id on eworks.test_orders
  for each row execute function eworks.orders_project_level_check();


-- RLS decides WHICH ROWS a user may write. It says nothing about WHICH
-- TRANSITIONS are legal. Without this trigger, any officer holding
-- `order.float` could UPDATE an order straight from DRAFT to AWARDED and skip
-- bidding altogether -- the single most valuable attack in a procurement system.
create or replace function eworks.orders_status_transition_check()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'DRAFT'     and new.status in ('FLOATED', 'CANCELLED'))
    or (old.status = 'FLOATED'   and new.status in ('REVEALING', 'CANCELLED', 'FAILED'))
    or (old.status = 'REVEALING' and new.status in ('AWARDED', 'FAILED'))
  ) then
    raise exception 'illegal order status transition % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Terminal states are terminal. An AWARDED order that can be re-floated is a
  -- way to re-run an auction whose result someone disliked.
  if old.status in ('AWARDED', 'CANCELLED', 'FAILED') then
    raise exception 'order is in terminal state % and cannot change', old.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger orders_status_transition_trg
  before update of status on eworks.test_orders
  for each row execute function eworks.orders_status_transition_check();


create table eworks.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references eworks.test_orders(id) on delete cascade,
  test_id       uuid not null references eworks.test_catalog(id) on delete restrict,
  requirement_id uuid references eworks.project_test_requirements(id) on delete set null,

  -- e.g. 6 cubes; 1 slump.
  quantity      int not null check (quantity > 0),
  -- 7-day and 28-day breaks are separate specimens from the same sample.
  test_ages_days int[] not null default '{}',

  constraint order_items_unique unique (order_id, test_id)
);

create index order_items_order_idx on eworks.order_items (order_id);
create index order_items_test_idx  on eworks.order_items (test_id);


-- ---------------------------------------------------------------------------
-- Floating an order
-- ---------------------------------------------------------------------------

-- Moves DRAFT -> FLOATED atomically, stamping the bidding schedule.
--
-- SECURITY DEFINER, but it re-checks `order.float` against the order's own org
-- path rather than trusting the caller. A definer function that skips that
-- check is a privilege-escalation primitive.
create or replace function eworks.float_order(
  p_order_id       uuid,
  p_bid_window     interval default interval '48 hours',
  p_reveal_window  interval default interval '24 hours'
)
returns eworks.test_orders
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_order eworks.test_orders;
  v_path  ltree;
  v_items int;
begin
  -- Row lock: two engineers clicking "float" concurrently must not both
  -- succeed and stamp two different close times.
  select * into v_order from eworks.test_orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_order.status <> 'DRAFT' then
    raise exception 'order % is % and cannot be floated', p_order_id, v_order.status;
  end if;

  select path into v_path from eworks.org_units where id = v_order.org_unit_id;
  if not eworks.has_permission('order.float', v_path) then
    raise exception 'permission denied: order.float at %', v_path
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_items from eworks.order_items where order_id = p_order_id;
  if v_items = 0 then
    raise exception 'refusing to float order % with no items', p_order_id;
  end if;

  update eworks.test_orders
     set status          = 'FLOATED',
         floated_at      = now(),
         bid_close_at    = now() + p_bid_window,
         reveal_close_at = now() + p_bid_window + p_reveal_window
   where id = p_order_id
  returning * into v_order;

  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'order.float', 'test_order', p_order_id, v_path,
          jsonb_build_object('bid_close_at', v_order.bid_close_at,
                             'reveal_close_at', v_order.reveal_close_at));

  return v_order;
end;
$$;


-- Vendors eligible to be notified about, and to bid on, this order.
--
-- Every item in the order must be quotable by the vendor: accredited (with live
-- NABL where the catalog demands it) and priced. A vendor who can do 5 of 6
-- items cannot fulfil the RFQ and must not be broadcast to.
create or replace function eworks.eligible_vendors_for_order(p_order_id uuid)
returns table (vendor_id uuid, distance_m double precision)
language sql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  with o as (select * from eworks.test_orders where id = p_order_id),
       items as (select test_id from eworks.order_items where order_id = p_order_id)
  select v.id, st_distance(v.location, o.site)
    from eworks.vendors v, o
   where v.status = 'APPROVED'
     and st_dwithin(v.location, o.site,
           (select (value #>> '{}')::numeric from eworks.settings
             where key = 'vendor_max_service_radius_km') * 1000)
     and st_dwithin(v.location, o.site, v.service_radius_km * 1000)
     -- NOT EXISTS an item the vendor cannot quote.
     and not exists (
       select 1 from items i
        where not eworks.vendor_can_quote(v.id, i.test_id, o.required_by)
     )
   order by 2;
$$;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table eworks.test_orders enable row level security;
alter table eworks.order_items enable row level security;

grant select, insert, update on eworks.test_orders to eworks_authenticated;
grant select, insert, update, delete on eworks.order_items to eworks_authenticated;

-- s9: "vendor sees only eligible floated orders and own bids/jobs."
--
-- Two disjoint audiences:
--   * officers  -- anything in their org subtree, at any status
--   * vendors   -- FLOATED (or REVEALING) orders they are eligible for, and
--                  nothing else. A DRAFT order is invisible: knowing an RFQ is
--                  coming, before competitors do, is itself an advantage.
--
-- Eligibility is recomputed per row rather than stored, so revoking a vendor's
-- accreditation immediately removes the order from their board. A cached
-- eligibility table would leave a window where a lapsed lab still sees work.
-- `order.read`, NOT in_scope(). This is the same trap that bit vendors_read: a
-- lab vendor holds a LAB_VENDOR role anchored at its district, so in_scope() on
-- the order's path is TRUE for them. Gating on scope alone showed every lab the
-- district's entire order pipeline, DRAFT orders included -- i.e. which RFQs are
-- coming, before any competitor could know.
create policy orders_officer_read on eworks.test_orders
  for select to eworks_authenticated
  using (
    exists (select 1 from eworks.org_units ou
             where ou.id = test_orders.org_unit_id
               and eworks.has_permission('order.read', ou.path))
  );

create policy orders_vendor_read on eworks.test_orders
  for select to eworks_authenticated
  using (
    status in ('FLOATED', 'REVEALING')
    and exists (
      select 1 from eworks.vendors v
       where v.owner_user_id = eworks.current_user_id()
         and v.id in (select vendor_id from eworks.eligible_vendors_for_order(test_orders.id))
    )
  );

create policy orders_write on eworks.test_orders
  for all to eworks_authenticated
  using (exists (select 1 from eworks.org_units ou
                  where ou.id = test_orders.org_unit_id
                    and eworks.has_permission('order.float', ou.path)))
  with check (exists (select 1 from eworks.org_units ou
                       where ou.id = test_orders.org_unit_id
                         and eworks.has_permission('order.float', ou.path)));

-- Items inherit the order's visibility. `exists (select 1 from test_orders ...)`
-- re-evaluates the policies above, so a vendor who cannot see the order cannot
-- see what it asks for either.
create policy order_items_read on eworks.order_items
  for select to eworks_authenticated
  using (exists (select 1 from eworks.test_orders o where o.id = order_items.order_id));

create policy order_items_write on eworks.order_items
  for all to eworks_authenticated
  using (exists (select 1 from eworks.test_orders o
                  join eworks.org_units ou on ou.id = o.org_unit_id
                 where o.id = order_items.order_id
                   and o.status = 'DRAFT'
                   and eworks.has_permission('order.float', ou.path)))
  with check (exists (select 1 from eworks.test_orders o
                       join eworks.org_units ou on ou.id = o.org_unit_id
                      where o.id = order_items.order_id
                        and o.status = 'DRAFT'
                        and eworks.has_permission('order.float', ou.path)));

comment on policy orders_vendor_read on eworks.test_orders is
  'A vendor sees a floated order only while eligible for EVERY item in it. '
  'Recomputed per row so a lapsed accreditation hides the order immediately.';
