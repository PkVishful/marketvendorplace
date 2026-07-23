-- Let admins actually save settings.
--
-- eworks_authenticated held SELECT on eworks.settings and nothing else, and the
-- only policy was settings_read. Every write through PUT /api/admin/settings/:key
-- therefore failed with "permission denied for table settings" — the admin tab
-- visibility screen has never been able to save, and neither could the new
-- organisation profile. This is a latent bug, not a new requirement.
--
-- Layering, deliberately:
--   RLS  — coarse: you must hold an admin permission somewhere to write at all.
--   BFF  — fine:  global keys require catalog.manage; a district's nav key
--          requires user.manage *at that district*. RLS cannot express the
--          per-key scoping because the scope is encoded in the key text, so the
--          route keeps that check (admin.mjs) and this policy is the backstop.

grant insert, update on eworks.settings to eworks_authenticated;

drop policy if exists settings_write on eworks.settings;
create policy settings_write on eworks.settings
  for all
  to eworks_authenticated
  using (
    eworks.has_permission_anywhere('catalog.manage')
    or eworks.has_permission_anywhere('user.manage')
  )
  with check (
    eworks.has_permission_anywhere('catalog.manage')
    or eworks.has_permission_anywhere('user.manage')
  );

comment on policy settings_write on eworks.settings is
  'Coarse gate: any admin permission allows writing settings. Per-key scoping '
  '(global vs district nav) is enforced by the BFF, which knows the key format.';
