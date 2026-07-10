-- Phase 4: sealed bidding, eligibility lock, atomic L1 award
-- (master prompt s7 step 3, s9, s10, s11, s13, s14).
--
-- WHY COMMIT-REVEAL AND NOT ENCRYPT-AT-REST
--
-- s9 asks for bids "encrypted at rest, un-openable (even by admin) until close",
-- opened by pg_cron at the scheduled time. That is not achievable. If the
-- database can decrypt at close, the key is reachable by the database *before*
-- close. Anyone holding superuser or Vault access can open every bid early. The
-- audit log records that they did; it does not stop them. In a bid-rigging
-- challenge, "we logged it" is not "it could not happen."
--
-- So a bid is submitted as sha256(order_id : vendor_id : price : nonce). The
-- database stores the hash. There is no plaintext and no key, so early opening
-- is not merely forbidden, it is impossible -- and the claim in s9 becomes
-- literally true rather than aspirational.
--
-- The cost, which must be handled in the tender conditions and not just in code:
-- a vendor who never reveals holds a free option to walk away after seeing the
-- field. They are marked FORFEITED here; the EMD penalty is a policy decision.

create type eworks.bid_status as enum (
  'COMMITTED',   -- hash submitted, price unknown to everyone including the DB
  'REVEALED',    -- price disclosed and verified against the hash
  'FORFEITED',   -- never revealed before reveal_close_at
  'DISQUALIFIED' -- revealed, but no longer technically qualified at award time
);

create table eworks.order_bids (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references eworks.test_orders(id) on delete cascade,
  vendor_id     uuid not null references eworks.vendors(id) on delete restrict,

  -- sha256(order_id : vendor_id : price_paise : nonce)
  --
  -- order_id and vendor_id are bound INTO the hash. Without them a commitment
  -- could be lifted from one order to another, or replayed by a different
  -- vendor -- the hash alone would still verify.
  commitment    bytea not null check (length(commitment) = 32),
  committed_at  timestamptz not null default now(),

  revealed_price_paise bigint check (revealed_price_paise > 0),
  nonce         text,
  revealed_at   timestamptz,

  status        eworks.bid_status not null default 'COMMITTED',

  -- s11: one active bid per vendor per order.
  constraint order_bids_one_per_vendor unique (order_id, vendor_id),

  constraint order_bids_reveal_is_complete check (
    (status <> 'REVEALED')
    or (revealed_price_paise is not null and nonce is not null and revealed_at is not null)
  ),
  -- A COMMITTED bid must carry no price. Storing one "temporarily" would defeat
  -- the entire scheme.
  constraint order_bids_committed_has_no_price check (
    status <> 'COMMITTED' or revealed_price_paise is null
  )
);

-- s11: L1 selection at close, filtered to qualified.
create index order_bids_l1_idx on eworks.order_bids (order_id, revealed_price_paise)
  where status = 'REVEALED';
create index order_bids_vendor_idx on eworks.order_bids (vendor_id, committed_at desc);


create table eworks.order_award (
  -- One award per order. This unique constraint, not application logic, is what
  -- guarantees "exactly one winner" (s10) under concurrent finalisation.
  order_id      uuid primary key references eworks.test_orders(id) on delete cascade,
  bid_id        uuid not null references eworks.order_bids(id) on delete restrict,
  vendor_id     uuid not null references eworks.vendors(id) on delete restrict,
  price_paise   bigint not null check (price_paise > 0),
  eval_method   eworks.eval_method not null,

  -- How many technically-qualified bids it beat. An award of 1-of-1 is a
  -- single-bid tender and an auditor will want to see that on its face.
  qualified_bid_count int not null check (qualified_bid_count > 0),

  awarded_at    timestamptz not null default now(),
  awarded_by    uuid references eworks.user_profiles(id)   -- null = system (pg_cron)
);


-- The canonical commitment. Vendors compute this client-side and send only the
-- digest. Changing this function invalidates every open bid, so it is versioned
-- by migration and must never be edited in place.
create or replace function eworks.bid_commitment(
  p_order_id  uuid,
  p_vendor_id uuid,
  p_price_paise bigint,
  p_nonce     text
)
returns bytea
language sql
immutable
parallel safe
set search_path = eworks, public, extensions, pg_temp
as $$
  select digest(
    convert_to(
      p_order_id::text || ':' || p_vendor_id::text || ':' ||
      p_price_paise::text || ':' || p_nonce,
      'UTF8'),
    'sha256');
$$;


-- A bid is immutable once committed. The commitment, the order, and the vendor
-- can never change; only the reveal fields may be filled in, exactly once.
create or replace function eworks.order_bids_immutable_commitment()
returns trigger language plpgsql as $$
begin
  if new.commitment is distinct from old.commitment
     or new.order_id  is distinct from old.order_id
     or new.vendor_id is distinct from old.vendor_id
     or new.committed_at is distinct from old.committed_at then
    raise exception 'a committed bid is immutable' using errcode = 'restrict_violation';
  end if;

  -- Revealing twice, with a different price, would let a vendor change its bid
  -- after seeing a competitor reveal.
  if old.status = 'REVEALED' and new.revealed_price_paise is distinct from old.revealed_price_paise then
    raise exception 'a revealed bid cannot be re-revealed' using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger order_bids_immutable_trg
  before update on eworks.order_bids
  for each row execute function eworks.order_bids_immutable_commitment();


-- ---------------------------------------------------------------------------
-- Submitting a commitment
-- ---------------------------------------------------------------------------
create or replace function eworks.submit_bid_commitment(
  p_order_id   uuid,
  p_commitment bytea
)
returns eworks.order_bids
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_order  eworks.test_orders;
  v_vendor uuid;
  v_bid    eworks.order_bids;
  v_path   ltree;
begin
  select * into v_order from eworks.test_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'order % not found', p_order_id;
  end if;

  if v_order.status <> 'FLOATED' then
    raise exception 'order % is % and is not accepting bids', p_order_id, v_order.status;
  end if;

  -- The window is closed by wall-clock, not by whether pg_cron has run yet. A
  -- bid arriving one second after bid_close_at must lose even if the sweeper is
  -- lagging -- otherwise a late bidder who has seen the field can still enter.
  if now() >= v_order.bid_close_at then
    raise exception 'bidding closed for order % at %', p_order_id, v_order.bid_close_at;
  end if;

  select v.id into v_vendor from eworks.vendors v
   where v.owner_user_id = eworks.current_user_id();
  if v_vendor is null then
    raise exception 'caller does not own a vendor' using errcode = 'insufficient_privilege';
  end if;

  select path into v_path from eworks.org_units where id = v_order.org_unit_id;
  if not eworks.has_permission_anywhere('bid.submit') then
    raise exception 'permission denied: bid.submit' using errcode = 'insufficient_privilege';
  end if;

  -- s7: "technical-qualification lock auto-rejects expired NABL/PWD". Checked
  -- at submit AND again at award, because accreditation can lapse in between.
  if not exists (select 1 from eworks.eligible_vendors_for_order(p_order_id)
                  where vendor_id = v_vendor) then
    raise exception 'vendor % is not eligible for order %', v_vendor, p_order_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into eworks.order_bids (order_id, vendor_id, commitment)
  values (p_order_id, v_vendor, p_commitment)
  returning * into v_bid;

  -- The payload records the commitment, never a price -- there is no price to
  -- record. The audit log is readable by auditors, and must not become the
  -- side channel that the sealed bid was designed to eliminate.
  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'bid.commit', 'order_bid', v_bid.id, v_path,
          jsonb_build_object('order_id', p_order_id, 'vendor_id', v_vendor,
                             'commitment_sha256', encode(p_commitment, 'hex')));

  return v_bid;
end;
$$;


-- ---------------------------------------------------------------------------
-- Closing the bidding window
-- ---------------------------------------------------------------------------

-- FLOATED -> REVEALING. Idempotent and safe to call from pg_cron every minute.
create or replace function eworks.close_bidding(p_order_id uuid)
returns eworks.test_orders
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_order eworks.test_orders;
begin
  select * into v_order from eworks.test_orders where id = p_order_id for update;

  if v_order.status <> 'FLOATED' then
    return v_order;                       -- already closed; nothing to do
  end if;
  if now() < v_order.bid_close_at then
    raise exception 'order % does not close until %', p_order_id, v_order.bid_close_at;
  end if;

  -- No bids at all: the tender failed. Do not leave it hanging in REVEALING
  -- waiting for reveals that can never come.
  if not exists (select 1 from eworks.order_bids where order_id = p_order_id) then
    update eworks.test_orders set status = 'FAILED'
     where id = p_order_id returning * into v_order;

    insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
    select null, 'order.failed', 'test_order', p_order_id, ou.path,
           jsonb_build_object('reason', 'no bids received')
      from eworks.org_units ou where ou.id = v_order.org_unit_id;
    return v_order;
  end if;

  update eworks.test_orders set status = 'REVEALING'
   where id = p_order_id returning * into v_order;

  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  select null, 'order.bidding_closed', 'test_order', p_order_id, ou.path,
         jsonb_build_object('bid_count',
           (select count(*) from eworks.order_bids where order_id = p_order_id))
    from eworks.org_units ou where ou.id = v_order.org_unit_id;

  return v_order;
end;
$$;


-- ---------------------------------------------------------------------------
-- Revealing
-- ---------------------------------------------------------------------------
create or replace function eworks.reveal_bid(
  p_order_id    uuid,
  p_price_paise bigint,
  p_nonce       text
)
returns eworks.order_bids
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_order  eworks.test_orders;
  v_vendor uuid;
  v_bid    eworks.order_bids;
  v_path   ltree;
begin
  select * into v_order from eworks.test_orders where id = p_order_id;
  if v_order.status <> 'REVEALING' then
    raise exception 'order % is % and is not accepting reveals', p_order_id, v_order.status;
  end if;
  if now() > v_order.reveal_close_at then
    raise exception 'reveal window for order % closed at %', p_order_id, v_order.reveal_close_at;
  end if;

  select v.id into v_vendor from eworks.vendors v
   where v.owner_user_id = eworks.current_user_id();

  select * into v_bid from eworks.order_bids
   where order_id = p_order_id and vendor_id = v_vendor for update;
  if v_bid.id is null then
    raise exception 'no committed bid for this vendor on order %', p_order_id;
  end if;
  if v_bid.status <> 'COMMITTED' then
    raise exception 'bid is already %', v_bid.status;
  end if;

  -- The whole scheme rests on this comparison. A vendor who tries to reveal a
  -- lower price than they committed to produces a different digest and is
  -- rejected.
  if eworks.bid_commitment(p_order_id, v_vendor, p_price_paise, p_nonce)
     is distinct from v_bid.commitment then
    raise exception 'reveal does not match commitment for order %', p_order_id
      using errcode = 'check_violation';
  end if;

  update eworks.order_bids
     set revealed_price_paise = p_price_paise,
         nonce                = p_nonce,
         revealed_at          = now(),
         status               = 'REVEALED'
   where id = v_bid.id
  returning * into v_bid;

  select path into v_path from eworks.org_units where id = v_order.org_unit_id;
  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'bid.reveal', 'order_bid', v_bid.id, v_path,
          jsonb_build_object('order_id', p_order_id, 'price_paise', p_price_paise));

  return v_bid;
end;
$$;


-- ---------------------------------------------------------------------------
-- Award: atomic, row-locked, exactly one winner
-- ---------------------------------------------------------------------------
create or replace function eworks.finalize_award(p_order_id uuid)
returns eworks.order_award
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_order  eworks.test_orders;
  v_win    record;
  v_count  int;
  v_award  eworks.order_award;
  v_path   ltree;
begin
  -- FOR UPDATE serialises concurrent finalisers. Two pg_cron workers, or a
  -- worker racing a manual call, cannot both compute a winner.
  select * into v_order from eworks.test_orders where id = p_order_id for update;
  if v_order.status <> 'REVEALING' then
    raise exception 'order % is % and cannot be awarded', p_order_id, v_order.status;
  end if;
  if now() < v_order.reveal_close_at then
    raise exception 'reveal window for order % is still open until %',
      p_order_id, v_order.reveal_close_at;
  end if;

  select path into v_path from eworks.org_units where id = v_order.org_unit_id;

  -- Anyone who committed and never revealed forfeits. They gambled on being
  -- able to withdraw after seeing the field; the tender conditions attach an
  -- EMD penalty to this row.
  update eworks.order_bids set status = 'FORFEITED'
   where order_id = p_order_id and status = 'COMMITTED';

  -- Re-check technical qualification. A NABL certificate that lapsed between
  -- commit and award must disqualify, or the winner cannot legally perform the
  -- test they just won.
  update eworks.order_bids b set status = 'DISQUALIFIED'
   where b.order_id = p_order_id
     and b.status = 'REVEALED'
     and not exists (
       select 1 from eworks.eligible_vendors_for_order(p_order_id) e
        where e.vendor_id = b.vendor_id);

  select count(*) into v_count from eworks.order_bids
   where order_id = p_order_id and status = 'REVEALED';

  if v_count = 0 then
    update eworks.test_orders set status = 'FAILED' where id = p_order_id;
    insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
    values (null, 'order.failed', 'test_order', p_order_id, v_path,
            jsonb_build_object('reason', 'no technically-qualified revealed bid'));
    return null;
  end if;

  -- L1 among the technically qualified.
  --
  -- The tie-break is deterministic and published: lowest price, then earliest
  -- commitment, then vendor_id. Leaving ties to plan order would mean the same
  -- auction could award differently on a replay, which is indefensible when an
  -- unsuccessful bidder asks why they lost.
  select b.id, b.vendor_id, b.revealed_price_paise
    into v_win
    from eworks.order_bids b
   where b.order_id = p_order_id and b.status = 'REVEALED'
   order by b.revealed_price_paise asc, b.committed_at asc, b.vendor_id asc
   limit 1;

  insert into eworks.order_award
    (order_id, bid_id, vendor_id, price_paise, eval_method, qualified_bid_count, awarded_by)
  values
    (p_order_id, v_win.id, v_win.vendor_id, v_win.revealed_price_paise,
     v_order.eval_method, v_count, eworks.current_user_id())
  returning * into v_award;

  update eworks.test_orders set status = 'AWARDED' where id = p_order_id;

  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'order.award', 'test_order', p_order_id, v_path,
          jsonb_build_object('vendor_id', v_win.vendor_id,
                             'price_paise', v_win.revealed_price_paise,
                             'qualified_bid_count', v_count));

  return v_award;
end;
$$;


-- ---------------------------------------------------------------------------
-- pg_cron entry points (s2, s7, s10)
-- ---------------------------------------------------------------------------
-- pg_cron is not installed by these migrations: on hosted Supabase it is
-- enabled from the dashboard, and on a self-hosted cluster it needs
-- shared_preload_libraries. Schedule these two once it exists:
--
--   select cron.schedule('eworks-close-bidding',  '* * * * *',
--                        $$select eworks.sweep_close_bidding()$$);
--   select cron.schedule('eworks-finalize-awards','* * * * *',
--                        $$select eworks.sweep_finalize_awards()$$);
--
-- Both are idempotent, so a missed tick self-heals on the next one.

create or replace function eworks.sweep_close_bidding()
returns int
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare r record; n int := 0;
begin
  for r in
    select id from eworks.test_orders
     where status = 'FLOATED' and bid_close_at <= now()
     -- SKIP LOCKED: a row another worker is already closing is not an error,
     -- it is a row that is being handled.
     for update skip locked
  loop
    perform eworks.close_bidding(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function eworks.sweep_finalize_awards()
returns int
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare r record; n int := 0;
begin
  for r in
    select id from eworks.test_orders
     where status = 'REVEALING' and reveal_close_at <= now()
     for update skip locked
  loop
    perform eworks.finalize_award(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table eworks.order_bids  enable row level security;
alter table eworks.order_award enable row level security;

grant select on eworks.order_bids to eworks_authenticated;
grant select on eworks.order_award to eworks_authenticated;
-- No INSERT/UPDATE grant on order_bids. Bids are placed only through
-- submit_bid_commitment() and reveal_bid(), which enforce the window, the
-- eligibility lock, and the hash check. A direct INSERT would bypass all three.

-- A vendor sees only its own bids. Officers see NOTHING until the window has
-- closed -- an officer who can count bids during the float knows how much
-- competition a favoured vendor faces, and can tip them off. Even the number of
-- bidders is information.
create policy order_bids_owner_read on eworks.order_bids
  for select to eworks_authenticated
  using (exists (select 1 from eworks.vendors v
                  where v.id = order_bids.vendor_id
                    and v.owner_user_id = eworks.current_user_id()));

create policy order_bids_officer_read_after_close on eworks.order_bids
  for select to eworks_authenticated
  using (
    exists (select 1 from eworks.test_orders o
             join eworks.org_units ou on ou.id = o.org_unit_id
            where o.id = order_bids.order_id
              and o.status in ('REVEALING', 'AWARDED', 'FAILED')
              and eworks.has_permission('order.award', ou.path))
  );

create policy order_award_read on eworks.order_award
  for select to eworks_authenticated
  using (
    -- The winner learns they won.
    exists (select 1 from eworks.vendors v
             where v.id = order_award.vendor_id
               and v.owner_user_id = eworks.current_user_id())
    -- Officers and auditors see awards in their scope.
    or exists (select 1 from eworks.test_orders o
                join eworks.org_units ou on ou.id = o.org_unit_id
               where o.id = order_award.order_id
                 and eworks.has_permission('order.read', ou.path))
  );

comment on table eworks.order_bids is
  'Commit-reveal sealed bids. During the float window the database holds only '
  'sha256(order:vendor:price:nonce) -- there is no plaintext and no key, so '
  'early opening is impossible rather than merely forbidden.';
