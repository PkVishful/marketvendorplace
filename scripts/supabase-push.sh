#!/usr/bin/env bash
# Apply the migrations to a Supabase project.
#
#   bash scripts/supabase-push.sh
#
# Reads SUPABASE_DB_URL from .env. Does NOT drop anything. Applies each
# migration in order inside a single transaction: either the whole schema
# lands, or none of it does.
set -euo pipefail

if [ ! -f .env ]; then
  echo "error: .env not found. Copy .env.example to .env and fill in SUPABASE_DB_URL." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

if [ -z "${SUPABASE_DB_URL:-}" ] || [[ "$SUPABASE_DB_URL" == *"[YOUR-PASSWORD]"* ]]; then
  echo "error: SUPABASE_DB_URL is unset or still contains the placeholder password." >&2
  exit 1
fi

if [[ "$SUPABASE_DB_URL" == *":6543/"* ]]; then
  echo "error: that is the transaction pooler (port 6543). DDL and advisory locks" >&2
  echo "       need the session pooler or a direct connection (port 5432)." >&2
  exit 1
fi

echo "==> target: $(echo "$SUPABASE_DB_URL" | sed -E 's#//[^:]+:[^@]+@#//***:***@#')"

# Refuse to run twice. `create type` is not idempotent and a partial re-apply
# leaves the schema in a state neither migration nor rollback expects.
existing=$(psql "$SUPABASE_DB_URL" -tAc \
  "select count(*) from information_schema.schemata where schema_name='eworks';")
if [ "$existing" -ne 0 ]; then
  echo "error: schema 'eworks' already exists on this project." >&2
  echo "       These migrations are not idempotent. Drop it first if this is a" >&2
  echo "       scratch project:  drop schema eworks cascade;" >&2
  exit 1
fi

echo "==> applying migrations in one transaction"
{
  echo "begin;"
  for f in supabase/migrations/*.sql; do
    echo "\\echo '--> $(basename "$f")'"
    cat "$f"
  done
  echo "commit;"
} | psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q

echo
echo "==> done. Verify with: bash scripts/supabase-verify.sh"
