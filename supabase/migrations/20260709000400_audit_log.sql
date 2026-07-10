-- Immutable, hash-chained audit log (master prompt s0, s9, s14).
--
-- Threat model: an attacker with write access to the database -- including a
-- DBA -- edits or deletes a row to hide an action. Encryption does not help
-- here; detection does. Each row commits to its predecessor, so altering row N
-- invalidates every hash from N onward, and the break is provable against an
-- externally published checkpoint.
--
-- What this design DOES give you:
--   * Any modification or deletion of a past row is detectable.
--   * Deleting a suffix (the most recent k rows) is detectable only if the
--     head hash has been witnessed elsewhere. Publish it -- see
--     eworks.audit_head() and docs/security-gaps.md.
--
-- What it does NOT give you:
--   * Prevention. A superuser can disable triggers. The chain makes the
--     tampering loud, not impossible.

create table eworks.audit_logs (
  -- Chain order. bigint identity, never reused, never reordered.
  seq          bigint primary key generated always as identity,

  actor_id     uuid references eworks.user_profiles(id),
  action       text not null check (length(trim(action)) > 0),
  entity_type  text not null,
  entity_id    uuid,
  org_path     ltree,
  payload      jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),

  prev_hash    bytea not null,
  row_hash     bytea not null
);

create index audit_logs_entity_idx on eworks.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx  on eworks.audit_logs (actor_id, occurred_at desc);
create index audit_logs_org_gist   on eworks.audit_logs using gist (org_path);

-- The canonical byte string a row commits to. Any change to this function
-- invalidates every existing chain, so it is versioned by migration and must
-- never be edited in place.
--
-- jsonb's text representation is canonical in PostgreSQL: keys are sorted and
-- duplicates removed on input, so `payload::text` is stable for a given value.
create or replace function eworks.audit_canonical_bytes(
  prev_hash    bytea,
  actor_id     uuid,
  action       text,
  entity_type  text,
  entity_id    uuid,
  org_path     ltree,
  payload      jsonb,
  occurred_at  timestamptz
)
returns bytea
language sql
immutable
parallel safe
as $$
  select convert_to(
    encode(prev_hash, 'hex')
      || '|' || coalesce(actor_id::text, '')
      || '|' || action
      || '|' || entity_type
      || '|' || coalesce(entity_id::text, '')
      || '|' || coalesce(org_path::text, '')
      || '|' || payload::text
      -- Fixed ISO-8601 UTC rendering. Never rely on DateStyle/TimeZone GUCs:
      -- a session with a different TimeZone would otherwise compute a
      -- different hash for the same row and fake a chain break.
      || '|' || to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'UTF8'
  );
$$;

-- Genesis: the all-zero 32-byte hash anchors the first row.
create or replace function eworks.audit_genesis_hash()
returns bytea language sql immutable parallel safe as
$$ select '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea; $$;

create or replace function eworks.audit_logs_seal()
returns trigger
language plpgsql
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  tail_hash bytea;
begin
  -- Serialize appenders. Without this, two concurrent inserts can read the
  -- same tail and fork the chain into two rows sharing a prev_hash -- which
  -- verification would report as tampering. The advisory lock is transaction
  -- scoped and released on commit or rollback.
  --
  -- This makes audit appends single-threaded, which is the real cost of a
  -- linear chain. It is acceptable at government+vendor write rates; if it
  -- ever binds, the fix is per-org-unit chains, not dropping the chain.
  perform pg_advisory_xact_lock(hashtext('eworks.audit_logs.chain'));

  select row_hash into tail_hash
    from eworks.audit_logs
   order by seq desc
   limit 1;

  new.prev_hash := coalesce(tail_hash, eworks.audit_genesis_hash());
  new.row_hash  := digest(
    eworks.audit_canonical_bytes(
      new.prev_hash, new.actor_id, new.action, new.entity_type,
      new.entity_id, new.org_path, new.payload, new.occurred_at
    ),
    'sha256'
  );
  return new;
end;
$$;

create trigger audit_logs_seal_trg
  before insert on eworks.audit_logs
  for each row execute function eworks.audit_logs_seal();

-- Append-only. Blocks the ordinary path; a superuser can still ALTER TABLE
-- ... DISABLE TRIGGER, which is exactly the case the hash chain exists to
-- catch after the fact.
create or replace function eworks.audit_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'eworks.audit_logs is append-only (attempted %)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger audit_logs_no_update_trg
  before update or delete on eworks.audit_logs
  for each row execute function eworks.audit_logs_immutable();

-- Recomputes the chain and returns the first sequence number that does not
-- verify. Returns NULL when the log is intact.
create or replace function eworks.verify_audit_chain(from_seq bigint default 0)
returns bigint
language plpgsql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  r         record;
  expected  bytea := null;
begin
  -- When verifying from the beginning, the first surviving row must descend
  -- from the genesis hash. Without this, deleting a prefix of the log (rows
  -- 1..k) leaves a chain that is internally consistent and would verify clean.
  -- Anchoring the head closes that hole; anchoring the tail needs an external
  -- witness (see eworks.audit_head()).
  if from_seq = 0 then
    expected := eworks.audit_genesis_hash();
  end if;

  for r in
    select * from eworks.audit_logs where seq > from_seq order by seq asc
  loop
    -- Continuity: this row must point at the previous row's hash.
    if expected is not null and r.prev_hash is distinct from expected then
      return r.seq;
    end if;

    -- Integrity: the row's own contents must reproduce its hash.
    if r.row_hash is distinct from digest(
         eworks.audit_canonical_bytes(
           r.prev_hash, r.actor_id, r.action, r.entity_type,
           r.entity_id, r.org_path, r.payload, r.occurred_at
         ), 'sha256') then
      return r.seq;
    end if;

    expected := r.row_hash;
  end loop;

  return null;
end;
$$;

-- The value to publish externally (another system, a notarised email, a
-- newspaper). Without an outside witness, truncation of the newest rows is
-- undetectable, because a shortened chain is still internally consistent.
create or replace function eworks.audit_head()
returns table (seq bigint, row_hash bytea)
language sql
stable
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select seq, row_hash from eworks.audit_logs order by seq desc limit 1;
$$;

comment on function eworks.verify_audit_chain(bigint) is
  'Returns the first tampered seq, or NULL if the chain verifies. Detects '
  'edits and mid-chain deletions. Cannot detect tail truncation without an '
  'externally witnessed audit_head().';
