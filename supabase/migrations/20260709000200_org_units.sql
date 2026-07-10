-- Organisation hierarchy (master prompt s4).
--
--   State -> District -> Division -> Circle -> Subdivision -> Section
--         -> Field Unit -> Project
--
-- One table, materialized ltree path, GiST index. Authorization delegates
-- downward: a role held at unit U applies to U's whole subtree. That subtree
-- test is the single hottest predicate in the system -- every RLS policy in
-- this module ends in an `<@` against a path from this table.

create type eworks.org_level as enum (
  'STATE',
  'DISTRICT',
  'DIVISION',
  'CIRCLE',
  'SUBDIVISION',
  'SECTION',
  'FIELD_UNIT',
  'PROJECT'
);

-- Ordinal position of a level, 1-based, derived from the enum's own
-- declaration order. Adding a level to the enum must not require editing this.
create or replace function eworks.org_level_ordinal(lvl eworks.org_level)
returns int
language sql
immutable
parallel safe
as $$
  select array_position(enum_range(null::eworks.org_level), lvl);
$$;

create table eworks.org_units (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references eworks.org_units(id) on delete restrict,
  level       eworks.org_level not null,
  -- `code` becomes one ltree label, so it is restricted to what ltree accepts
  -- as a label. Enforced by check, not by convention.
  code        text not null check (code ~ '^[A-Za-z0-9_]+$'),
  name        text not null check (length(trim(name)) > 0),
  path        ltree not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- No orphans: exactly the STATE level is allowed to have no parent.
  constraint org_units_root_iff_state
    check ((parent_id is null) = (level = 'STATE')),

  -- Sibling codes must be unique, otherwise two siblings collide into the
  -- same ltree path.
  constraint org_units_sibling_code_unique unique (parent_id, code)
);

-- A path identifies exactly one unit. This is what makes `<@` safe to trust.
create unique index org_units_path_key on eworks.org_units (path);

-- The subtree index. Master prompt s11 lists this under org-subtree RLS.
create index org_units_path_gist on eworks.org_units using gist (path);
create index org_units_parent_idx on eworks.org_units (parent_id);
create index org_units_level_idx on eworks.org_units (level);

-- Maintains `path`, enforces strict level descent, and rejects cycles.
--
-- Level descent is strict (child = parent + 1) per s4 "strict FK + level
-- validation". A Division cannot hang directly off a State even though that
-- might be administratively convenient; if the department needs skip-level
-- units, that is a schema change and an explicit decision, not an accident.
create or replace function eworks.org_units_maintain_path()
returns trigger
language plpgsql
as $$
declare
  parent_path  ltree;
  parent_level eworks.org_level;
begin
  if new.parent_id is null then
    new.path := new.code::ltree;
  else
    select path, level into parent_path, parent_level
      from eworks.org_units
     where id = new.parent_id;

    if parent_path is null then
      raise exception 'parent org_unit % does not exist', new.parent_id;
    end if;

    if eworks.org_level_ordinal(new.level)
       <> eworks.org_level_ordinal(parent_level) + 1 then
      raise exception
        'invalid hierarchy: % cannot be a child of % (levels must descend by exactly one)',
        new.level, parent_level;
    end if;

    -- A node may not be reparented beneath itself or its own descendants.
    if tg_op = 'UPDATE' and parent_path <@ old.path then
      raise exception 'cycle: cannot reparent % beneath its own subtree', old.path;
    end if;

    new.path := parent_path || new.code::ltree;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger org_units_maintain_path_trg
  before insert or update of parent_id, code, level
  on eworks.org_units
  for each row execute function eworks.org_units_maintain_path();

-- When a unit moves or is renamed, every descendant's materialized path must
-- move with it. Without this the paths silently desynchronise and RLS starts
-- granting access against a stale tree -- a security bug, not a data bug.
-- The guard matters: the cascading UPDATE below re-fires this same trigger on
-- every descendant it touches. Those rows already carry corrected paths, so a
-- second pass would rebase them against paths that no longer exist and corrupt
-- the tree. The flag is transaction-local (set_config(..., is_local => true)),
-- so it unwinds on commit or rollback without cleanup.
create or replace function eworks.org_units_cascade_path()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('eworks.path_cascade_active', true), 'off') = 'on' then
    return null;
  end if;

  perform set_config('eworks.path_cascade_active', 'on', true);

  update eworks.org_units
     set path = new.path || subpath(path, nlevel(old.path))
   where path <@ old.path
     and id <> new.id;

  perform set_config('eworks.path_cascade_active', 'off', true);
  return null;
end;
$$;

-- Fires on ANY update, gated by the WHEN clause.
--
-- `AFTER UPDATE OF path` would be wrong: `UPDATE ... OF col` fires only when
-- `col` appears in the SET list. A rename sets `code`, and the BEFORE trigger
-- derives the new `path` from it -- so an `OF path` trigger never fires and
-- every descendant silently keeps a stale path. RLS then evaluates subtree
-- containment against a tree that no longer exists.
create trigger org_units_cascade_path_trg
  after update on eworks.org_units
  for each row
  when (new.path is distinct from old.path)
  execute function eworks.org_units_cascade_path();

comment on table eworks.org_units is
  'Org hierarchy with materialized ltree path. Subtree containment (<@) is the '
  'basis of every RLS policy in this module.';
