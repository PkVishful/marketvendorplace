-- District-scoped admin role (addendum §1) + default nav visibility matrix (§5).

insert into eworks.roles (code, name, description) values
  ('DISTRICT_ADMIN', 'District admin',
   'Manages users, vendor onboarding, and tab visibility within an org subtree.')
on conflict (code) do nothing;

insert into eworks.role_permissions (role_code, permission_code) values
  ('DISTRICT_ADMIN', 'user.read'),
  ('DISTRICT_ADMIN', 'user.manage'),
  ('DISTRICT_ADMIN', 'vendor.read'),
  ('DISTRICT_ADMIN', 'vendor.approve'),
  ('DISTRICT_ADMIN', 'audit.read')
on conflict do nothing;

insert into eworks.settings (key, value) values
  ('nav_visibility', '{
    "SITE_ENGINEER": ["dashboard","planner","orders","vendors","quality","ratings","analytics"],
    "EXECUTIVE_ENGINEER": ["dashboard","planner","orders","vendors","quality","ratings","analytics"],
    "DISTRICT_OFFICER": ["dashboard","planner","orders","vendors","officers","quality","ratings","analytics","audit"],
    "DISTRICT_ADMIN": ["dashboard","planner","orders","vendors","officers","quality","ratings","analytics","audit"],
    "HEAD_ADMIN": ["dashboard","planner","orders","vendors","officers","quality","ratings","analytics","audit","admin"],
    "AUDITOR": ["dashboard","officers","vendors","quality","audit"],
    "SUPERINTENDING_ENGINEER": ["dashboard","planner","orders","vendors","quality","ratings","analytics"]
  }'::jsonb)
on conflict (key) do nothing;
