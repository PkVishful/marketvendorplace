-- Row-Level Security (master prompt s0, s9, s14).
--
-- "Authorization is enforced in the database, not only in the app -- a leaked
-- key must not read outside its scope."
--
-- Design rules followed here:
--   1. Every policy denies by default. eworks.current_user_id() returns NULL
--      for an unauthenticated connection and NULL never satisfies `<@`.
--   2. No policy trusts a column supplied by the client to decide scope. Scope
--      always resolves through user_roles -> org_units.path.
--   3. Read and write are separate policies. Seeing a floated order must never
--      imply being able to modify it.

-- The role the BFF connects as. It is NOT the table owner, so RLS applies to
-- it without needing FORCE. Never hand this role to a browser.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'eworks_authenticated') then
    create role eworks_authenticated nologin;
  end if;

  -- The migration runner must be able to SET ROLE into it -- that is how the
  -- BFF drops privilege for a request, and how the test suite impersonates a
  -- user.
  --
  -- A superuser can SET ROLE to anything, so this is a no-op locally. On
  -- Supabase, `postgres` is NOT a superuser -- it holds CREATEROLE.
  --
  -- PostgreSQL 16 split role membership into ADMIN / INHERIT / SET. Creating a
  -- role grants ADMIN but NOT SET, so `pg_has_role(..., 'MEMBER')` reports true
  -- while `SET ROLE` still fails with "permission denied to set role". The SET
  -- option has to be granted explicitly, and `WITH SET TRUE` does not parse
  -- before PG16 -- hence the version test rather than an exception handler,
  -- which would silently swallow a real failure.
  if not (select usesuper from pg_user where usename = current_user) then
    if current_setting('server_version_num')::int >= 160000 then
      execute format('grant eworks_authenticated to %I with set true', current_user);
    elsif not pg_has_role(current_user, 'eworks_authenticated', 'MEMBER') then
      execute format('grant eworks_authenticated to %I', current_user);
    end if;
  end if;
end
$$;

grant usage on schema eworks to eworks_authenticated;

-- Supabase installs extensions into a schema called `extensions`; a plain
-- cluster puts them in `public`. Any SECURITY INVOKER function that calls
-- digest() or st_distance() runs as the caller, so the caller needs USAGE on
-- wherever those live -- otherwise it fails with the thoroughly misleading
-- "function digest(bytea, unknown) does not exist".
--
-- SECURITY DEFINER functions hide this bug, because they run as the owner. It
-- only surfaces on the invoker-rights paths, i.e. eworks.bid_commitment().
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    grant usage on schema extensions to eworks_authenticated;
  end if;
end
$$;

-- Some permissions are global rather than anchored to a subtree (managing the
-- IS-code test catalog, for instance). Kept separate from has_permission() so
-- that the scoped check is never accidentally weakened into a global one.
create or replace function eworks.has_permission_anywhere(perm text)
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
      join eworks.role_permissions rp on rp.role_code = ur.role_code
     where ur.user_id = eworks.current_user_id()
       and rp.permission_code = perm
       and (ur.expires_at is null or ur.expires_at > now())
  );
$$;


-- ---------------------------------------------------------------------------
-- org_units
-- ---------------------------------------------------------------------------
alter table eworks.org_units enable row level security;
-- DML is granted so that RLS -- not a missing GRANT -- is what refuses an
-- unauthorized write. A policy that is never reached because the role lacks
-- the table privilege is a policy nobody has tested.
grant select, insert, update, delete on eworks.org_units to eworks_authenticated;

-- A user sees their own subtree. They also see the ancestors of their subtree,
-- because a Section engineer must be able to render "TN > Coimbatore >
-- Division 2 > ..." as a breadcrumb. Ancestors leak only a unit's name and
-- code, never any record belonging to it.
create policy org_units_read on eworks.org_units
  for select to eworks_authenticated
  using (
    eworks.in_scope(path)
    or exists (
      select 1 from eworks.current_scopes() as scope
       where scope <@ org_units.path
    )
  );

create policy org_units_write on eworks.org_units
  for all to eworks_authenticated
  using (eworks.has_permission('org.manage', path))
  with check (eworks.has_permission('org.manage', path));


-- ---------------------------------------------------------------------------
-- user_profiles
-- ---------------------------------------------------------------------------
alter table eworks.user_profiles enable row level security;
grant select on eworks.user_profiles to eworks_authenticated;

-- You can always read yourself. Otherwise you may read a user only if you hold
-- `user.read` at a unit that dominates a unit where that user holds a role.
-- A Coimbatore officer therefore cannot enumerate Salem's staff.
create policy user_profiles_read on eworks.user_profiles
  for select to eworks_authenticated
  using (
    id = eworks.current_user_id()
    or exists (
      select 1
        from eworks.user_roles target_ur
        join eworks.org_units target_ou on target_ou.id = target_ur.org_unit_id
       where target_ur.user_id = user_profiles.id
         and eworks.has_permission('user.read', target_ou.path)
    )
  );


-- ---------------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------------
alter table eworks.user_roles enable row level security;
grant select, insert, update, delete on eworks.user_roles to eworks_authenticated;

create policy user_roles_read on eworks.user_roles
  for select to eworks_authenticated
  using (
    user_id = eworks.current_user_id()
    or exists (
      select 1 from eworks.org_units ou
       where ou.id = user_roles.org_unit_id
         and eworks.has_permission('user.read', ou.path)
    )
  );

-- Granting a role requires `user.manage` at the unit being granted at. This is
-- the privilege-escalation boundary: without the subtree check, any officer
-- holding user.manage anywhere could grant themselves a State-level role.
create policy user_roles_write on eworks.user_roles
  for all to eworks_authenticated
  using (
    exists (select 1 from eworks.org_units ou
             where ou.id = user_roles.org_unit_id
               and eworks.has_permission('user.manage', ou.path))
  )
  with check (
    exists (select 1 from eworks.org_units ou
             where ou.id = user_roles.org_unit_id
               and eworks.has_permission('user.manage', ou.path))
  );


-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
alter table eworks.audit_logs enable row level security;
grant select, insert on eworks.audit_logs to eworks_authenticated;

-- Auditors read their assigned scope (s3). Rows with a NULL org_path are
-- system-level events and are visible only to holders of `audit.read_all`.
create policy audit_logs_read on eworks.audit_logs
  for select to eworks_authenticated
  using (
    eworks.has_permission_anywhere('audit.read_all')
    or (org_path is not null
        and eworks.in_scope(org_path)
        and eworks.has_permission('audit.read', org_path))
  );

-- Anyone authenticated may append; nobody may update or delete (enforced by
-- trigger, and by withholding the UPDATE/DELETE grants above).
create policy audit_logs_append on eworks.audit_logs
  for insert to eworks_authenticated
  with check (true);
