#!/usr/bin/env bash
# Restore a database dump into the running postgres container, the safe
# sequence of docs/deployment.md ("Restore"): stop the api, replace the schema
# and load the dump in ONE transaction, start the api again.
#
# Why each step:
#   - stop api first: the dump is `pg_dump --clean --if-exists`
#     (scripts/backup.sh), which only drops the objects the dump knows. While
#     the api writes, a restore can fail midway and leave a database that is
#     half dump and half live data.
#   - psql -1 with ON_ERROR_STOP=1: the DROP SCHEMA, the CREATE SCHEMA and the
#     whole dump run in a single transaction, so a dump that fails partway (a
#     schema that moved on since the dump: a migration added an object that
#     depends on a dumped one) rolls everything back, including the DROP. The
#     database is then exactly as before the attempt, and the api is started
#     again on that (pre-restore) database: the safer choice, because the api
#     and its migrations match that schema, while an api restarted on a
#     half-restored or empty schema would either crash on start or write into
#     a schema its code does not know.
#
# Usage:
#   scripts/restore.sh                 newest backups/*.sql
#   scripts/restore.sh <file>          that dump file
#   FILE=<file> scripts/restore.sh     same, for `make restore FILE=...`
#
# Settings (same defaults as scripts/backup.sh, which takes the dumps):
#   BACKUP_DIR   directory of the dumps (default: <repo>/backups)
#   FILE         dump file, same as the positional argument (argument wins)
#   PG_SERVICE   compose service running Postgres (default: postgres)
#   PG_USER      psql user      (default: triologue_user)
#   PG_DB        database       (default: triologue)
#   API_SERVICE  compose service to stop during the restore (default: api)
#
# Called by `make restore`; it restores the database only, never the uploads
# or api_data archives of the same stamp (see docs/deployment.md).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
while [ "$BACKUP_DIR" != "/" ] && [ "${BACKUP_DIR%/}" != "$BACKUP_DIR" ]; do
  BACKUP_DIR="${BACKUP_DIR%/}"
done
PG_SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${PG_USER:-triologue_user}"
PG_DB="${PG_DB:-triologue}"
API_SERVICE="${API_SERVICE:-api}"

file="${1:-${FILE:-}}"
if [ -z "$file" ]; then
  # Newest *.sql in BACKUP_DIR, as `make restore` did before (mtime order);
  # BACKUP_DIR and this choice stay configurable for the cron-side tooling.
  # shellcheck disable=SC2012
  file="$(ls -t "$BACKUP_DIR"/*.sql 2>/dev/null | head -1 || true)"
  if [ -z "$file" ]; then
    echo "❌ No backups found"
    exit 1
  fi
fi
if [ ! -f "$file" ]; then
  echo "❌ No such dump file: $file" >&2
  exit 1
fi

# Any attempt to stop the api is answered by an attempt to start it again, on
# every exit path (success, failed dump, failed stop, Ctrl-C): the api must
# never be left down by this script. Set before the stop call, so a stop that
# fails halfway (or a signal that arrives during it) is still answered;
# `docker compose start` on a service that is already running is a no-op.
api_stopped=0
on_exit() {
  local rc=$?
  if [ "$api_stopped" -eq 1 ]; then
    if docker compose start "$API_SERVICE"; then
      echo "✅ Service $API_SERVICE started"
    else
      echo "❌ Could not start the $API_SERVICE service. Start it yourself: docker compose start $API_SERVICE" >&2
      if [ "$rc" -eq 0 ]; then rc=1; fi
    fi
  fi
  exit "$rc"
}
trap on_exit EXIT
# A HUP, INT or TERM (closed terminal, Ctrl-C, a container stop) is reported
# and turned into a plain failed run; the EXIT trap then starts the api again.
# bash acts on the signal once the docker call in flight has returned, so the
# api comes back after that call, not during it.
interrupted() {
  # The start attempt of the EXIT trap reports itself (✅ or ❌), so this line
  # stays true whether or not the api was already stopped.
  echo "⚠️  Interrupted by SIG$1: this restore run stops here" >&2
  exit 1
}
trap 'interrupted HUP' HUP
trap 'interrupted INT' INT
trap 'interrupted TERM' TERM

echo "⚠️  Restoring from $file ..."
# The warning is echoed, not part of read -p: bash shows that prompt only when
# input comes from a terminal, and the sentence has to be on record either way.
echo "⚠️  The database $PG_DB is REPLACED by this dump: its current contents are dropped."
read -r -p "Continue? [y/N] " confirm || confirm=""
if [ "$confirm" != "y" ]; then
  echo "Cancelled."
  exit 0
fi

api_stopped=1
if ! docker compose stop "$API_SERVICE"; then
  echo "❌ Could not stop the $API_SERVICE service; the database was not restored" >&2
  exit 1
fi

# One stream, one psql call, one transaction (-1): the schema is emptied first
# so the dump lands on an empty schema (a --clean dump does not drop objects a
# migration added after it was taken), and the DROP is part of the transaction
# that can still fail, so it is rolled back with it. A pg_dump --clean dump
# drops and creates the schema it needs itself, so re-creating public here is
# not disturbed by the dump's own statements.
if {
  printf '%s\n' 'DROP SCHEMA public CASCADE;' 'CREATE SCHEMA public;'
  cat "$file"
} | docker compose exec -T "$PG_SERVICE" psql -1 -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB"; then
  echo "✅ Restored from $file"
else
  echo "❌ Restore failed: the transaction was rolled back, the database is unchanged" >&2
  exit 1
fi
