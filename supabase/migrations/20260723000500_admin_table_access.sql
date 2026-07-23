-- Make the admin module's tables reachable from the app role.
--
-- eworks.roles, eworks.permissions and eworks.role_permissions had *no* grants
-- to eworks_authenticated and no policies, so GET /api/admin/roles failed with
-- "permission denied for table roles" and the Roles screen has never rendered.
-- eworks.user_profiles had SELECT only, so "Add officer" could never insert.
--
-- These are latent bugs: org_units and user_roles were wired up correctly in
-- 20260709000500_rls.sql and these four were missed.
--
-- Read is open to any authenticated user: roles and permissions are a reference
-- catalogue, and the UI needs the full list to show what a role does *not* have.
-- Write is gated on catalog.manage, matching what admin.mjs already enforces.

-- --- roles / permissions / role_permissions -------------------------------

grant select on eworks.roles, eworks.permissions, eworks.role_permissions
  to eworks_authenticated;
grant insert, update, delete on eworks.roles, eworks.role_permissions
  to eworks_authenticated;

alter table eworks.roles enable row level security;
alter table eworks.permissions enable row level security;
alter table eworks.role_permissions enable row level security;

drop policy if exists roles_read on eworks.roles;
create policy roles_read on eworks.roles
  for select to eworks_authenticated using (true);

drop policy if exists roles_write on eworks.roles;
create policy roles_write on eworks.roles
  for all to eworks_authenticated
  using (eworks.has_permission_anywhere('catalog.manage'))
  with check (eworks.has_permission_anywhere('catalog.manage'));

drop policy if exists permissions_read on eworks.permissions;
create policy permissions_read on eworks.permissions
  for select to eworks_authenticated using (true);

drop policy if exists role_permissions_read on eworks.role_permissions;
create policy role_permissions_read on eworks.role_permissions
  for select to eworks_authenticated using (true);

drop policy if exists role_permissions_write on eworks.role_permissions;
create policy role_permissions_write on eworks.role_permissions
  for all to eworks_authenticated
  using (eworks.has_permission_anywhere('catalog.manage'))
  with check (eworks.has_permission_anywhere('catalog.manage'));

-- --- user_profiles --------------------------------------------------------
-- Creating an officer inserts the profile row. Gated on user.manage, which is
-- the same permission admin.mjs requires before it will call this.
-- NOT scoped by subtree here: a profile has no org column of its own — the
-- scoping lives on user_roles, which already has its own write policy.

grant insert, update on eworks.user_profiles to eworks_authenticated;

drop policy if exists user_profiles_write on eworks.user_profiles;
create policy user_profiles_write on eworks.user_profiles
  for all to eworks_authenticated
  using (eworks.has_permission_anywhere('user.manage'))
  with check (eworks.has_permission_anywhere('user.manage'));
