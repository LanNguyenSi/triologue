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

# Retention settings are validated before anything is written or deleted: a
# value rotation cannot use sensibly must stop the run here rather than let a
# typo delete the wrong files. KEEP_FILES must be a positive integer (capped
# at 100000), KEEP_DAYS a non-negative one capped at 36500 (0 is allowed:
# every set older than a day goes). An unset or empty setting already took the
# default above (${VAR:-10}) and is never rejected here. Leading zeros are
# accepted and read as decimal, so 08 means 8 and the value never meets bash's
# octal rules (a bare $((08 + 1)) is an error). The digit count of the value
# after leading zeros are stripped is checked BEFORE any arithmetic: a bare
# $((10#$VAR)) of a 19-digit value does not fail but wraps around (KEEP_DAYS
# to a negative number, which the age pass would hand to find -mtime and
# delete every backup), so an over-long value is refused as printed.
validate_retention() {
  # $1 variable name, $2 value as given, $3 min, $4 max, $5 wording of kind
  local name="$1" value="$2" min="$3" max="$4" kind="$5" norm
  case "$value" in
    '' | *[!0-9]*)
      echo "backup: $name must be a $kind integer ($min to $max), got '$value'" >&2
      return 1
      ;;
  esac
  norm="${value#"${value%%[!0]*}"}"
  norm="${norm:-0}"
  if [ "${#norm}" -gt 6 ]; then
    echo "backup: $name must be a $kind integer ($min to $max), got '$value'" >&2
    return 1
  fi
  norm=$((10#$norm))
  if [ "$norm" -lt "$min" ] || [ "$norm" -gt "$max" ]; then
    echo "backup: $name must be a $kind integer ($min to $max), got '$value'" >&2
    return 1
  fi
  printf '%s\n' "$norm"
}
KEEP_FILES="$(validate_retention KEEP_FILES "$KEEP_FILES" 1 100000 positive)" || exit 2
KEEP_DAYS="$(validate_retention KEEP_DAYS "$KEEP_DAYS" 0 36500 'non-negative')" || exit 2
echo "backup: retention KEEP_FILES=$KEEP_FILES KEEP_DAYS=$KEEP_DAYS"

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

mtime_epoch() {
  # GNU stat first (-c fails on BSD/macOS, which then falls back to -f);
  # the reverse order breaks on GNU, where -f means filesystem status and succeeds.
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"
}

# Rotation: per file kind, keep at most KEEP_FILES files and nothing older than KEEP_DAYS days.
#
# The listing stays NUL-delimited from find to the inner loop (find -print0,
# printf '%s\t%s\0', sort -z, read -d ''), so it needs neither a parsed `ls`
# nor an `xargs rm`: names and paths are read whole even when a file name
# contains spaces, tabs or newlines, so no name is split into several entries
# and no rm can receive a path fragment. Each record is "<mtime><TAB><path>";
# the path is read as the rest of the record, so tabs and spaces inside it
# survive.
rotate() {
  local pattern="$1"
  local f path count=0
  # The mtime field is only there to sort by; the path is the rest of the record.
  while IFS=$'\t' read -r -d '' _ path; do
    count=$((count + 1))
    if [ "$count" -gt "$KEEP_FILES" ]; then
      rm -f "$path"
    fi
  done < <(
    find -L "$BACKUP_DIR" -maxdepth 1 -name "$pattern" -type f -print0 2>/dev/null |
      while IFS= read -r -d '' f; do
        printf '%s\t%s\0' "$(mtime_epoch "$f")" "$f"
      done |
      sort -z -rn -k1,1
  )
  find "$BACKUP_DIR" -name "$pattern" -mtime +"$KEEP_DAYS" -delete
}
rotate '*.sql'
rotate '*.uploads.tar.gz'
rotate '*.api_data.tar.gz'
kept=$(find -L "$BACKUP_DIR" -maxdepth 1 -name '*.sql' -type f -print | wc -l | tr -d ' ')
echo "backup: rotation done ($kept backups kept)"
