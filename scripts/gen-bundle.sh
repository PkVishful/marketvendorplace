#!/usr/bin/env bash
# Concatenate the migrations into one file you can paste into the Supabase SQL
# editor. Generated -- never edit the bundle, edit the migrations and re-run.
set -euo pipefail

OUT="supabase/bundle/eworks_full_schema.sql"
mkdir -p "$(dirname "$OUT")"

{
cat <<'HEADER'
-- ===========================================================================
-- E-Works Testing Marketplace -- full schema (Phase 0 + Phase 1)
--
-- GENERATED FILE. Do not edit. Regenerate with: bash scripts/gen-bundle.sh
--
-- To apply: paste into the Supabase SQL editor and run once, on a project with
-- NO existing `eworks` schema. It is not idempotent -- re-running against an
-- already-migrated database will fail on `create type` / `create table`.
--
-- Before you run this, two things worth knowing:
--
-- 1. Hosted Supabase is NOT MeitY-empanelled. The master prompt (s0, s14)
--    requires government data to sit on approved infrastructure. Use this for
--    development and staging. Production needs the residency decision first.
--    Nothing here depends on Supabase-managed schemas, so a NIC / State Data
--    Centre PostgreSQL will take the same migrations unchanged.
--
-- 2. The `service_role` key BYPASSES row-level security completely. Every
--    policy below becomes decorative on a connection using it. Use the anon
--    key plus a real user JWT, or a dedicated pooled connection that sets
--    `app.user_id`.
--
-- Identity resolution: eworks.current_user_id() reads `app.user_id` (a GUC any
-- BFF can set) and falls back to `request.jwt.claims ->> 'sub'` (what Supabase
-- sets via PostgREST). So Supabase Auth works out of the box: `sub` must be the
-- eworks.user_profiles.id of the caller.
-- ===========================================================================

HEADER

for f in supabase/migrations/*.sql; do
  echo ""
  echo "-- ==========================================================================="
  echo "-- $(basename "$f")"
  echo "-- ==========================================================================="
  cat "$f"
  echo ""
done

cat <<'FOOTER'

-- ===========================================================================
-- OPTIONAL: wire Supabase's built-in `authenticated` role into these policies.
--
-- Every policy above targets `eworks_authenticated`. If you intend to query
-- through PostgREST with a Supabase user JWT, the connection arrives as the
-- `authenticated` role instead. Granting membership makes the policies apply.
--
-- Left commented because it widens who can reach these tables -- read it, then
-- decide.
-- ===========================================================================
-- grant eworks_authenticated to authenticated;
-- grant usage on schema eworks to authenticated;
FOOTER
} > "$OUT"

lines=$(wc -l < "$OUT")
echo "wrote $OUT ($lines lines)"
