#!/usr/bin/env bash
# Run the verification suite against a Supabase project.
#
#   bash scripts/supabase-verify.sh
#
# This WRITES fixture rows (two districts, five vendors, ten users) and then
# deletes them again. It refuses to run if the project already has org_units,
# because that means it is not a scratch project.
set -euo pipefail

if [ ! -f .env ]; then
  echo "error: .env not found. Copy .env.example to .env first." >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"

PSQL=(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q)

echo "==> safety check"
existing=$("${PSQL[@]}" -tAc "select count(*) from eworks.org_units;")
if [ "$existing" -ne 0 ]; then
  echo "error: eworks.org_units already has $existing rows." >&2
  echo "       This script inserts fixtures and would pollute a live project." >&2
  echo "       Run it only against an empty, freshly-migrated project." >&2
  exit 1
fi

has_postgis=$("${PSQL[@]}" -tAc \
  "select count(*) from pg_extension where extname='postgis';")
if [ "$has_postgis" -eq 0 ]; then
  echo "error: PostGIS is not installed on this project." >&2
  exit 1
fi
echo "    empty project, PostGIS present"

cleanup() {
  echo "==> teardown"
  "${PSQL[@]}" -f supabase/tests/99_teardown.sql >/dev/null 2>&1 || \
    echo "    WARNING: teardown failed; fixture rows may remain" >&2
}
trap cleanup EXIT

echo "==> fixtures"
"${PSQL[@]}" -f supabase/tests/01_fixtures.sql >/dev/null

total=0; failed=0
for t in supabase/tests/02_*.sql supabase/tests/03_*.sql supabase/tests/04_*.sql supabase/tests/05_*.sql supabase/tests/06_*.sql supabase/tests/07_*.sql supabase/tests/08_*.sql; do
  echo "==> $(basename "$t")"
  set +e
  out=$("${PSQL[@]}" -f "$t" 2>&1); rc=$?
  set -e
  echo "$out" | sed 's/^psql:[^ ]*sql:[0-9]*: //; s/^NOTICE:  //' \
    | grep -E '^(pass:|FAIL|ERROR)' || true
  total=$((total + $(echo "$out" | grep -c 'pass:' || true)))
  [ $rc -ne 0 ] && failed=1
done

echo
if [ $failed -ne 0 ]; then echo "RESULT: FAILED"; exit 1; fi
echo "RESULT: $total checks passed against Supabase"
