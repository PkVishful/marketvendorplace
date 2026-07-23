-- Email + password sign-in.
--
-- Adds the credential columns alongside `phone` rather than replacing it. The
-- phone column stays because it is still how field staff are identified in
-- notifications and check-ins; only the *authentication* path moves to email.
--
-- password_hash holds a self-describing scrypt string
-- (scrypt$N$r$p$salt$hash) so the cost parameters can be raised later without
-- a flag day: an old row still verifies at its recorded cost.

alter table eworks.user_profiles
  add column if not exists email text,
  add column if not exists password_hash text;

-- Case-insensitive uniqueness: nobody gets to register Admin@… next to admin@….
create unique index if not exists user_profiles_email_lower_key
  on eworks.user_profiles (lower(email))
  where email is not null;

comment on column eworks.user_profiles.email is
  'Sign-in identity. Compared case-insensitively; store as entered.';
comment on column eworks.user_profiles.password_hash is
  'scrypt$N$r$p$salt$hash. Never a plaintext or unsalted digest.';
