-- Tender & Budget oversight: nav defaults (build spec §5).
-- Adds the 'oversight' tab to the default visibility for the roles the spec
-- names. Merge, never overwrite, so admin-screen edits and re-runs are safe.
-- Permissions (order.read) remain the real gate.
do $$
declare
  defaults jsonb := '{
    "HEAD_ADMIN":       ["oversight"],
    "DISTRICT_ADMIN":   ["oversight"],
    "DISTRICT_OFFICER": ["oversight"],
    "AUDITOR":          ["oversight"]
  }'::jsonb;
  role_key text;
  existing jsonb;
  merged jsonb;
begin
  insert into eworks.settings (key, value)
  values ('nav_visibility', '{}'::jsonb)
  on conflict (key) do nothing;

  for role_key in select jsonb_object_keys(defaults) loop
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
