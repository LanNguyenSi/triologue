#!/usr/bin/env bash
# Freshness alarm for triologue backups (scripts/backup.sh output).
#
# Checks three kinds of file in BACKUP_DIR: the newest *.sql dump, the newest
# *.uploads.tar.gz and the newest *.api_data.tar.gz. Each kind must exist, be
# non-empty and be no older than MAX_AGE_HOURS (default 48). Prints exactly
# one result line and exits 0 (OK) or 1 (FAIL, naming the first kind that
# failed). A host that has not yet run the archive-writing backup.sh once
# fails on the missing archives until that first run. This is a passive alarm:
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
now="$(date -u +%s)"

# Newest file matching a glob in BACKUP_DIR, empty when there is none.
newest_of() {
  local pattern="$1" best="" best_mtime=0 f m
  while IFS= read -r -d '' f; do
    m=$(mtime_epoch "$f")
    if [ "$m" -gt "$best_mtime" ]; then
      best_mtime="$m"
      best="$f"
    fi
  # -L: follow a symlinked BACKUP_DIR, matching the glob-based listing in backup.sh.
  done < <(find -L "$BACKUP_DIR" -maxdepth 1 -name "$pattern" -print0 2>/dev/null)
  printf '%s' "$best"
}

summary=""
# label|glob|noun used in messages
for spec in 'dump|*.sql|dumps' 'uploads|*.uploads.tar.gz|uploads archives' 'api_data|*.api_data.tar.gz|api_data archives'; do
  label="${spec%%|*}"
  rest="${spec#*|}"
  pattern="${rest%%|*}"
  noun="${rest#*|}"

  newest="$(newest_of "$pattern")"
  if [ -z "$newest" ]; then
    echo "$ts backup-freshness FAIL: no $noun in $BACKUP_DIR"
    exit 1
  fi

  newest_mtime=$(mtime_epoch "$newest")
  size=$(wc -c < "$newest" | tr -d ' ')
  age_hours=$((( now - newest_mtime ) / 3600))

  if [ "$size" -eq 0 ]; then
    echo "$ts backup-freshness FAIL: newest=$newest age=${age_hours}h max=${MAX_AGE_HOURS}h reason=0-byte $label"
    exit 1
  fi

  if [ "$age_hours" -gt "$MAX_AGE_HOURS" ]; then
    echo "$ts backup-freshness FAIL: newest=$newest age=${age_hours}h max=${MAX_AGE_HOURS}h"
    exit 1
  fi

  summary="$summary newest=$newest age=${age_hours}h"
done

echo "$ts backup-freshness OK:$summary max=${MAX_AGE_HOURS}h"
