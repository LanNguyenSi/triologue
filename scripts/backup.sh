#!/usr/bin/env bash
# Postgres backup for triologue, safe against partial dumps.
#
# Dumps into a hidden temp file first and only publishes a validated dump,
# so a failed run never leaves a truncated or 0-byte .sql in backups/
# (root cause of the single empty dump from 2026-04-08: the Makefile's
# shell redirect created the file before pg_dump ran, then pg_dump failed).
#
# Called by `make backup` and by the daily root cron job on VPS-02, installed
# in /etc/cron.d/triologue-backup:
#   17 3 * * * root /apps/triologue/scripts/backup.sh >> /var/log/triologue-backup.log 2>&1
set -euo pipefail
umask 077

BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
PG_CONTAINER="${PG_CONTAINER:-triologue-postgres}"
PG_USER="${PG_USER:-triologue_user}"
PG_DB="${PG_DB:-triologue}"
KEEP_FILES="${KEEP_FILES:-10}"
KEEP_DAYS="${KEEP_DAYS:-10}"

ts="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
# Reap stale temp files left behind by a SIGKILL'd run or a reboot mid-dump.
find "$BACKUP_DIR" -maxdepth 1 -name '.*.sql.tmp' -mtime +1 -delete
tmp="$BACKUP_DIR/.$ts.$$.sql.tmp"
out="$BACKUP_DIR/$ts.sql"

cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

docker exec "$PG_CONTAINER" pg_dump --clean --if-exists -U "$PG_USER" "$PG_DB" > "$tmp"

# Validate before publishing: non-trivial size and pg_dump's completion marker.
size=$(wc -c < "$tmp" | tr -d ' ')
if [ "$size" -lt 1024 ]; then
  echo "backup: dump too small ($size bytes), refusing to keep it" >&2
  exit 1
fi
# Search the whole file, not just the tail: pg_dump 15+ can append a
# trailing \unrestrict block after the completion marker, which pushes the
# marker off a fixed-size tail window and would cause false rejections.
if ! grep -q "PostgreSQL database dump complete" "$tmp"; then
  echo "backup: dump is missing the completion marker, refusing to keep it" >&2
  exit 1
fi

mv "$tmp" "$out"
trap - EXIT
echo "backup: wrote $out ($size bytes)"

# Rotation: keep at most KEEP_FILES files and nothing older than KEEP_DAYS days.
# shellcheck disable=SC2012  # filenames are machine-generated timestamps, ls -t is safe here
ls -t "$BACKUP_DIR"/*.sql 2>/dev/null | tail -n +"$((KEEP_FILES + 1))" | xargs -r rm -f
find "$BACKUP_DIR" -name "*.sql" -mtime +"$KEEP_DAYS" -delete
# shellcheck disable=SC2012  # same machine-generated filenames as above
echo "backup: rotation done ($(ls "$BACKUP_DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ') backups kept)"
