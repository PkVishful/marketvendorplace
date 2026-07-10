-- Phase 5a: ground execution -- geo-fenced check-in, serialized QR, and a
-- hash-chained chain of custody (master prompt s7 step 4, s9, s13).
--
-- Threat model, stated plainly. The people this guards against are not remote
-- attackers; they are a technician who never went to site, a lab that tested a
-- different cube, and a contractor who wants a passing certificate for concrete
-- that was never poured. Every control below exists because one of those has
-- happened somewhere.
--
-- The rule throughout: the SERVER decides. GPS, distance, and timestamps are
-- never accepted as computed by the client. The client supplies raw readings;
-- PostGIS and now() decide what they mean.

insert into eworks.settings (key, value) values
  -- How close to the site a technician must be. Configurable per s0 -- a linear
  -- road project needs a wider fence than a building plot.
  ('geofence_radius_m',        '150'::jsonb),
  -- Worst GPS accuracy accepted. A 500 m accuracy circle "containing" the site
  -- proves nothing.
  ('geofence_max_accuracy_m',  '50'::jsonb),
  -- Tolerated difference between the device clock and the server clock.
  ('max_clock_skew_seconds',   '300'::jsonb)
on conflict (key) do nothing;


create type eworks.job_status as enum (
  'ASSIGNED',        -- award created the job
  'CHECKED_IN',      -- technician verified on site
  'SAMPLES_SEALED',  -- specimens molded, QR bound, sealed
  'IN_TRANSIT',
  'RECEIVED_AT_LAB',
  'TESTING',
  'COMPLETE',
  'CANCELLED'
);

create table eworks.test_jobs (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references eworks.test_orders(id) on delete restrict,
  vendor_id     uuid not null references eworks.vendors(id) on delete restrict,
  technician_id uuid references eworks.user_profiles(id) on delete restrict,

  status        eworks.job_status not null default 'ASSIGNED',

  -- Bound at first check-in and immutable thereafter. A second phone cannot
  -- continue a job the first one started.
  device_id     text,

  created_at    timestamptz not null default now(),

  -- s7: a job exists because an award exists. One job per awarded order.
  constraint test_jobs_one_per_order unique (order_id)
);

create index test_jobs_vendor_idx on eworks.test_jobs (vendor_id, status);
create index test_jobs_tech_idx on eworks.test_jobs (technician_id, status);


-- A job may be created only for an AWARDED order, and only for the vendor that
-- actually won it. Without this, a losing bidder could be handed the work.
create or replace function eworks.test_jobs_award_check()
returns trigger language plpgsql
security definer set search_path = eworks, public, extensions, pg_temp
as $$
declare v_winner uuid; v_status eworks.order_status;
begin
  select status into v_status from eworks.test_orders where id = new.order_id;
  if v_status is distinct from 'AWARDED' then
    raise exception 'cannot create a job for order % in status %', new.order_id, v_status;
  end if;

  select vendor_id into v_winner from eworks.order_award where order_id = new.order_id;
  if v_winner is distinct from new.vendor_id then
    raise exception 'job vendor % did not win order % (winner is %)',
      new.vendor_id, new.order_id, v_winner;
  end if;
  return new;
end;
$$;

create trigger test_jobs_award_trg
  before insert or update of order_id, vendor_id on eworks.test_jobs
  for each row execute function eworks.test_jobs_award_check();


-- ---------------------------------------------------------------------------
-- Geo-fenced check-in
-- ---------------------------------------------------------------------------
create table eworks.site_checkins (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references eworks.test_jobs(id) on delete cascade,
  technician_id  uuid not null references eworks.user_profiles(id) on delete restrict,

  -- Raw client readings. Recorded for forensics; never trusted for decisions.
  reported_at    timestamptz not null,     -- device clock
  gps            geography(Point, 4326) not null,
  accuracy_m     numeric(8,2) not null check (accuracy_m >= 0),
  device_id      text not null,

  -- s9: fake/duplicate photo detection. A globally unique hash means the same
  -- image can never be presented for two check-ins.
  photo_sha256   bytea not null check (length(photo_sha256) = 32),

  -- Server-computed. These are the values anyone auditing this should read.
  server_at      timestamptz not null default now(),
  distance_m     double precision not null,
  clock_skew_s   double precision not null,

  constraint site_checkins_one_per_job unique (job_id)
);

-- A photo may be used exactly once, anywhere in the system.
create unique index site_checkins_photo_unique on eworks.site_checkins (photo_sha256);
create index site_checkins_gps_gist on eworks.site_checkins using gist (gps);


-- The only way to check in. Computes distance and skew server-side and refuses
-- anything outside the configured fence.
--
-- Deliberately NOT accepting a client-supplied distance. That is the whole
-- control: a technician sitting at home can send any latitude they like, but
-- they cannot make PostGIS agree that it is within 150 m of the pour.
create or replace function eworks.check_in(
  p_job_id      uuid,
  p_lat         double precision,
  p_lon         double precision,
  p_accuracy_m  numeric,
  p_device_id   text,
  p_photo_sha256 bytea,
  p_reported_at timestamptz
)
returns eworks.site_checkins
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_job      eworks.test_jobs;
  v_site     geography(Point, 4326);
  v_gps      geography(Point, 4326);
  v_dist     double precision;
  v_skew     double precision;
  v_row      eworks.site_checkins;
  v_radius   numeric;
  v_max_acc  numeric;
  v_max_skew numeric;
  v_path     ltree;
begin
  select * into v_job from eworks.test_jobs where id = p_job_id for update;
  if v_job.id is null then
    raise exception 'job % not found', p_job_id;
  end if;
  if v_job.status <> 'ASSIGNED' then
    raise exception 'job % is % and cannot be checked in again', p_job_id, v_job.status;
  end if;

  -- Only the assigned technician. Not "someone from the winning lab".
  if v_job.technician_id is distinct from eworks.current_user_id() then
    raise exception 'only the assigned technician may check in'
      using errcode = 'insufficient_privilege';
  end if;

  select value #>> '{}' into v_radius   from eworks.settings where key='geofence_radius_m';
  select value #>> '{}' into v_max_acc  from eworks.settings where key='geofence_max_accuracy_m';
  select value #>> '{}' into v_max_skew from eworks.settings where key='max_clock_skew_seconds';

  -- A reading with a 500 m error radius "containing" the site proves nothing.
  if p_accuracy_m > v_max_acc then
    raise exception 'GPS accuracy %m exceeds the permitted %m', p_accuracy_m, v_max_acc;
  end if;

  -- The device clock is attacker-controlled. Compare it to ours and refuse a
  -- reading that claims to have been taken at a convenient time.
  v_skew := abs(extract(epoch from (p_reported_at - now())));
  if v_skew > v_max_skew then
    raise exception 'device clock is %s seconds off the server clock (max %s)',
      round(v_skew), v_max_skew;
  end if;

  select o.site into v_site
    from eworks.test_orders o where o.id = v_job.order_id;

  v_gps  := st_makepoint(p_lon, p_lat)::geography;
  v_dist := st_distance(v_gps, v_site);

  if v_dist > v_radius then
    raise exception 'check-in is %m from the site; the geofence is %m',
      round(v_dist::numeric), v_radius
      using errcode = 'check_violation';
  end if;

  insert into eworks.site_checkins
    (job_id, technician_id, reported_at, gps, accuracy_m, device_id,
     photo_sha256, distance_m, clock_skew_s)
  values
    (p_job_id, eworks.current_user_id(), p_reported_at, v_gps, p_accuracy_m,
     p_device_id, p_photo_sha256, v_dist, v_skew)
  returning * into v_row;

  -- Bind the device. Subsequent custody events must come from the same handset.
  update eworks.test_jobs
     set status = 'CHECKED_IN', device_id = p_device_id
   where id = p_job_id;

  select ou.path into v_path
    from eworks.test_orders o join eworks.org_units ou on ou.id = o.org_unit_id
   where o.id = v_job.order_id;

  insert into eworks.audit_logs (actor_id, action, entity_type, entity_id, org_path, payload)
  values (eworks.current_user_id(), 'job.check_in', 'test_job', p_job_id, v_path,
          jsonb_build_object('distance_m', round(v_dist::numeric, 2),
                             'accuracy_m', p_accuracy_m,
                             'clock_skew_s', round(v_skew),
                             'device_id', p_device_id));
  return v_row;
end;
$$;


-- ---------------------------------------------------------------------------
-- Specimens and serialized QR
-- ---------------------------------------------------------------------------
create table eworks.samples (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references eworks.test_jobs(id) on delete cascade,
  test_id      uuid not null references eworks.test_catalog(id) on delete restrict,

  -- s11: unique (qr_code). Globally unique, so a QR sticker can never be
  -- attached to two specimens -- the classic swap.
  --
  -- Crockford-style alphabet: no I, O, 0 or 1. These labels get written on wet
  -- concrete, photographed in bad light, and read back by hand. A code that can
  -- be transcribed two ways is a code that will be.
  qr_code      text not null unique check (qr_code ~ '^EW-[2-9A-HJ-NP-Z]{12}$'),
  specimen_no  int not null check (specimen_no > 0),

  -- 7 or 28. A cube broken at 7 days is not the same specimen as one at 28.
  test_age_days int,

  molded_at    timestamptz not null default now(),

  constraint samples_unique_per_job unique (job_id, test_id, specimen_no, test_age_days)
);

create index samples_job_idx on eworks.samples (job_id);


-- ---------------------------------------------------------------------------
-- Chain of custody -- hash-chained per specimen
-- ---------------------------------------------------------------------------
create type eworks.custody_event as enum (
  'MOLDED', 'SEALED', 'PICKED_UP', 'IN_TRANSIT', 'RECEIVED_AT_LAB', 'TESTED'
);

create table eworks.chain_of_custody (
  seq         bigint primary key generated always as identity,
  sample_id   uuid not null references eworks.samples(id) on delete restrict,
  event       eworks.custody_event not null,
  actor_id    uuid not null references eworks.user_profiles(id) on delete restrict,

  gps         geography(Point, 4326),
  device_id   text,
  occurred_at timestamptz not null default now(),

  prev_hash   bytea not null,
  row_hash    bytea not null,

  -- One event of each kind per specimen. A cube cannot be received at the lab
  -- twice; a second RECEIVED is a swap, not a duplicate scan.
  constraint custody_event_once unique (sample_id, event)
);

create index custody_sample_idx on eworks.chain_of_custody (sample_id, seq);

-- Each specimen carries its OWN chain, anchored to its sample_id. A single
-- global chain would serialize every technician in the state behind one lock,
-- and a break anywhere would invalidate every specimen everywhere.
create or replace function eworks.custody_genesis_hash(p_sample_id uuid)
returns bytea language sql immutable parallel safe
set search_path = eworks, public, extensions, pg_temp
as $$ select digest(convert_to('custody:' || p_sample_id::text, 'UTF8'), 'sha256'); $$;

create or replace function eworks.custody_canonical_bytes(
  prev_hash bytea, sample_id uuid, event eworks.custody_event, actor_id uuid,
  gps geography, occurred_at timestamptz
)
returns bytea language sql immutable parallel safe
set search_path = eworks, public, extensions, pg_temp
as $$
  select convert_to(
    encode(prev_hash,'hex')
      || '|' || sample_id::text
      || '|' || event::text
      || '|' || actor_id::text
      || '|' || coalesce(st_astext(gps), '')
      -- Fixed UTC rendering: a verifier in another timezone must compute the
      -- same digest, or it would report tampering that never happened.
      || '|' || to_char(occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'UTF8');
$$;

create or replace function eworks.custody_seal()
returns trigger language plpgsql
security definer set search_path = eworks, public, extensions, pg_temp
as $$
declare tail bytea;
begin
  -- Lock this specimen's chain only. Two technicians working different cubes
  -- never contend.
  perform pg_advisory_xact_lock(hashtext('eworks.custody.' || new.sample_id::text));

  select row_hash into tail from eworks.chain_of_custody
   where sample_id = new.sample_id order by seq desc limit 1;

  new.prev_hash := coalesce(tail, eworks.custody_genesis_hash(new.sample_id));
  new.row_hash  := digest(
    eworks.custody_canonical_bytes(new.prev_hash, new.sample_id, new.event,
                                   new.actor_id, new.gps, new.occurred_at),
    'sha256');
  return new;
end;
$$;

create trigger custody_seal_trg before insert on eworks.chain_of_custody
  for each row execute function eworks.custody_seal();

create or replace function eworks.custody_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'chain_of_custody is append-only (attempted %)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger custody_no_change_trg before update or delete on eworks.chain_of_custody
  for each row execute function eworks.custody_immutable();

-- Returns the first broken seq for this specimen, or NULL if intact.
create or replace function eworks.verify_custody_chain(p_sample_id uuid)
returns bigint
language plpgsql stable
security definer set search_path = eworks, public, extensions, pg_temp
as $$
declare r record; expected bytea;
begin
  expected := eworks.custody_genesis_hash(p_sample_id);
  for r in select * from eworks.chain_of_custody
            where sample_id = p_sample_id order by seq asc loop
    if r.prev_hash is distinct from expected then return r.seq; end if;
    if r.row_hash is distinct from digest(
         eworks.custody_canonical_bytes(r.prev_hash, r.sample_id, r.event,
                                        r.actor_id, r.gps, r.occurred_at),
         'sha256') then
      return r.seq;
    end if;
    expected := r.row_hash;
  end loop;
  return null;
end;
$$;


-- Record a custody event by scanning a QR code.
create or replace function eworks.record_custody(
  p_qr_code   text,
  p_event     eworks.custody_event,
  p_lat       double precision default null,
  p_lon       double precision default null,
  p_device_id text default null
)
returns eworks.chain_of_custody
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  v_sample eworks.samples;
  v_job    eworks.test_jobs;
  v_row    eworks.chain_of_custody;
begin
  select * into v_sample from eworks.samples where qr_code = p_qr_code;
  if v_sample.id is null then
    raise exception 'unknown QR code %', p_qr_code;
  end if;

  select * into v_job from eworks.test_jobs where id = v_sample.job_id;

  -- Device binding (s9). Once a handset checks in, the same handset must carry
  -- the specimen. A different device mid-chain is a hand-off nobody recorded.
  if p_device_id is not null and v_job.device_id is not null
     and p_device_id <> v_job.device_id then
    raise exception 'device % is not the device bound to job %', p_device_id, v_job.id
      using errcode = 'insufficient_privilege';
  end if;

  insert into eworks.chain_of_custody (sample_id, event, actor_id, gps, device_id)
  values (v_sample.id, p_event, eworks.current_user_id(),
          case when p_lat is null then null
               else st_makepoint(p_lon, p_lat)::geography end,
          p_device_id)
  returning * into v_row;

  return v_row;
end;
$$;


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table eworks.test_jobs        enable row level security;
alter table eworks.site_checkins    enable row level security;
alter table eworks.samples          enable row level security;
alter table eworks.chain_of_custody enable row level security;

grant select on eworks.test_jobs, eworks.site_checkins,
                eworks.samples, eworks.chain_of_custody to eworks_authenticated;
grant insert on eworks.samples to eworks_authenticated;
-- No direct insert on site_checkins or chain_of_custody: the geofence check and
-- the hash chain live in check_in() and record_custody().

-- The vendor that owns the job, the technician assigned to it, and officers
-- with order.read in scope. Nobody else.
create policy jobs_read on eworks.test_jobs
  for select to eworks_authenticated
  using (
    technician_id = eworks.current_user_id()
    or exists (select 1 from eworks.vendors v
                where v.id = test_jobs.vendor_id
                  and v.owner_user_id = eworks.current_user_id())
    or exists (select 1 from eworks.test_orders o
                join eworks.org_units ou on ou.id = o.org_unit_id
               where o.id = test_jobs.order_id
                 and eworks.has_permission('order.read', ou.path))
  );

-- Everything below inherits the job's visibility, so a lab cannot see another
-- lab's specimens or custody trail.
create policy checkins_read on eworks.site_checkins
  for select to eworks_authenticated
  using (exists (select 1 from eworks.test_jobs j where j.id = site_checkins.job_id));

create policy samples_read on eworks.samples
  for select to eworks_authenticated
  using (exists (select 1 from eworks.test_jobs j where j.id = samples.job_id));

create policy samples_write on eworks.samples
  for insert to eworks_authenticated
  with check (exists (select 1 from eworks.test_jobs j
                       where j.id = samples.job_id
                         and j.technician_id = eworks.current_user_id()
                         and j.status = 'CHECKED_IN'));

create policy custody_read on eworks.chain_of_custody
  for select to eworks_authenticated
  using (exists (select 1 from eworks.samples s
                  join eworks.test_jobs j on j.id = s.job_id
                 where s.id = chain_of_custody.sample_id));

comment on function eworks.check_in(uuid, double precision, double precision,
  numeric, text, bytea, timestamptz) is
  'Server-verified geofence. Distance and clock skew are computed here, never '
  'accepted from the client. Refuses outside the configured radius.';
