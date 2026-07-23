-- Password reset tokens.
--
-- Only the HMAC of the token is stored. A leaked database therefore does not
-- yield working reset links, for the same reason user_profiles keeps a
-- password_hash rather than a password.
--
-- Rows are kept after use rather than deleted: used_at is what makes a token
-- single-use, and it is also the audit trail for "who reset this account".

create table if not exists eworks.password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references eworks.user_profiles(id) on delete cascade,
  -- HMAC-SHA256 hex of the token. Unique so a hash collision cannot silently
  -- shadow another user's token.
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  requested_ip text
);

create index if not exists password_reset_tokens_user_idx
  on eworks.password_reset_tokens (user_id, created_at desc);

-- Lookup on redeem is by hash alone, and must not scan.
create index if not exists password_reset_tokens_hash_idx
  on eworks.password_reset_tokens (token_hash);

comment on table eworks.password_reset_tokens is
  'Single-use password reset tokens, stored as HMAC only. used_at marks redemption.';

-- The reset routes run before there is a session, so they use the pooled
-- superuser connection rather than withUserSession. No grant to
-- eworks_authenticated: nothing an authenticated user does should read or
-- write these rows.
alter table eworks.password_reset_tokens enable row level security;
