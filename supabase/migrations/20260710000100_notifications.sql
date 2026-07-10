-- Phase 6a: notifications (master prompt s7 step 2, s10, s11, s13 Phase 6).
--
-- Three tables, not one, because commit-reveal makes "was this vendor told the
-- reveal window opened, and when?" a question the system must be able to answer
-- on the record. A vendor who does not reveal is FORFEITED and loses their EMD.
--
-- s7 names pgmq. This uses a plain outbox table drained with FOR UPDATE SKIP
-- LOCKED, which is what pgmq is. See the spec for why: no extension means the
-- migrations run unchanged on a NIC or State Data Centre cluster, and Phase 6a
-- stays verifiable by db-test.sh on a stock PostgreSQL.
--
-- Notifications are NOT written to audit_logs. The state change that produced
-- each one already is, and audit_logs_seal() takes an advisory lock that
-- serialises every append -- fanning out inside it would put the PostGIS radius
-- query behind the one global lock, at exactly the bid-broadcast spike.

create type eworks.notification_event_type as enum (
  'VENDOR_APPROVED',
  'VENDOR_REJECTED',
  'ORDER_FLOATED',      -- fanned out to every eligible vendor
  'REVEAL_WINDOW_OPEN', -- fairness-critical: silence here costs a vendor its EMD
  'AWARD_WON',
  'AWARD_LOST',
  'ORDER_FAILED'        -- closed with no qualified bid; the officer must know
);

-- WEB is deliberately absent. The in-app feed IS the notifications table;
-- there is nothing to deliver. PUSH exists but nothing enqueues it yet -- there
-- is no device-token table and inventing one is out of scope.
create type eworks.notification_channel as enum ('SMS', 'PUSH');

create type eworks.delivery_status as enum (
  'PENDING', 'CLAIMED', 'DELIVERED', 'FAILED',
  'DEAD'   -- attempts exhausted. Never deleted: for REVEAL_WINDOW_OPEN this is
           -- the list of vendors about to be forfeited unfairly.
);


-- ---------------------------------------------------------------------------
-- notification_events -- what happened, recorded once
-- ---------------------------------------------------------------------------
create table eworks.notification_events (
  id          uuid primary key default gen_random_uuid(),
  event_type  eworks.notification_event_type not null,

  order_id    uuid references eworks.test_orders(id) on delete cascade,
  vendor_id   uuid references eworks.vendors(id) on delete cascade,

  -- Denormalised so the auditor read policy never joins back to the subject
  -- table. test_orders' own RLS would hide the row from an auditor who lacks
  -- order.read, and the audit answer would be silently incomplete.
  org_path    ltree not null,

  occurred_at timestamptz not null default now(),

  constraint notification_events_one_subject check (
    (order_id is not null)::int + (vendor_id is not null)::int = 1
  ),
  -- The subject column must agree with the event type.
  constraint notification_events_subject_matches_type check (
    case
      when event_type in ('VENDOR_APPROVED','VENDOR_REJECTED') then vendor_id is not null
      else order_id is not null
    end
  )
);

-- Idempotency. sweep_close_bidding() and sweep_finalize_awards() are documented
-- as idempotent and self-healing; a missed pg_cron tick re-runs them. This index
-- is what stops the re-run notifying everybody twice.
--
-- No equivalent on vendor_id: a vendor may be SUSPENDED and later APPROVED
-- again, and each approval is a real event.
create unique index notification_events_once_per_order
  on eworks.notification_events (event_type, order_id)
  where order_id is not null;

create index notification_events_org_idx
  on eworks.notification_events using gist (org_path);


-- ---------------------------------------------------------------------------
-- notifications -- one row per recipient. The only table RLS guards.
-- ---------------------------------------------------------------------------
--
-- Carries NO order content: event_type and subject live on the event, and the
-- client joins to test_orders, where live RLS decides what it may see. A vendor
-- whose NABL lapsed after the float still holds this row, follows it, and reads
-- zero rows. Dead link, not leak. That is what reconciles this table with the
-- README's "order eligibility is recomputed per row, never cached".
create table eworks.notifications (
  id                uuid not null default gen_random_uuid(),

  -- Copied from the event's occurred_at, never defaulted to now().
  --
  -- A UNIQUE on a partitioned table must contain the partition key. Stamping
  -- every recipient row of one event with that event's timestamp puts them all
  -- in the same partition, so the dedup below stays exact after this table is
  -- RANGE-partitioned by month. now() happens to be transaction-start time and
  -- would work today, but that ties correctness to an incidental property.
  created_at        timestamptz not null,

  event_id          uuid not null references eworks.notification_events(id) on delete cascade,
  recipient_user_id uuid not null references eworks.user_profiles(id) on delete cascade,
  read_at           timestamptz,

  primary key (created_at, id),
  constraint notifications_one_per_recipient unique (created_at, event_id, recipient_user_id)
);

-- s11: "Vendor notification feed | (vendor_id, created_at DESC)".
create index notifications_feed_idx
  on eworks.notifications (recipient_user_id, created_at desc);

create index notifications_unread_idx
  on eworks.notifications (recipient_user_id) where read_at is null;


-- ---------------------------------------------------------------------------
-- notification_deliveries -- the outbox. eworks_authenticated gets NOTHING.
-- ---------------------------------------------------------------------------
create table eworks.notification_deliveries (
  id                      bigint generated always as identity primary key,

  notification_created_at timestamptz not null,
  notification_id         uuid not null,

  channel                 eworks.notification_channel not null,
  status                  eworks.delivery_status not null default 'PENDING',

  attempts                int not null default 0 check (attempts >= 0),
  next_attempt_at         timestamptz not null default now(),

  claimed_at              timestamptz,
  claimed_by              text,
  last_error              text,
  delivered_at            timestamptz,

  foreign key (notification_created_at, notification_id)
    references eworks.notifications (created_at, id) on delete cascade,

  constraint deliveries_one_per_channel
    unique (notification_created_at, notification_id, channel),

  constraint deliveries_delivered_has_timestamp check (
    status <> 'DELIVERED' or delivered_at is not null
  )
);

-- The claim query: due work on one channel, oldest first.
create index deliveries_due_idx
  on eworks.notification_deliveries (channel, next_attempt_at)
  where status in ('PENDING', 'FAILED');


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table eworks.notification_events enable row level security;
alter table eworks.notifications enable row level security;
alter table eworks.notification_deliveries enable row level security;


-- Two policies that each need to consult the other's table would recurse:
-- evaluating notifications_read would evaluate notification_events_read, which
-- would evaluate notifications_read. PostgreSQL detects this and refuses every
-- read of either table.
--
-- The project already solved this once. eworks.has_permission() is SECURITY
-- DEFINER and reads user_roles, which has RLS enabled -- a definer function
-- runs as the owner, and the owner bypasses RLS (no table here sets FORCE ROW
-- LEVEL SECURITY). These two helpers restore that idiom.
--
-- Neither widens what anyone can see. event_org_path() discloses an org_path to
-- a caller who already holds the event's uuid, and that path is then handed
-- straight to has_permission(), which decides. is_notification_recipient() only
-- ever answers about the calling user.

create or replace function eworks.event_org_path(p_event_id uuid)
returns ltree
language sql
stable
parallel safe
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select org_path from eworks.notification_events where id = p_event_id;
$$;

create or replace function eworks.is_notification_recipient(p_event_id uuid)
returns boolean
language sql
stable
parallel safe
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select exists (
    select 1
      from eworks.notifications n
     where n.event_id = p_event_id
       and n.recipient_user_id = eworks.current_user_id()
  );
$$;

revoke all on function eworks.event_org_path(uuid) from public;
revoke all on function eworks.is_notification_recipient(uuid) from public;
grant execute on function eworks.event_org_path(uuid) to eworks_authenticated;
grant execute on function eworks.is_notification_recipient(uuid) to eworks_authenticated;


-- Read your own mail. The self-identity branch has precedent: user_profiles_read
-- opens with `id = eworks.current_user_id()`.
--
-- The second branch names a permission. It never leans on in_scope() alone --
-- in_scope() answers "where", never "whether", and a LAB_VENDOR holds a role
-- anchored in a district, so scope alone would show every lab the whole
-- district's notification traffic.
grant select on eworks.notifications to eworks_authenticated;
grant update (read_at) on eworks.notifications to eworks_authenticated;

create policy notifications_read on eworks.notifications
  for select to eworks_authenticated
  using (
    recipient_user_id = eworks.current_user_id()
    or eworks.has_permission('audit.read', eworks.event_org_path(event_id))
  );

-- Only your own row, and (via the column grant above) only read_at.
create policy notifications_mark_read on eworks.notifications
  for update to eworks_authenticated
  using (recipient_user_id = eworks.current_user_id())
  with check (recipient_user_id = eworks.current_user_id());

-- No INSERT or DELETE policy, and no INSERT/DELETE grant. Only the
-- SECURITY DEFINER emit trigger writes here.


grant select on eworks.notification_events to eworks_authenticated;

-- You may read an event only if you were told about it, or if you are an
-- auditor. Without this, the events table would leak every floated order's
-- existence to every vendor.
create policy notification_events_read on eworks.notification_events
  for select to eworks_authenticated
  using (
    eworks.is_notification_recipient(notification_events.id)
    or eworks.has_permission_anywhere('audit.read_all')
    or eworks.has_permission('audit.read', notification_events.org_path)
  );


-- notification_deliveries: RLS is enabled and NO policy is created, so even a
-- role holding an accidental future grant reads nothing. eworks_authenticated
-- is granted nothing at all. The worker reaches it only through the two
-- SECURITY DEFINER functions added in Task 7.


-- ---------------------------------------------------------------------------
-- The delivery worker's role
-- ---------------------------------------------------------------------------
--
-- It holds no table grants whatsoever -- only EXECUTE on two functions (Task 7).
-- So it cannot read the feed, cannot enumerate vendors or orders, and
-- service_role (which bypasses RLS entirely and would make every policy above
-- decorative) never needs to appear.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'eworks_notifier') then
    create role eworks_notifier nologin;
  end if;

  if not (select usesuper from pg_user where usename = current_user) then
    if current_setting('server_version_num')::int >= 160000 then
      execute format('grant eworks_notifier to %I with set true', current_user);
    elsif not pg_has_role(current_user, 'eworks_notifier', 'MEMBER') then
      execute format('grant eworks_notifier to %I', current_user);
    end if;
  end if;
end
$$;

grant usage on schema eworks to eworks_notifier;


-- ---------------------------------------------------------------------------
-- emit_notification -- the one place a notification is ever created
-- ---------------------------------------------------------------------------
--
-- Returns the new event id, or NULL if this order event has already fired.
-- Callers are triggers; they ignore the return value. Tests do not.
--
-- SECURITY DEFINER because the triggers run as whoever floated the order --
-- a site engineer, who holds no INSERT on notifications and never should.
create or replace function eworks.emit_notification(
  p_event_type  eworks.notification_event_type,
  p_order_id    uuid,
  p_vendor_id   uuid,
  p_org_path    ltree,
  p_recipients  uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_event_id uuid;
  v_at       timestamptz;
begin
  -- ON CONFLICT against notification_events_once_per_order. A second call for
  -- the same (event_type, order_id) inserts nothing and returns no row, so
  -- v_event_id stays null and the fan-out below is skipped entirely.
  insert into eworks.notification_events (event_type, order_id, vendor_id, org_path)
  values (p_event_type, p_order_id, p_vendor_id, p_org_path)
  on conflict do nothing
  returning id, occurred_at into v_event_id, v_at;

  if v_event_id is null then
    return null;
  end if;

  -- created_at := the event's occurred_at, so every recipient row lands in the
  -- same future partition. See the table comment.
  insert into eworks.notifications (created_at, event_id, recipient_user_id)
  select v_at, v_event_id, r
    from unnest(p_recipients) as r
   group by r;   -- a duplicate recipient in the array is one notification

  insert into eworks.notification_deliveries
    (notification_created_at, notification_id, channel)
  select n.created_at, n.id, 'SMS'
    from eworks.notifications n
   where n.event_id = v_event_id;

  return v_event_id;
end;
$$;

revoke all on function eworks.emit_notification(
  eworks.notification_event_type, uuid, uuid, ltree, uuid[]) from public;


-- ---------------------------------------------------------------------------
-- Emission: AFTER triggers, not calls inside the functions
-- ---------------------------------------------------------------------------
--
-- Triggers are unbypassable. A direct UPDATE to test_orders.status that skips
-- float_order() still notifies. That matters because -- unlike order_bids,
-- where eworks_authenticated holds no INSERT/UPDATE at all -- test_orders is
-- directly writable by officers.
--
-- The order state machine and custody_seal() already set this precedent.

create or replace function eworks.vendors_notify()
returns trigger
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_path ltree;
begin
  if old.status is not distinct from new.status then
    return null;
  end if;

  if new.status not in ('APPROVED', 'REJECTED') then
    return null;
  end if;

  select path into v_path from eworks.org_units where id = new.org_unit_id;

  perform eworks.emit_notification(
    case new.status when 'APPROVED' then 'VENDOR_APPROVED'::eworks.notification_event_type
                    else 'VENDOR_REJECTED'::eworks.notification_event_type end,
    null, new.id, v_path,
    array[new.owner_user_id]);

  return null;
end;
$$;

create trigger vendors_notify_status
  after update of status on eworks.vendors
  for each row execute function eworks.vendors_notify();


create or replace function eworks.test_orders_notify()
returns trigger
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_path       ltree;
  v_recipients uuid[];
begin
  if old.status is not distinct from new.status then
    return null;
  end if;

  if new.status not in ('FLOATED', 'REVEALING', 'FAILED') then
    return null;
  end if;

  select path into v_path from eworks.org_units where id = new.org_unit_id;

  if new.status = 'FLOATED' then
    -- The radius query, inside the float transaction. If it raises, the float
    -- rolls back and the order does not float. That is deliberate: an order
    -- that floats while silently telling nobody is an unfair tender that looks,
    -- from the officer's screen, exactly like a fair one.
    --
    -- Zero eligible vendors is NOT that case. It yields an event with zero
    -- recipients -- a queryable fact, not a crash.
    select coalesce(array_agg(v.owner_user_id), array[]::uuid[])
      into v_recipients
      from eworks.eligible_vendors_for_order(new.id) ev
      join eworks.vendors v on v.id = ev.vendor_id;

    perform eworks.emit_notification('ORDER_FLOATED', new.id, null, v_path, v_recipients);

  elsif new.status = 'REVEALING' then
    -- Every vendor holding a COMMITTED bid, and only them. A vendor who never
    -- bid has nothing to reveal and nothing to forfeit.
    select coalesce(array_agg(v.owner_user_id), array[]::uuid[])
      into v_recipients
      from eworks.order_bids b
      join eworks.vendors v on v.id = b.vendor_id
     where b.order_id = new.id and b.status = 'COMMITTED';

    perform eworks.emit_notification('REVEAL_WINDOW_OPEN', new.id, null, v_path, v_recipients);

  elsif new.status = 'FAILED' then
    perform eworks.emit_notification('ORDER_FAILED', new.id, null, v_path,
      array[new.created_by]);
  end if;

  return null;
end;
$$;

create trigger test_orders_notify_status
  after update of status on eworks.test_orders
  for each row execute function eworks.test_orders_notify();
