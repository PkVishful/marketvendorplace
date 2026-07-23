-- Add the Getting Started tab to the roles that can act on its checklist.
--
-- Every task on that page links into an admin screen (org profile, users,
-- roles, tab visibility), so it is offered only to roles that hold user.manage
-- — showing it to a site engineer would be a page of buttons they cannot use.
-- Merge, never overwrite, so operator edits survive a re-run.

do $$
declare
  role_key text;
  existing jsonb;
begin
  foreach role_key in array array['HEAD_ADMIN', 'DISTRICT_ADMIN', 'DISTRICT_OFFICER'] loop
    select coalesce(value -> role_key, '[]'::jsonb) into existing
      from eworks.settings where key = 'nav_visibility';

    if existing is not null and not (existing ? 'gettingStarted') then
      update eworks.settings
         set value = jsonb_set(value, array[role_key], existing || '["gettingStarted"]'::jsonb)
       where key = 'nav_visibility';
    end if;
  end loop;
end $$;
