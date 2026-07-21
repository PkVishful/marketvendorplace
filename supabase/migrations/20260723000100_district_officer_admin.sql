-- District officers manage their subtree via Settings (same login as today).
-- Grant user.manage; catalog.manage stays head-admin only at state level.

insert into eworks.role_permissions (role_code, permission_code) values
  ('DISTRICT_OFFICER', 'user.manage')
on conflict do nothing;

delete from eworks.role_permissions
 where role_code = 'DISTRICT_OFFICER'
   and permission_code = 'catalog.manage';

-- Drop "admin" nav tab key from district officer visibility (tools are under Settings).
update eworks.settings
   set value = jsonb_set(
     value,
     '{DISTRICT_OFFICER}',
     coalesce((value->'DISTRICT_OFFICER') - 'admin', '[]'::jsonb)
   )
 where key = 'nav_visibility'
   and value ? 'DISTRICT_OFFICER';

update eworks.settings
   set value = jsonb_set(
     value,
     '{DISTRICT_ADMIN}',
     coalesce((value->'DISTRICT_ADMIN') - 'admin', '[]'::jsonb)
   )
 where key = 'nav_visibility'
   and value ? 'DISTRICT_ADMIN';
