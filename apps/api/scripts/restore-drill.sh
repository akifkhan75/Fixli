#!/usr/bin/env bash
# Restore drill (doc 27 F8.2): proves a backup can really be restored, and the app runs on the copy.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/fixli  ./scripts/restore-drill.sh
#
# What it does, in order (it never touches the source database except to read it):
#   1. dumps the database (custom format, like a nightly backup)
#   2. creates a fresh scratch database and restores the dump into it
#   3. compares row counts of every table, source vs restored
#   4. checks the migration history matches (`prisma migrate status`)
#   5. starts the API against the restored copy and asks /api/health/ready
# Prints PASS or FAIL and the time each step took, so the real "how long to restore" is written down.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the database to back up}"
PG_BIN="${PG_BIN:-}"            # e.g. /opt/homebrew/opt/postgresql@14/bin (blank = use PATH)
P() { if [ -n "$PG_BIN" ]; then echo "$PG_BIN/$1"; else echo "$1"; fi; }
cd "$(dirname "$0")/.."

SRC="${DATABASE_URL%%\?*}"                       # without ?schema=public
SCRATCH_NAME="fixli_restore_drill_$(date +%s)"
ADMIN_URL="${SRC%/*}/postgres"                    # same server, the default database
SCRATCH="${SRC%/*}/$SCRATCH_NAME"
DUMP="$(mktemp -t fixli-drill.XXXXXX)"
API_LOG="$(mktemp -t fixli-drill-api.XXXXXX)"
API_PID=""
t0=$(date +%s)
step() { echo; echo "== $1"; }
took() { echo "   ($(( $(date +%s) - t0 )) s so far)"; }
cleanup() {
  if [ -n "$API_PID" ]; then kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true; fi
  "$(P psql)" "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$SCRATCH_NAME\"" >/dev/null 2>&1 || true
  rm -f "$DUMP" "$API_LOG"
}
trap cleanup EXIT
fail() { echo; echo "FAIL: $1"; exit 1; }

step "1. Dump $SRC"
"$(P pg_dump)" --format=custom --no-owner --no-privileges --file "$DUMP" "$SRC"
echo "   dump size: $(du -h "$DUMP" | cut -f1)"; took

step "2. Restore into a fresh database ($SCRATCH_NAME)"
"$(P psql)" "$ADMIN_URL" -qc "CREATE DATABASE \"$SCRATCH_NAME\""
"$(P pg_restore)" --no-owner --no-privileges --exit-on-error --dbname "$SCRATCH" "$DUMP"
took

step "3. Row counts, source vs restored"
count_sql="SELECT format('%I.%I', schemaname, relname) || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, relname), false, true, '')))[1]::text FROM pg_stat_user_tables ORDER BY 1"
a="$("$(P psql)" "$SRC" -Atc "$count_sql")"
b="$("$(P psql)" "$SCRATCH" -Atc "$count_sql")"
[ "$a" = "$b" ] || { diff <(echo "$a") <(echo "$b") || true; fail "row counts differ after the restore"; }
echo "   $(echo "$a" | wc -l | tr -d ' ') tables, $(echo "$a" | awk -F= '{s+=$2} END {print s}') rows: identical"; took

step "4. Migration history on the restored copy"
status="$(DATABASE_URL="$SCRATCH?schema=public" npx prisma migrate status 2>&1 || true)"
echo "$status" | tail -3
echo "$status" | grep -q "Database schema is up to date" || fail "migration history does not match the code"; took

step "5. The API runs on the restored copy"
PORT=3399
[ -f dist/main.js ] || fail "build the API first (pnpm --filter @fixli/api build)"
DATABASE_URL="$SCRATCH?schema=public" PORT=$PORT NODE_ENV=development RUN_BACKGROUND_JOBS=false \
  JWT_SECRET="${JWT_SECRET:-drill-secret-drill-secret-drill-secret-drill}" node dist/main >"$API_LOG" 2>&1 &
API_PID=$!
ok=""
for _ in $(seq 1 40); do
  if body="$(curl -sf "http://127.0.0.1:$PORT/api/health/ready")"; then ok=1; break; fi
  sleep 1
done
[ -n "$ok" ] || { tail -20 "$API_LOG"; fail "the API did not become ready on the restored database"; }
echo "   $body"
echo "$body" | grep -q '"database":{"ok":true}' || fail "readiness says the database is not ok"; took

echo; echo "PASS: restored in $(( $(date +%s) - t0 )) s total (dump, restore, verify, boot)."
