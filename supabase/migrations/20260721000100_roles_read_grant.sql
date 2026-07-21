-- Reference role labels are needed for the officers directory (and other UI
-- that maps role_code -> display name). roles is non-sensitive lookup data.

grant select on eworks.roles to eworks_authenticated;

alter table eworks.roles enable row level security;

create policy roles_read on eworks.roles
  for select to eworks_authenticated
  using (true);
