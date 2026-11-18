#!/usr/bin/env bash
# Backup/restore drill (doc 27 R7): proves a dump of the database can be restored and is complete.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/fixli scripts/backup-restore-drill.sh
#
# It dumps SOURCE (read only), restores into a throwaway database on the same server, compares row
# counts of every table, and drops the throwaway database. Run it against staging on a schedule;
# never point DRILL_DB at a database you care about. Needs pg_dump, pg_restore, psql, createdb, dropdb.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to the database to back up}"
SRC="${DATABASE_URL%%\?*}"                       # drop ?schema=public etc.
DRILL_DB="${DRILL_DB:-fixli_restore_drill_$(date +%s)}"
DUMP="$(mktemp -t fixli-dump.XXXXXX)"
trap 'rm -f "$DUMP"; dropdb --if-exists "${DRILL_DB}" --maintenance-db="$SRC" >/dev/null 2>&1 || true' EXIT

echo "1/4 dumping source..."
pg_dump --format=custom --no-owner --file="$DUMP" "$SRC"
echo "    $(du -h "$DUMP" | cut -f1) written"

echo "2/4 restoring into $DRILL_DB..."
createdb "$DRILL_DB" --maintenance-db="$SRC"
TARGET="${SRC%/*}/$DRILL_DB"
pg_restore --no-owner --dbname="$TARGET" "$DUMP"

echo "3/4 comparing row counts..."
count_sql="select format('%I.%I', schemaname, relname) || ' ' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname), false, true, '')))[1]::text from pg_stat_user_tables order by 1"
if ! diff <(psql -At "$SRC" -c "$count_sql") <(psql -At "$TARGET" -c "$count_sql"); then
  echo "DRILL FAILED: the restored copy differs from the source (diff above)"; exit 1
fi
echo "    all tables match"

echo "4/4 migration history present in the restore..."
restored=$(psql -At "$TARGET" -c 'select count(*) from "_prisma_migrations" where finished_at is not null')
echo "    $restored migrations applied in the restored copy"
echo "DRILL OK"
