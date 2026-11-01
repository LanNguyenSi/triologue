#!/bin/sh
# Pre-deploy database dump, run by the .relay.yml pre_update hook.
#
# POSIX sh on purpose: the agent-relay container (node:22-alpine) has no bash,
# only busybox ash, so scripts/backup.sh (bash) cannot run there. This script
# therefore does one thing: it dumps Postgres through the docker socket before
# a deploy changes anything, because the api container's entrypoint runs
# `prisma migrate deploy` on start and a migration touches only the database.
# The uploads and api_data archives, the rotation of the cron sets and the
# off-host copy stay with scripts/backup.sh and its daily cron.
#
# The dump goes to <repo>/backups/pre-deploy/<UTC stamp>.sql (BACKUP_DIR
# overrides <repo>/backups). It is written to a hidden temp file, checked
# (size and pg_dump's completion marker, same as backup.sh) and only then
# published with mv, so a failed run never leaves a partial file. After a
# successful run only the newest KEEP_PRE_DEPLOY (default 5) files that match
# this script's own name pattern are kept; nothing else in pre-deploy/ and
# nothing in backups/ is ever deleted.
#
# Any failure prints a message starting "[backup] FATAL" and exits non-zero.
# Same container/user/database settings and overrides as backup.sh:
# PG_CONTAINER, PG_USER, PG_DB.
set -eu
umask 077

PG_CONTAINER="${PG_CONTAINER:-triologue-postgres}"
PG_USER="${PG_USER:-triologue_user}"
PG_DB="${PG_DB:-triologue}"
KEEP_PRE_DEPLOY="${KEEP_PRE_DEPLOY:-5}"

fatal() {
  echo "[backup] FATAL: $*" >&2
  exit 1
}

case "$KEEP_PRE_DEPLOY" in
  '' | *[!0-9]* | 0*) fatal "KEEP_PRE_DEPLOY must be a positive integer without leading zeros (1 to 1000), got '$KEEP_PRE_DEPLOY'" ;;
esac
if [ "${#KEEP_PRE_DEPLOY}" -gt 4 ] || [ "$KEEP_PRE_DEPLOY" -gt 1000 ]; then
  fatal "KEEP_PRE_DEPLOY must be a positive integer (1 to 1000), got '$KEEP_PRE_DEPLOY'"
fi

if [ -n "${BACKUP_DIR:-}" ]; then
  base="${BACKUP_DIR%/}"
else
  base="$(cd "$(dirname "$0")/.." && pwd)/backups"
fi
dir="$base/pre-deploy"
mkdir -p "$dir" || fatal "cannot create $dir"
chmod 700 "$dir" || fatal "cannot restrict $dir"

ts="$(date -u +%Y%m%d_%H%M%SZ)"
tmp="$dir/.$ts.$$.sql.tmp"
out="$dir/$ts.sql"

cleanup() { rm -f "$tmp"; }
trap cleanup EXIT
# A direct HUP, INT or TERM to this script (Ctrl-C, a container stop) must run
# the EXIT trap too; ash does not do that on its own. The shell acts on the
# signal once the running docker call returns. A relay step timeout kills only
# the outer `sh -c` that started this script, so the script then keeps running
# orphaned until docker returns and the dump finishes; nothing here can stop
# that, and a SIGKILLed run is cleaned up by the sweep below.
trap 'exit 1' HUP INT TERM

# Reap temp files of an earlier run that was SIGKILLed: regular files in
# pre-deploy/ whose name has the hidden temp shape of this script
# (.<stamp>.<pid>.sql.tmp) and that find's -mtime +1 counts as old, which means
# at least two full days. The pid part is only matched as `[0-9]*`, which is
# looser than a pure number (for example it also matches `.12x.sql.tmp`).
# A concurrent run's fresh temp file is left alone.
find "$dir" -maxdepth 1 -type f -mtime +1 \
  -name '.[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9]Z.[0-9]*.sql.tmp' \
  -exec rm -f {} \; 2>/dev/null || true

docker exec "$PG_CONTAINER" pg_dump --clean --if-exists -U "$PG_USER" "$PG_DB" > "$tmp" ||
  fatal "pg_dump in container $PG_CONTAINER failed; the deploy is aborted before anything changed"

size="$(wc -c < "$tmp" | tr -d ' ')"
if [ "$size" -lt 1024 ]; then
  fatal "dump too small ($size bytes), refusing to keep it; the deploy is aborted before anything changed"
fi
# Whole-file search: pg_dump 15+ can append a \unrestrict block after the marker.
grep -q "PostgreSQL database dump complete" "$tmp" ||
  fatal "dump is missing the completion marker, refusing to keep it; the deploy is aborted before anything changed"

mv "$tmp" "$out" || fatal "cannot publish $out"
echo "[backup] pre-deploy dump written: $out ($size bytes)"

# Retention: names are fixed-width UTC stamps, so the glob (sorted by the
# shell) lists oldest first. Only regular files of exactly that shape count.
total=0
for f in "$dir"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9]Z.sql; do
  if [ ! -f "$f" ] || [ -L "$f" ]; then continue; fi
  total=$((total + 1))
done
drop=$((total - KEEP_PRE_DEPLOY))
if [ "$drop" -gt 0 ]; then
  for f in "$dir"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9][0-9][0-9]Z.sql; do
    [ "$drop" -gt 0 ] || break
    if [ ! -f "$f" ] || [ -L "$f" ]; then continue; fi
    case "$f" in
      "$dir"/*.sql) rm -f "$f" ;;
    esac
    drop=$((drop - 1))
  done
fi
echo "[backup] pre-deploy dumps kept: at most $KEEP_PRE_DEPLOY in $dir"
