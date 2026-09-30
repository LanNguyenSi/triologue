#!/bin/sh
# Read-only schema drift report, run by the .relay.yml post_update step.
#
# Compares the live database with server/prisma/schema.prisma inside the api
# container (`prisma migrate diff ... --exit-code`: 0 = no difference,
# 2 = drift) and records the result in a durable status file that
# scripts/check-schema-drift.sh turns into a log line for the monitoring path
# that already reads /var/log/triologue-backup.log. The file is rewritten on
# every run, so a clean run replaces an earlier DRIFT record.
#
# This script always exits 0: a failing post_update step makes agent-relay
# roll the deploy back, and a rollback cannot repair a database.
#
# POSIX sh on purpose: agent-relay runs post_update steps with /bin/sh -c.
# Nothing here reads or writes secrets. The status file holds the diff text
# (schema object names) only when prisma exits 2; for any other failure it
# holds the exit code alone, because prisma connection errors can name the
# database host. Lines containing a URL are dropped from the diff as well.
#
# Environment:
#   DRIFT_STATUS_FILE  status file path (default: <repo>/backups/schema-drift.status)
#   DRIFT_MAX_LINES    diff lines kept in the status file (default 40)
#   DRIFT_WAIT_TRIES   migrate-status polls of 3 s each before the diff (default 30)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATUS_FILE="${DRIFT_STATUS_FILE:-$ROOT/backups/schema-drift.status}"
MAX_LINES="${DRIFT_MAX_LINES:-40}"
WAIT_TRIES="${DRIFT_WAIT_TRIES:-30}"

ts="$(date -u +%FT%TZ)"

# The api container's entrypoint may still be applying migrations when this
# runs, so poll until none is pending (about 90 s at the default) before diffing.
out="$(docker compose exec -T -e HOME=/tmp -e "DRIFT_WAIT_TRIES=$WAIT_TRIES" api sh -c '
  i=0
  until npx prisma migrate status >/dev/null 2>&1 || [ "$i" -ge "$DRIFT_WAIT_TRIES" ]; do
    i=$((i+1))
    sleep 3
  done
  npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
' 2>&1)"
rc=$?

body=""
case "$rc" in
  0)
    state="OK"
    ;;
  2)
    state="DRIFT"
    body="$(printf '%s\n' "$out" | grep -v '://' | head -n "$MAX_LINES")"
    ;;
  *)
    state="ERROR"
    body="check could not run (exit $rc)"
    ;;
esac

status_dir="$(dirname "$STATUS_FILE")"
tmp="$STATUS_FILE.tmp.$$"
if mkdir -p "$status_dir" 2>/dev/null && {
  printf '%s schema-drift %s\n' "$ts" "$state"
  [ -n "$body" ] && printf '%s\n' "$body"
  :
} > "$tmp" 2>/dev/null && mv "$tmp" "$STATUS_FILE" 2>/dev/null; then
  recorded="recorded in $STATUS_FILE"
else
  rm -f "$tmp" 2>/dev/null
  recorded="WARNING: could not write $STATUS_FILE"
fi

case "$state" in
  OK)
    echo "[drift-check] live database matches prisma/schema.prisma ($recorded)"
    ;;
  DRIFT)
    printf '%s\n' "$body"
    echo "[drift-check] WARNING: live database differs from prisma/schema.prisma (diff above; $recorded); the deploy continues"
    ;;
  *)
    echo "[drift-check] WARNING: $body ($recorded); the deploy continues"
    ;;
esac
exit 0
