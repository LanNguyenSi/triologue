#!/usr/bin/env bash
# Restore a database dump into the running postgres container, the safe
# sequence of docs/deployment.md ("Restore"): stop the api, replace the schema,
# load the dump inside one transaction that is committed only at the very end,
# and start the api again.
#
# Why each step:
#   - stop api first: the dump is `pg_dump --clean --if-exists`
#     (scripts/backup.sh), which only drops the objects the dump knows. While
#     the api writes, a restore can fail midway and leave a database that is
#     half dump and half live data.
#   - a dump file that does not contain pg_dump's completion line, exactly
#     "-- PostgreSQL database dump complete", as a whole line is truncated:
#     refuse it before the prompt, before stopping the api and without
#     touching anything. The whole-line match matters: the phrase also
#     occurs inside COPY data (a chat message can quote it), so a substring
#     match lets a dump cut at a statement boundary pass. Recent pg_dump
#     (15.19 observed) also opens the dump with "\restrict <key>" and closes
#     it with the matching "\unrestrict <key>" as its very last line: when
#     the opening line is there but its "\unrestrict <key>" is not after the
#     completion line, the file was cut before its end and psql would be
#     left in restricted mode, so require that pair too. The completion line
#     is also anchored at the end of the file: after the last such line only
#     "--" comment lines, blank lines and that "\unrestrict <key>" may
#     follow, so a data line that quotes the phrase in the middle of a dump
#     cut later does not pass.
#   - one explicit transaction, committed only at the end, and NOT `psql -1`:
#     the stream fed to `psql -v ON_ERROR_STOP=1` is BEGIN;, the DROP/CREATE
#     of the public schema, the dump, COMMIT;, and a last SELECT that prints
#     a per-run marker. `psql -1` sends COMMIT when its input ends, whatever
#     arrived, so a Ctrl-C, a hangup or a TERM to the process group midway
#     would commit a partial restore. With an explicit COMMIT an input that
#     ends early leaves the transaction open and Postgres rolls it back when
#     the session ends. The marker is a SQL SELECT, not a \echo backslash
#     command: a dump that opens with \restrict runs psql in restricted mode,
#     where backslash commands are rejected, so an \echo marker after a
#     successful COMMIT; would exit psql non-zero and make a committed run
#     look rolled back. The decision on psql's result is marker-first: the
#     marker in psql's output means the COMMIT; ran, even when psql exits
#     non-zero afterwards (then say committed with a post-commit psql error);
#     no marker means not committed and the database is unchanged, even when
#     psql exits 0. If a signal stops the run before the marker is seen, the
#     outcome is unknown and the script prints a query to check it.
#
# Usage:
#   scripts/restore.sh                 newest backups/*.sql
#   scripts/restore.sh <file>          that dump file
#   FILE=<file> scripts/restore.sh     same, for `make restore FILE=...`
#
# Settings (same defaults as scripts/backup.sh, which takes the dumps):
#   BACKUP_DIR   directory of the dumps (default: <repo>/backups)
#   FILE         dump file, same as the positional argument (argument wins)
#   COMPOSE      the compose command (default: docker compose), split into
#                words; the override the old `make restore` recipe had as
#                $(COMPOSE). Unset or empty means the default.
#   PG_SERVICE   compose service running Postgres (default: postgres)
#   PG_USER      psql user      (default: triologue_user)
#   PG_DB        database       (default: triologue)
#   API_SERVICE  compose service to stop during the restore (default: api)
#
# Called by `make restore`; it restores the database only, never the uploads
# or api_data archives of the same stamp (see docs/deployment.md). It runs
# from the repository root whatever the caller's cwd is.
set -euo pipefail

# The compose calls read docker-compose.yml from the working directory and
# the old recipe ran from the repository root, so do the same whatever the
# caller's cwd is; the root comes from the script's own path.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
while [ "$BACKUP_DIR" != "/" ] && [ "${BACKUP_DIR%/}" != "$BACKUP_DIR" ]; do
  BACKUP_DIR="${BACKUP_DIR%/}"
done
PG_SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${PG_USER:-triologue_user}"
PG_DB="${PG_DB:-triologue}"
API_SERVICE="${API_SERVICE:-api}"
# COMPOSE replaces the whole "docker compose" command (the old recipe's
# $(COMPOSE), which `make restore` passes down). Split it into words so a
# multi-word value works; read -a never globs. Unset or empty: the default.
IFS=' ' read -r -a compose <<< "${COMPOSE:-docker compose}"
# Per-run commit marker: the stream SELECTs this back after COMMIT; (SQL,
# not \echo: a dump that opens with \restrict runs psql in restricted mode,
# where backslash commands are rejected), and the run counts as committed
# only if the marker comes back in psql's output. Random and digits only, so
# a dump can never contain it and it is safe inside a SQL string literal.
marker="RESTORE_COMMITTED_$$_${RANDOM}${RANDOM}"

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

# Truncated dump: refuse it before the prompt and before stopping the api.
# The completion line must match exactly and as a whole line: the phrase
# also occurs inside COPY data (a chat message can quote it), and an
# unanchored substring match let a dump cut at a statement boundary pass.
# Both backup scripts apply this same rule through scripts/dump-complete.sh.
if ! grep -qx -- '-- PostgreSQL database dump complete' "$file"; then
  echo "❌ $file does not contain the pg_dump completion line \"-- PostgreSQL database dump complete\" as a whole line: the dump is truncated or corrupt. Nothing was touched." >&2
  exit 1
fi

# pg_dump (15.19 observed) opens the dump with "\restrict <key>" and closes
# it with the matching "\unrestrict <key>" as its very last line. When the
# opening line is present but that "\unrestrict <key>" line is not there
# after the completion line, the file was cut before its end (the copy
# stopped after the dump data): psql would run in restricted mode, so
# refuse it. An older dump without any \restrict line passes this pairing.
# The completion line is also anchored at the end of the file: the last exact
# completion line must be followed only by "--" comment lines, blank lines
# and the matching "\unrestrict <key>" up to EOF. Any other line after it
# means that line was dumped data quoting the phrase (a chat message) and
# the file goes on, or was cut, after it.
completion_line="$(grep -n -x -- '-- PostgreSQL database dump complete' "$file" | tail -1 | cut -d: -f1)"
restrict_line="$(grep -m1 -- '^[\\]restrict ' "$file" || true)"
restrict_key=""
unrestrict_line=""
if [ -n "$restrict_line" ]; then
  restrict_key="${restrict_line#\\restrict }"
  unrestrict_line="\\unrestrict $restrict_key"
fi
# awk exits 2 for a line that may not follow the completion line, 3 when the
# \restrict key has no matching \unrestrict line among them, 0 otherwise.
# (Not `grep -q` here: with pipefail its early exit can turn into SIGPIPE.)
tail_rc=0
tail -n "+$((completion_line + 1))" "$file" | UNRESTRICT_LINE="$unrestrict_line" awk '
  BEGIN { u = ENVIRON["UNRESTRICT_LINE"] }
  $0 == "" || substr($0, 1, 2) == "--" { next }
  u != "" && $0 == u { seen = 1; next }
  { bad = 1; exit }
  END { if (bad) exit 2; if (u != "" && !seen) exit 3 }
' || tail_rc=$?
if [ "$tail_rc" -eq 3 ]; then
  printf '%s\n' "❌ $file opens with '\restrict $restrict_key' but has no matching '\unrestrict $restrict_key' line after the completion line: the dump is truncated. Nothing was touched." >&2
  exit 1
elif [ "$tail_rc" -ne 0 ]; then
  pairing=""
  if [ -n "$restrict_key" ]; then
    pairing=" (this dump opens with a \\restrict $restrict_key line, so \\unrestrict $restrict_key is the only other line allowed)"
  fi
  echo "❌ $file has content after its last pg_dump completion line other than comments and blank lines${pairing}: the completion phrase was dumped data, or the file was cut after it. Nothing was touched." >&2
  exit 1
fi

# Any attempt to stop the api is answered by an attempt to start it again, on
# every exit path (success, failed dump, failed stop, Ctrl-C): the api must
# never be left down by this script. Set before the stop call, so a stop that
# fails halfway (or a signal that arrives during it) is still answered;
# `compose start` on a service that is already running is a no-op.
# docker compose fails when it cannot write its progress to stderr (make
# restore 2>&1 | head), so stop and start write to a log file that is shown
# afterwards; a closed stderr then only loses the progress lines.
compose_logged() {
  local log rc=0
  log="$(mktemp "${TMPDIR:-/tmp}/restore-compose.XXXXXX")" || return 1
  "${compose[@]}" "$@" > "$log" 2>&1 || rc=$?
  cat "$log" >&2 2>/dev/null || true
  rm -f "$log"
  return "$rc"
}
api_stopped=0
pipeline_started=0
committed=0
psql_out_file=""
on_exit() {
  local rc=$?
  # From here on the script is finishing and the api must come back: ignore
  # HUP, INT and TERM here, and run the start in its own process group. An
  # ignored disposition alone is not enough: the docker CLI installs its own
  # SIGINT/SIGTERM handlers, so a group Ctrl-C or TERM would still end the
  # start and leave the api down after a committed restore. In its own process
  # group the start is out of reach of signals sent to the script's group (a
  # start that hangs then has to be stopped by its pid). The psql output file
  # stays until after the start attempt: marker_in_output reads it.
  trap '' HUP INT TERM
  if [ "$api_stopped" -eq 1 ]; then
    if ( set -m; compose_logged start "$API_SERVICE" & { echo "Starting $API_SERVICE (a start that hangs can be stopped with: kill -- -$!)" >&2 || true; }; wait "$!" ); then
      echo "✅ Service $API_SERVICE started" || true
    else
      echo "❌ Could not start the $API_SERVICE service. Start it yourself: ${compose[*]} start $API_SERVICE" >&2 || true
      if marker_in_output; then
        echo "   The restore itself had committed: the database is the dump." >&2 || true
      fi
      if [ "$rc" -eq 0 ]; then rc=1; fi
    fi
  fi
  if [ -n "$psql_out_file" ]; then rm -f "$psql_out_file"; fi
  exit "$rc"
}
trap on_exit EXIT
# The run counts as committed once the marker is in psql's output. Remembered
# in $committed, so a later message (an interruption, a failed start) still
# says committed even when the output file is gone.
marker_in_output() {
  if [ "$committed" -eq 1 ]; then return 0; fi
  if [ -n "$psql_out_file" ] && grep -q "$marker" "$psql_out_file" 2>/dev/null; then
    committed=1
    return 0
  fi
  return 1
}
# A HUP, INT or TERM (closed terminal, Ctrl-C, a container stop) is reported
# and turned into a plain failed run; the EXIT trap then starts the api again.
# bash acts on the signal once the docker call in flight has returned, so the
# api comes back after that call, not during it.
interrupted() {
  # A second signal must not re-enter this handler while it reports.
  trap '' HUP INT TERM
  # The start attempt of the EXIT trap reports itself (✅ or ❌), so this line
  # stays true whether or not the api was already stopped.
  echo "⚠️  Interrupted by SIG$1: this restore run stops here" >&2
  if marker_in_output; then
    echo "⚠️  The restore had COMMITTED before the interruption (the commit marker was seen): the database is the dump." >&2
  elif [ "$pipeline_started" -eq 1 ]; then
    # Mid-transaction the rollback on session end is expected but not promised
    # to this script, so the outcome is stated as unknown, never as unchanged
    # or replaced, together with a one-liner to check the live database.
    echo "⚠️  Whether the restore committed is UNKNOWN: check the database before trusting it, e.g.:" >&2
    echo "    ${compose[*]} exec -T $PG_SERVICE psql -U $PG_USER -d $PG_DB -c 'select count(*) from \"_prisma_migrations\"'" >&2
  fi
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

# From the stop on, a closed stdout (make restore | head) must not kill the
# script: with SIGPIPE at its default a status echo would end bash before the
# EXIT trap runs, and the api would stay stopped. Ignored, a write to a closed
# stdout only fails; the status lines below tolerate that.
trap '' PIPE
api_stopped=1
if ! compose_logged stop "$API_SERVICE"; then
  echo "❌ Could not stop the $API_SERVICE service; the database was not restored" >&2 || true
  exit 1
fi

# One stream, one psql call, one explicit transaction that ends in COMMIT;.
# The schema is emptied first so the dump lands on an empty schema (a --clean
# dump does not drop objects a migration added after it was taken), and the
# DROP is part of the transaction that can still fail, so it is rolled back
# with it. The dump itself never creates or drops public: a pg_dump 15 dump of
# the public schema contains no DROP/CREATE SCHEMA, which is why the script
# prepends them; the owner and ACL change of public this implies is described
# in docs/deployment.md. psql's stdout goes to a file, where the commit marker
# is verified, and is shown on the terminal afterwards, so the marker check
# does not depend on whoever reads stdout; the ignored SIGPIPE above keeps a
# closed stdout from ending the script. The marker is
# a SELECT, not \echo: in a restricted-mode dump (\restrict) backslash
# commands are rejected after COMMIT;, which would exit psql non-zero on a
# run that in fact committed.
# A template under $TMPDIR: BSD mktemp without one ignores TMPDIR.
psql_out_file="$(mktemp "${TMPDIR:-/tmp}/restore-psql.XXXXXX")"
pipeline_started=1
pipeline_rc=0
{
  printf '%s\n' 'BEGIN;' 'DROP SCHEMA public CASCADE;' 'CREATE SCHEMA public;'
  cat "$file"
  printf '%s\n' 'COMMIT;' "SELECT '$marker' AS restore_marker;"
} | "${compose[@]}" exec -T "$PG_SERVICE" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" > "$psql_out_file" || pipeline_rc=$?
cat "$psql_out_file" 2>/dev/null || true
# Marker first, exit code second: the marker in psql's output means the
# COMMIT; ran and the database is the dump, whatever psql did afterwards.
# No marker means the run never committed (failed dump, or an input that
# ended before COMMIT;): the open transaction was rolled back at session
# end and the database is unchanged, even when psql exits 0.
if marker_in_output; then
  if [ "$pipeline_rc" -eq 0 ]; then
    echo "✅ Restored from $file" || true
  else
    echo "⚠️  Restored from $file: the commit marker came back, so the transaction committed, but psql exited $pipeline_rc after COMMIT;: check its output above for the post-commit error." >&2
    exit 1
  fi
else
  echo "❌ Restore not committed, the database is unchanged: no $marker in psql's output (psql exited $pipeline_rc); the open transaction was rolled back at session end." >&2
  exit 1
fi
