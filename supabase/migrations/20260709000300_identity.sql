-- Identity, roles, permissions, and the scope-resolution helpers that every
-- RLS policy in this module calls (master prompt s3, s6).

create table eworks.user_profiles (
  id          uuid primary key default gen_random_uuid(),
  -- Phone is the login identifier (s3: mobile + OTP). It is PII; s2 requires
  -- PII columns encrypted via Vault/KMS. Stored plaintext here and tracked as
  -- a known gap -- see docs/security-gaps.md. Encrypting it needs the KMS
  -- decision that is blocked on the data-residency call.
  phone       text not null unique check (phone ~ '^[6-9][0-9]{9}$'),
  full_name   text not null check (length(trim(full_name)) > 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table eworks.roles (
  code        text primary key check (code ~ '^[A-Z_]+$'),
  name        text not null,
  description text
);

create table eworks.permissions (
  code        text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  description text not null
);

create table eworks.role_permissions (
  role_code       text not null references eworks.roles(code) on delete cascade,
  permission_code text not null references eworks.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

-- A role grant is always anchored at an org unit. The grant covers that unit's
-- entire subtree. A District Officer granted at TN.COIMBATORE can never see
-- TN.SALEM, because SALEM is not under COIMBATORE -- and that is enforced by
-- ltree containment in the database, not by a WHERE clause in the API.
create table eworks.user_roles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references eworks.user_profiles(id) on delete cascade,
  role_code    text not null references eworks.roles(code) on delete restrict,
  org_unit_id  uuid not null references eworks.org_units(id) on delete restrict,
  granted_at   timestamptz not null default now(),
  granted_by   uuid references eworks.user_profiles(id),
  expires_at   timestamptz,
  constraint user_roles_unique unique (user_id, role_code, org_unit_id)
);

create index user_roles_user_idx on eworks.user_roles (user_id);
create index user_roles_org_idx on eworks.user_roles (org_unit_id);


-- ---------------------------------------------------------------------------
-- Scope resolution
-- ---------------------------------------------------------------------------

-- Who is calling. Two sources, in priority order:
--   1. `app.user_id`          -- set by the BFF on a pooled connection
--   2. `request.jwt.claims`   -- set by PostgREST/Supabase from the JWT
-- Supporting both is what keeps this schema portable to a self-hosted NIC
-- deployment where PostgREST may not be in the path.
--
-- Returns NULL for an unauthenticated connection. Every policy below is
-- written so that NULL denies rather than grants.
create or replace function eworks.current_user_id()
returns uuid
language plpgsql
stable
parallel safe
security invoker
set search_path = eworks, public, extensions, pg_temp
as $$
declare
  raw_id text;
  claims text;
begin
  raw_id := nullif(current_setting('app.user_id', true), '');
  if raw_id is not null then
    return raw_id::uuid;
  end if;

  claims := nullif(current_setting('request.jwt.claims', true), '');
  if claims is not null then
    return nullif(claims::jsonb ->> 'sub', '')::uuid;
  end if;

  return null;
exception
  when invalid_text_representation then
    -- A malformed claim is an attack signal, not a reason to fall back to a
    -- permissive default.
    return null;
end;
$$;

-- Every org path the current user holds any active role at.
create or replace function eworks.current_scopes()
returns setof ltree
language sql
stable
parallel safe
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select ou.path
    from eworks.user_roles ur
    join eworks.org_units ou on ou.id = ur.org_unit_id
   where ur.user_id = eworks.current_user_id()
     and (ur.expires_at is null or ur.expires_at > now())
     and ou.is_active;
$$;

-- Is `target` inside any subtree the user holds a role at?
--
-- `target <@ scope` is an index-assisted containment test against
-- org_units_path_gist. This function is called once per row by RLS, so it is
-- STABLE and PARALLEL SAFE to let the planner cache and distribute it.
create or replace function eworks.in_scope(target ltree)
returns boolean
language sql
stable
parallel safe
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select exists (
    select 1
      from eworks.current_scopes() as scope
     where target <@ scope
  );
$$;

-- Does the user hold `perm` at a unit whose subtree contains `target`?
--
-- Note this is stricter than `in_scope() and has_role_anywhere(perm)`: the
-- permission must be held at a unit that actually dominates the target. A
-- Section-level engineer with `order.float` cannot float an order for a
-- different Section merely because they hold the permission somewhere.
create or replace function eworks.has_permission(perm text, target ltree)
returns boolean
language sql
stable
parallel safe
security definer
set search_path = eworks, public, extensions, pg_temp
as $$
  select exists (
    select 1
      from eworks.user_roles ur
      join eworks.org_units ou on ou.id = ur.org_unit_id
      join eworks.role_permissions rp on rp.role_code = ur.role_code
     where ur.user_id = eworks.current_user_id()
       and rp.permission_code = perm
       and (ur.expires_at is null or ur.expires_at > now())
       and ou.is_active
       and target <@ ou.path
  );
$$;

comment on function eworks.in_scope(ltree) is
  'True when target path lies within any org subtree the caller holds a role at. '
  'NULL caller (unauthenticated) yields false.';
