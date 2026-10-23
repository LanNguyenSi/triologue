#!/usr/bin/env bash
# Backup for triologue: Postgres dump plus the uploads directory and the
# api_data volume, safe against partial files.
#
# Dumps into a hidden temp file first and only publishes a validated dump,
# so a failed run never leaves a truncated or 0-byte .sql in backups/
# (root cause of the single empty dump from 2026-04-08: the Makefile's
# shell redirect created the file before pg_dump ran, then pg_dump failed).
# The two file archives follow the same rule and are written next to the dump
# with the same timestamp:
#   <ts>.sql                 pg_dump
#   <ts>.uploads.tar.gz      the uploads directory (host bind mount)
#   <ts>.api_data.tar.gz     /app/data of the api container (api_data volume)
# If either archive fails the script exits non-zero (the dump, if valid, is
# still kept), skips the off-host copy and skips rotation, so a broken set
# never pushes a complete older set out.
#
# Optional off-host copy: set BACKUP_REMOTE_CMD to a shell command. After a
# fully successful local set it runs once as `sh -c "$BACKUP_REMOTE_CMD"
# backup-remote <sql> <uploads.tar.gz> <api_data.tar.gz>`, so the command sees
# the three paths as "$@" (and BACKUP_TS in its environment), for example
#   BACKUP_REMOTE_CMD='scp "$@" backup@backup-host:/srv/triologue/'
# A non-zero exit of the command fails the run and skips rotation. Unset or
# empty: no off-host copy and rotation as before.
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
UPLOADS_DIR="${UPLOADS_DIR:-$(cd "$(dirname "$0")/.." && pwd)/server/uploads}"
API_CONTAINER="${API_CONTAINER:-triologue-api}"
API_DATA_PATH="${API_DATA_PATH:-/app/data}"
BACKUP_REMOTE_CMD="${BACKUP_REMOTE_CMD:-}"

ts="$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
# Reap stale temp files left behind by a SIGKILL'd run or a reboot mid-dump.
find "$BACKUP_DIR" -maxdepth 1 \( -name '.*.sql.tmp' -o -name '.*.tar.gz.tmp' \) -mtime +1 -delete
tmp="$BACKUP_DIR/.$ts.$$.sql.tmp"
out="$BACKUP_DIR/$ts.sql"
uploads_tmp="$BACKUP_DIR/.$ts.$$.uploads.tar.gz.tmp"
uploads_out="$BACKUP_DIR/$ts.uploads.tar.gz"
data_tmp="$BACKUP_DIR/.$ts.$$.api_data.tar.gz.tmp"
data_out="$BACKUP_DIR/$ts.api_data.tar.gz"

cleanup() { rm -f "$tmp" "$uploads_tmp" "$data_tmp"; }
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
echo "backup: wrote $out ($size bytes)"

# File archives. Each is written to a temp file, checked with tar -t and only
# then published; a failure is remembered (failed=1) so the other archive is
# still attempted, and the run exits non-zero at the end.
failed=0

if [ -d "$UPLOADS_DIR" ] \
  && tar -C "$UPLOADS_DIR" -czf "$uploads_tmp" . \
  && tar -tzf "$uploads_tmp" > /dev/null; then
  mv "$uploads_tmp" "$uploads_out"
  echo "backup: wrote $uploads_out ($(wc -c < "$uploads_out" | tr -d ' ') bytes)"
else
  echo "backup: uploads archive of $UPLOADS_DIR failed, refusing to keep it" >&2
  rm -f "$uploads_tmp"
  failed=1
fi

# The api_data volume is read through the running api container (fixed
# container_name in docker-compose.yml), so the compose project prefix of the
# volume name does not matter.
if docker exec "$API_CONTAINER" tar -C "$API_DATA_PATH" -czf - . > "$data_tmp" \
  && tar -tzf "$data_tmp" > /dev/null; then
  mv "$data_tmp" "$data_out"
  echo "backup: wrote $data_out ($(wc -c < "$data_out" | tr -d ' ') bytes)"
else
  echo "backup: api_data archive from $API_CONTAINER:$API_DATA_PATH failed, refusing to keep it" >&2
  rm -f "$data_tmp"
  failed=1
fi

# Off-host copy only after a complete local set.
if [ "$failed" -eq 0 ] && [ -n "$BACKUP_REMOTE_CMD" ]; then
  if BACKUP_TS="$ts" sh -c "$BACKUP_REMOTE_CMD" backup-remote "$out" "$uploads_out" "$data_out"; then
    echo "backup: off-host copy done"
  else
    echo "backup: off-host copy command failed" >&2
    failed=1
  fi
fi

# A failed run keeps everything it has: rotating now could delete the last
# complete (or last uploaded) set in favour of a broken one.
if [ "$failed" -ne 0 ]; then
  echo "backup: FAILED, rotation skipped" >&2
  exit 1
fi

# Rotation: per file kind, keep at most KEEP_FILES files and nothing older than KEEP_DAYS days.
rotate() {
  local pattern="$1"
  # shellcheck disable=SC2012,SC2086  # machine-generated timestamp names; $pattern must stay unquoted so the glob expands
  ls -t "$BACKUP_DIR"/$pattern 2>/dev/null | tail -n +"$((KEEP_FILES + 1))" | xargs -r rm -f
  find "$BACKUP_DIR" -name "$pattern" -mtime +"$KEEP_DAYS" -delete
}
rotate '*.sql'
rotate '*.uploads.tar.gz'
rotate '*.api_data.tar.gz'
# shellcheck disable=SC2012  # same machine-generated filenames as above
echo "backup: rotation done ($(ls "$BACKUP_DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ') backups kept)"
