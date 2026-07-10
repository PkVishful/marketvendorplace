-- Extensions required by the E-Works testing marketplace.
--
-- Deliberately plain PostgreSQL: nothing here depends on Supabase-managed
-- schemas. The department may be required to deploy on NIC / State Data Centre
-- infrastructure (see master prompt s0, s14), so Supabase is a deployment
-- target, not a dependency.

create extension if not exists ltree;        -- org_units.path subtree matching
create extension if not exists pgcrypto;     -- gen_random_uuid, digest()

-- PostGIS is NOT created here. It is required only for vendor geo-radius
-- matching (master prompt s11), which arrives with the `vendors` table in a
-- later migration. Creating it before anything uses it would make this
-- migration fail on any cluster without the PostGIS binaries, for no benefit.

-- Everything the module owns lives in `eworks`. Keeping it out of `public`
-- means a leaked anon key that only has `public` grants sees nothing at all.
create schema if not exists eworks;
