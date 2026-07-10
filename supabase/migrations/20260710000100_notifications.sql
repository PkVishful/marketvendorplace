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
