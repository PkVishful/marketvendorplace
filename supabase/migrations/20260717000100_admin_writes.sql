-- Part B admin module: user creation, role/permission editing, settings writes.
-- roles_read may already exist from 20260721000100_roles_read_grant.sql.

grant insert on eworks.user_profiles to eworks_authenticated;

drop policy if exists user_profiles_admin_create on eworks.user_profiles;
create policy user_profiles_admin_create on eworks.user_profiles
  for insert to eworks_authenticated
  with check (eworks.has_permission_anywhere('user.manage'));

alter table eworks.permissions      enable row level security;
alter table eworks.role_permissions enable row level security;

grant select on eworks.permissions, eworks.role_permissions to eworks_authenticated;
grant insert, update on eworks.roles to eworks_authenticated;
grant insert, delete on eworks.role_permissions to eworks_authenticated;

drop policy if exists permissions_read on eworks.permissions;
create policy permissions_read on eworks.permissions
  for select to eworks_authenticated
  using (eworks.current_user_id() is not null);

drop policy if exists role_permissions_read on eworks.role_permissions;
create policy role_permissions_read on eworks.role_permissions
  for select to eworks_authenticated
  using (eworks.current_user_id() is not null);

drop policy if exists roles_admin_write on eworks.roles;
create policy roles_admin_write on eworks.roles
  for all to eworks_authenticated
  using (eworks.has_permission_anywhere('user.manage'))
  with check (eworks.has_permission_anywhere('user.manage'));

drop policy if exists role_permissions_admin_write on eworks.role_permissions;
create policy role_permissions_admin_write on eworks.role_permissions
  for all to eworks_authenticated
  using (eworks.has_permission_anywhere('user.manage'))
  with check (eworks.has_permission_anywhere('user.manage'));

grant insert, update on eworks.settings to eworks_authenticated;

drop policy if exists settings_admin_write on eworks.settings;
create policy settings_admin_write on eworks.settings
  for all to eworks_authenticated
  using (eworks.has_permission_anywhere('user.manage'))
  with check (eworks.has_permission_anywhere('user.manage'));
