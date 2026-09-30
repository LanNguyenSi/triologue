#!/usr/bin/env bash
# Alarm for the schema drift record written by scripts/schema-drift-report.sh
# (run from the .relay.yml post_update step on every deploy).
#
# Reads backups/schema-drift.status and prints exactly one result line:
#   schema-drift OK        the last deploy found the live database matching prisma/schema.prisma
#   schema-drift FAIL      the last deploy found a difference (DRIFT) or could not run the check (ERROR)
#   schema-drift UNKNOWN   no report yet (no deploy has run the report since it was installed)
# Exit 0 for OK and UNKNOWN, 1 for FAIL. Like check-backup-freshness.sh it is a
# passive alarm: it does not page anyone, so install it on an hourly cron that
# appends to the same log and watch that log for FAIL lines, in
# /etc/cron.d/triologue-backup:
#   11 * * * * root /apps/triologue/scripts/check-schema-drift.sh >> /var/log/triologue-backup.log 2>&1
# The FAIL line repeats every hour until a deploy (or a manual
# `sh scripts/schema-drift-report.sh`) records a clean result.
set -euo pipefail

STATUS_FILE="${DRIFT_STATUS_FILE:-$(cd "$(dirname "$0")/.." && pwd)/backups/schema-drift.status}"

ts="$(date -u +%FT%TZ)"

if [ ! -f "$STATUS_FILE" ]; then
  echo "$ts schema-drift UNKNOWN: no report at $STATUS_FILE"
  exit 0
fi

first="$(head -n 1 "$STATUS_FILE")"
reported="${first%% *}"
state="${first##* }"

case "$state" in
  OK)
    echo "$ts schema-drift OK: reported=$reported"
    ;;
  DRIFT | ERROR)
    echo "$ts schema-drift FAIL: reported=$reported state=$state details=$STATUS_FILE"
    exit 1
    ;;
  *)
    echo "$ts schema-drift FAIL: reported=$reported state=unreadable details=$STATUS_FILE"
    exit 1
    ;;
esac
