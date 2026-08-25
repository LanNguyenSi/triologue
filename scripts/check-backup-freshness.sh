#!/usr/bin/env bash
# Freshness alarm for triologue Postgres backups (scripts/backup.sh output).
#
# Finds the newest backups/*.sql dump and fails when it is older than
# MAX_AGE_HOURS (default 48) or when it is a 0-byte dump. Prints exactly
# one result line and exits 0 (OK) or 1 (FAIL). This is a passive alarm:
# it does not page or notify by itself, so something has to read the log
# or watch the exit code.
#
# Install as an hourly root cron on VPS-02, appending to the same log
# scripts/backup.sh already writes, in /etc/cron.d/triologue-backup:
#   7 * * * * root /apps/triologue/scripts/check-backup-freshness.sh >> /var/log/triologue-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-48}"

mtime_epoch() {
  # GNU stat first (-c fails on BSD/macOS, which then falls back to -f);
  # the reverse order breaks on GNU, where -f means filesystem status and succeeds.
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1"
}

ts="$(date -u +%FT%TZ)"

newest=""
newest_mtime=0
while IFS= read -r -d '' f; do
  m=$(mtime_epoch "$f")
  if [ "$m" -gt "$newest_mtime" ]; then
    newest_mtime="$m"
    newest="$f"
  fi
# -L: follow a symlinked BACKUP_DIR, matching the glob-based listing in backup.sh.
done < <(find -L "$BACKUP_DIR" -maxdepth 1 -name '*.sql' -print0 2>/dev/null)

if [ -z "$newest" ]; then
  echo "$ts backup-freshness FAIL: no dumps in $BACKUP_DIR"
  exit 1
fi

size=$(wc -c < "$newest" | tr -d ' ')
now="$(date -u +%s)"
age_hours=$((( now - newest_mtime ) / 3600))

if [ "$size" -eq 0 ]; then
  echo "$ts backup-freshness FAIL: newest=$newest age=${age_hours}h max=${MAX_AGE_HOURS}h reason=0-byte dump"
  exit 1
fi

if [ "$age_hours" -gt "$MAX_AGE_HOURS" ]; then
  echo "$ts backup-freshness FAIL: newest=$newest age=${age_hours}h max=${MAX_AGE_HOURS}h"
  exit 1
fi

echo "$ts backup-freshness OK: newest=$newest age=${age_hours}h max=${MAX_AGE_HOURS}h"
