-- Area drill-down: nav defaults (build spec §3).
--
-- Adds the 'area' tab to every gov role's default visibility, and gives each
-- role the tab set from the spec's matrix. Two deliberate choices:
--
--   1. Tabs the matrix does not name keep whatever visibility they have today.
--      'ratings' is the live example: it ships to six roles and the matrix
--      simply omits it, which is not the same as asking for it to be removed.
--
--   2. Merge, never overwrite. An operator may already have edited these via
--      the admin tab-visibility screen; `||` on the existing array preserves
--      that, and re-running the migration is a no-op rather than a reset.
--
-- Permissions remain the real gate — this only decides what is offered.

do $$
declare
  defaults jsonb := '{
    "HEAD_ADMIN":              ["area","orders","vendors","quality","analytics","audit","admin","checklist"],
    "DISTRICT_ADMIN":          ["area","planner","orders","vendors","officers","quality","analytics","checklist"],
    "DISTRICT_OFFICER":        ["area","planner","orders","vendors","officers","quality","analytics","checklist"],
    "EXECUTIVE_ENGINEER":      ["area","planner","orders","vendors","quality","analytics","checklist"],
    "SUPERINTENDING_ENGINEER": ["area","planner","orders","vendors","quality","analytics","checklist"],
    "SITE_ENGINEER":           ["area","planner","orders","quality","checklist"],
    "AUDITOR":                 ["area","orders","vendors","quality","analytics","audit","checklist"]
  }'::jsonb;
  role_key text;
  existing jsonb;
  merged jsonb;
begin
  -- The row may not exist yet: a database provisioned before the admin build
  -- has no nav_visibility key, and an UPDATE against it would silently seed
  -- nothing at all. Create it empty first so the merge below always lands.
  insert into eworks.settings (key, value)
  values ('nav_visibility', '{}'::jsonb)
  on conflict (key) do nothing;

  for role_key in select jsonb_object_keys(defaults) loop
    -- Union of what the role has now and what the matrix asks for, so neither
    -- an operator edit nor a matrix entry is lost.
    select coalesce(value -> role_key, '[]'::jsonb) into existing
      from eworks.settings where key = 'nav_visibility';

    select jsonb_agg(distinct tab) into merged
      from (
        select jsonb_array_elements_text(existing) as tab
        union
        select jsonb_array_elements_text(defaults -> role_key)
      ) t;

    update eworks.settings
       set value = jsonb_set(value, array[role_key], coalesce(merged, '[]'::jsonb))
     where key = 'nav_visibility';
  end loop;
end $$;
