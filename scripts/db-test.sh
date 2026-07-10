#!/usr/bin/env bash
# Rebuild the local eworks database from migrations and run the verification
# suite.
#
#   bash scripts/db-test.sh
#
# Exits non-zero if any migration or any check fails. DROPS the target database
# on every run -- never point this at anything holding real data, and never at
# Supabase. To verify a Supabase project, use scripts/supabase-verify.sh.
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
DB="${PGDATABASE:-eworks}"

PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -q)

# Which migrations and tests need PostGIS. Everything else runs anywhere.
# Phase 2 builds on the Phase 1 vendor tables, so it needs PostGIS too.
needs_postgis() {
  case "$1" in
    20260709000800_vendors.sql|20260709000900_pricing_integrity.sql) return 0 ;;
    20260709001000_requirement_planner.sql)                          return 0 ;;
    20260709001100_test_orders.sql|20260709001200_sealed_bids.sql)   return 0 ;;
    20260709001300_ground_execution.sql)                             return 0 ;;
    20260709001400_results_certificates_payments.sql)                return 0 ;;
    20260710000100_notifications.sql)                                return 0 ;;
    03_vendors.sql|04_pricing.sql|05_planner_and_orders.sql|06_sealed_bidding.sql|07_ground_execution.sql|08_results_and_payment.sql|09_notifications.sql) return 0 ;;
    *)                                                               return 1 ;;
  esac
}

echo "==> checking for PostGIS"
has_postgis=$("${PSQL[@]}" -d postgres -tAc \
  "select count(*) from pg_available_extensions where name='postgis';" 2>/dev/null || echo 0)

if [ "$has_postgis" -gt 0 ]; then
  echo "    PostGIS available: running the full suite"
else
  cat <<'EOF'
    PostGIS NOT available on this cluster.

    SKIPPING the vendor migration and the whole of Phase 1's tests:
      - 20260709000800_vendors.sql          (vendors, KYC, capabilities)
      - 20260709000900_pricing_integrity.sql (price windows, service catalog)
      - 03_vendors.sql / 04_pricing.sql      (geo-matching, NABL lock, isolation)

    Those guarantees are therefore UNVERIFIED here. Run this against a
    PostGIS-enabled cluster (or scripts/supabase-verify.sh) before believing
    Phase 1 works.
EOF
fi

echo "==> rebuilding $DB"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB;" >/dev/null 2>&1
"${PSQL[@]}" -d postgres -c "create database $DB;" >/dev/null

echo "==> applying migrations"
for f in supabase/migrations/*.sql; do
  base=$(basename "$f")
  if [ "$has_postgis" -eq 0 ] && needs_postgis "$base"; then
    printf '    %-48s%s\n' "$base" 'SKIPPED (no postgis)'
    continue
  fi
  printf '    %-48s' "$base"
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
  echo 'ok'
done

echo "==> loading fixtures"
"${PSQL[@]}" -d "$DB" -f supabase/tests/01_fixtures.sql >/dev/null

total=0
failed=0
for t in supabase/tests/02_*.sql supabase/tests/03_*.sql supabase/tests/04_*.sql supabase/tests/05_*.sql supabase/tests/06_*.sql supabase/tests/07_*.sql supabase/tests/08_*.sql supabase/tests/09_*.sql; do
  base=$(basename "$t")
  [ -f "$t" ] || continue
  if [ "$has_postgis" -eq 0 ] && needs_postgis "$base"; then
    echo "==> $base SKIPPED (no postgis)"
    continue
  fi
  echo "==> $base"
  set +e
  out=$("${PSQL[@]}" -d "$DB" -f "$t" 2>&1)
  rc=$?
  set -e
  echo "$out" | sed 's/^psql:[^ ]*sql:[0-9]*: //; s/^NOTICE:  //' \
    | grep -E '^(pass:|FAIL|ERROR)' || true
  n=$(echo "$out" | grep -c 'pass:' || true)
  total=$((total + n))
  [ $rc -ne 0 ] && failed=1
done

echo
if [ $failed -ne 0 ]; then
  echo "RESULT: FAILED"
  exit 1
fi
if [ "$has_postgis" -eq 0 ]; then
  echo "RESULT: $total checks passed -- PHASES 1-6a NOT VERIFIED (no PostGIS)"
else
  echo "RESULT: $total checks passed (Phases 0-6a)"
fi
