#!/usr/bin/env bash
# Test driver for scripts/restore.sh. Uses a fake `docker` on PATH that records
# every call (with the cwd it was called from), captures what psql was given on
# stdin, and echoes back the commit marker the stream asks psql to echo after
# COMMIT;, so no real postgres or container is needed. Run directly or via CI:
#   bash scripts/restore.test.sh
#
# What it proves about the sequence (docs/deployment.md, section Restore):
# the api is stopped before anything touches the database, the dump is loaded
# by a single psql call (no -1) whose stdin starts with BEGIN; + the DROP
# SCHEMA / CREATE SCHEMA pair and ends with COMMIT; + the marker echo, the run
# counts as committed only when psql's output contains the marker, a dump
# without pg_dump's completion marker is refused before anything happens, the
# COMPOSE override and the repository root are honored, and the api is started
# again on every path, including a failing dump, a run whose input ended
# before COMMIT, and an interrupted run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUT="$SCRIPT_DIR/restore.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

WORKDIR="$(mktemp -d)"
FAKE_BIN="$WORKDIR/bin"
mkdir -p "$FAKE_BIN"
trap 'rm -rf "$WORKDIR"' EXIT

export FAKE_DOCKER_LOG="$WORKDIR/docker.log"
export FAKE_DOCKER_PWD="$WORKDIR/docker.pwd"
export FAKE_PSQL_IN="$WORKDIR/psql-stdin.sql"
PATH="$FAKE_BIN:$PATH"
export PATH

fail_count=0
pass_count=0
pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# Fake docker: records the calls, saves psql's stdin, and fails on demand
# (FAKE_MODE for psql, FAKE_STOP_MODE / FAKE_START_MODE for the api service).
# ok mode behaves like a psql that read the whole stream: it prints ordinary
# output and echoes the RESTORE_COMMITTED_* marker its stdin asked for.
# nomarker behaves like a psql whose input ended before COMMIT;: normal exit,
# no marker.
cat > "$FAKE_BIN/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_DOCKER_LOG"
echo "$PWD" >> "$FAKE_DOCKER_PWD"
sub=""
for a in "$@"; do case "$a" in exec|stop|start) sub=$a; break;; esac; done
if [ "$1" = compose ] && [ "$sub" = exec ]; then
  cat > "$FAKE_PSQL_IN"
  case "${FAKE_MODE:-ok}" in
    ok) printf '%s\n' BEGIN DROP SCHEMA CREATE SCHEMA 'INSERT 0 1' COMMIT
      awk '$1=="\\echo" && $2 ~ /^RESTORE_COMMITTED_/ {print $2}' "$FAKE_PSQL_IN" ;;
    nomarker) printf '%s\n' BEGIN 'INSERT 0 1' ;;
    fail) echo "stub psql: ERROR: cannot drop constraint t_pkey because other objects depend on it" >&2
      exit 3 ;;
    slow) sleep 3 ;;
  esac
elif [ "$1" = compose ] && [ "$sub" = stop ]; then
  if [ "${FAKE_STOP_MODE:-ok}" != ok ]; then
    echo "stub docker: cannot stop container" >&2
    exit 1
  fi
elif [ "$1" = compose ] && [ "$sub" = start ]; then
  if [ "${FAKE_START_MODE:-ok}" != ok ]; then
    echo "stub docker: cannot start container" >&2
    exit 1
  fi
fi
STUB
chmod +x "$FAKE_BIN/docker"

dump_body() { # $1 = marker
  printf -- '-- PostgreSQL database dump\n'
  printf -- 'INSERT INTO t VALUES (%s);\n' "$1"
  printf -- '-- PostgreSQL database dump complete\n'
}

new_case() {
  BACKUP_DIR="$WORKDIR/case-$1"
  export BACKUP_DIR
  mkdir -p "$BACKUP_DIR"
  : > "$FAKE_DOCKER_LOG"
  : > "$FAKE_DOCKER_PWD"
  : > "$FAKE_PSQL_IN"
  unset FAKE_MODE FAKE_STOP_MODE FAKE_START_MODE API_SERVICE PG_SERVICE PG_USER PG_DB || true
  unset FILE COMPOSE || true
}
answer() { # $1 = reply to the prompt, rest of env as set by the caller
  printf '%s\n' "$1" | bash "$SUT" > "$WORKDIR/out.txt" 2> "$WORKDIR/err.txt"
}
calls() { cat "$FAKE_DOCKER_LOG"; }
expect_log() { # $1 = expected recorded calls, one per line
  if [ "$(cat "$FAKE_DOCKER_LOG")" = "$1" ]; then pass "docker calls: $(echo "$1" | tr '\n' ' | ')"; else
    fail "docker calls: expected [$1], got [$(tr '\n' '|' < "$FAKE_DOCKER_LOG")]"
  fi
}

EXPECTED_OK_LOG='compose stop api
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U triologue_user -d triologue
compose start api'

# 1. Confirmed run: api stopped first, one psql call without -1, api started
# last, the newest dump is the one loaded, and the stream sent to psql starts
# with BEGIN; + the DROP/CREATE pair and ends with COMMIT; + the marker echo.
# The marker must come back in psql's output, which the script shows to the
# operator on the way.
new_case success
dump_body OLD > "$BACKUP_DIR/20200101_000000.sql"
dump_body NEW > "$BACKUP_DIR/20200102_000000.sql"
touch -t 202001010000 "$BACKUP_DIR/20200101_000000.sql"
touch -t 202001020000 "$BACKUP_DIR/20200102_000000.sql"
if answer y; then pass "confirmed run exits 0"; else fail "confirmed run exits 0"; cat "$WORKDIR/err.txt"; fi
expect_log "$EXPECTED_OK_LOG"
if [ "$(grep -c psql "$FAKE_DOCKER_LOG")" = 1 ]; then pass "exactly one psql call"; else fail "exactly one psql call"; fi
if grep -E '(^| )-1( |$)' "$FAKE_DOCKER_LOG" > /dev/null; then
  fail "psql is called without -1 (a -1 would commit at end of input): $(calls)"
else
  pass "psql is called without -1 (a -1 would commit at end of input)"
fi
if head -3 "$FAKE_PSQL_IN" | tr '\n' '|' | grep -q '^BEGIN;|DROP SCHEMA public CASCADE;|CREATE SCHEMA public;|'; then
  pass "the stream starts with BEGIN; then DROP SCHEMA public CASCADE and CREATE SCHEMA public"
else
  fail "the stream starts with BEGIN; then DROP SCHEMA public CASCADE and CREATE SCHEMA public: $(head -3 "$FAKE_PSQL_IN" | tr '\n' '|')"
fi
if tail -2 "$FAKE_PSQL_IN" | head -1 | grep -qx 'COMMIT;'; then pass "the stream sends COMMIT; near its end"; else fail "the stream sends COMMIT; near its end: $(tail -2 "$FAKE_PSQL_IN")"; fi
if tail -1 "$FAKE_PSQL_IN" | grep -q '^\\echo RESTORE_COMMITTED_'; then
  pass "the stream ends with COMMIT; plus the commit-marker echo"
else
  fail "the stream ends with COMMIT; plus the commit-marker echo: $(tail -1 "$FAKE_PSQL_IN")"
fi
if grep -q 'INSERT INTO t VALUES (NEW);' "$FAKE_PSQL_IN"; then pass "the newest dump is the one fed to psql"; else fail "the newest dump is the one fed to psql"; fi
if grep -q 'INSERT INTO t VALUES (OLD);' "$FAKE_PSQL_IN"; then fail "the older dump is not fed to psql"; else pass "the older dump is not fed to psql"; fi
if [ "$(grep -c 'INSERT INTO t VALUES (NEW);' "$FAKE_PSQL_IN")" = 1 ]; then pass "the dump is fed exactly once"; else fail "the dump is fed exactly once"; fi
if grep -q 'RESTORE_COMMITTED_' "$WORKDIR/out.txt" && grep -q '^COMMIT$' "$WORKDIR/out.txt"; then
  pass "psql's output (marker included) stays visible to the operator"
else
  fail "psql's output (marker included) stays visible to the operator: $(cat "$WORKDIR/out.txt")"
fi
if [ "$(grep -c 'RESTORE_COMMITTED_' "$FAKE_PSQL_IN")" = 1 ]; then pass "the stream carries the marker exactly once"; else fail "the stream carries the marker exactly once"; fi
if grep -q '✅ Restored from' "$WORKDIR/out.txt" && grep -q '✅ Service api started' "$WORKDIR/out.txt"; then
  pass "success reports the restore and the restarted api"
else
  fail "success reports the restore and the restarted api"
fi

# 2. The prompt: only "y" restores. "n" and a bare Enter do nothing at all.
for reply in n '' N yes Y; do
  new_case "prompt-${reply:-empty}"
  dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
  if answer "$reply"; then pass "reply '$reply' exits 0"; else fail "reply '$reply' exits 0"; fi
  if [ ! -s "$FAKE_DOCKER_LOG" ]; then pass "reply '$reply' calls no docker"; else fail "reply '$reply' calls no docker: $(calls)"; fi
  if grep -q 'Cancelled.' "$WORKDIR/out.txt"; then pass "reply '$reply' says Cancelled."; else fail "reply '$reply' says Cancelled."; fi
done

# 3. The prompt text says the database is replaced. bash prints a `read -p`
# prompt only for terminal input, so the script echoes the sentence itself.
new_case prompt-text
dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
answer n
if grep -qi 'replaced' "$WORKDIR/out.txt"; then pass "the prompt says the database is replaced"; else fail "the prompt says the database is replaced: $(cat "$WORKDIR/out.txt")"; fi

# 4. No backup at all: exit 1 with the message `make restore` printed.
new_case no-backup
if answer y; then fail "no backup exits non-zero"; else pass "no backup exits non-zero"; fi
if grep -q '❌ No backups found' "$WORKDIR/out.txt"; then pass "no backup prints the existing message"; else fail "no backup prints the existing message: $(cat "$WORKDIR/out.txt" "$WORKDIR/err.txt")"; fi
if [ ! -s "$FAKE_DOCKER_LOG" ]; then pass "no backup calls no docker"; else fail "no backup calls no docker: $(calls)"; fi

# 5. A failing dump: the api is stopped and started again around the single
# psql call, the run fails and says the database is unchanged.
new_case failing-dump
dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
FAKE_MODE=fail
export FAKE_MODE
if answer y; then fail "failing dump exits non-zero"; else pass "failing dump exits non-zero"; fi
expect_log "$EXPECTED_OK_LOG"
if tail -1 "$FAKE_DOCKER_LOG" | grep -q '^compose start api$'; then pass "a failing dump still starts the api again"; else fail "a failing dump still starts the api again"; fi
if grep -q 'cannot drop constraint' "$WORKDIR/err.txt"; then pass "the psql error reaches the operator"; else fail "the psql error reaches the operator"; fi
if grep -q 'rolled back' "$WORKDIR/err.txt" && grep -q 'database is unchanged' "$WORKDIR/err.txt"; then
  pass "a failing dump says the transaction rolled back"
else
  fail "a failing dump says the transaction rolled back: $(cat "$WORKDIR/err.txt")"
fi
if grep -q '✅ Restored from' "$WORKDIR/out.txt"; then fail "a failing dump does not claim success"; else pass "a failing dump does not claim success"; fi

# 6. A stop that fails: nothing is restored, the start is still attempted, and
# the failure is reported.
new_case stop-fails
dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
FAKE_STOP_MODE=fail
export FAKE_STOP_MODE
if answer y; then fail "failing stop exits non-zero"; else pass "failing stop exits non-zero"; fi
expect_log 'compose stop api
compose start api'
if grep -q 'the database was not restored' "$WORKDIR/err.txt"; then pass "a failing stop says the database was not restored"; else fail "a failing stop says the database was not restored"; fi
unset FAKE_STOP_MODE

# 7. A start that fails after a good restore: still a failed run.
new_case start-fails
dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
FAKE_START_MODE=fail
export FAKE_START_MODE
if answer y; then fail "a failing start after a good restore exits non-zero"; else pass "a failing start after a good restore exits non-zero"; fi
expect_log "$EXPECTED_OK_LOG"
if grep -q 'Could not start' "$WORKDIR/err.txt"; then pass "a failing start is reported"; else fail "a failing start is reported"; fi
unset FAKE_START_MODE

# 8. An explicit file: positional argument and FILE= both win over the newest
# dump, the argument wins over FILE, and a missing file fails before docker.
new_case explicit-arg
dump_body CHOSEN > "$BACKUP_DIR/20200101_000000.sql"
dump_body NEWEST > "$BACKUP_DIR/20200102_000000.sql"
touch -t 202001010000 "$BACKUP_DIR/20200101_000000.sql"
touch -t 202001020000 "$BACKUP_DIR/20200102_000000.sql"
if printf 'y\n' | bash "$SUT" "$BACKUP_DIR/20200101_000000.sql" > "$WORKDIR/out.txt" 2> "$WORKDIR/err.txt"; then
  pass "positional file run exits 0"
else
  fail "positional file run exits 0"; cat "$WORKDIR/err.txt"
fi
if grep -q 'INSERT INTO t VALUES (CHOSEN);' "$FAKE_PSQL_IN" && ! grep -q 'INSERT INTO t VALUES (NEWEST);' "$FAKE_PSQL_IN"; then
  pass "the positional file is restored, not the newest dump"
else
  fail "the positional file is restored, not the newest dump"
fi
new_case explicit-env
dump_body CHOSEN > "$BACKUP_DIR/20200101_000000.sql"
dump_body NEWEST > "$BACKUP_DIR/20200102_000000.sql"
touch -t 202001010000 "$BACKUP_DIR/20200101_000000.sql"
touch -t 202001020000 "$BACKUP_DIR/20200102_000000.sql"
export FILE="$BACKUP_DIR/20200101_000000.sql"
if answer y; then pass "FILE= run exits 0"; else fail "FILE= run exits 0"; fi
unset FILE
if grep -q 'INSERT INTO t VALUES (CHOSEN);' "$FAKE_PSQL_IN" && ! grep -q 'INSERT INTO t VALUES (NEWEST);' "$FAKE_PSQL_IN"; then
  pass "FILE= is restored, not the newest dump"
else
  fail "FILE= is restored, not the newest dump"
fi
new_case arg-wins-over-file
dump_body CHOSEN > "$BACKUP_DIR/20200101_000000.sql"
dump_body OTHER > "$BACKUP_DIR/20200103_000000.sql"
touch -t 202001010000 "$BACKUP_DIR/20200101_000000.sql"
touch -t 202001030000 "$BACKUP_DIR/20200103_000000.sql"
export FILE="$BACKUP_DIR/20200103_000000.sql"
if printf 'y\n' | bash "$SUT" "$BACKUP_DIR/20200101_000000.sql" > "$WORKDIR/out.txt" 2> "$WORKDIR/err.txt"; then
  :
else
  fail "argument plus FILE exits 0"
fi
unset FILE
if grep -q 'INSERT INTO t VALUES (CHOSEN);' "$FAKE_PSQL_IN" && ! grep -q 'INSERT INTO t VALUES (OTHER);' "$FAKE_PSQL_IN"; then
  pass "the positional argument wins over FILE"
else
  fail "the positional argument wins over FILE"
fi
new_case missing-file
dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
if printf 'y\n' | bash "$SUT" "$BACKUP_DIR/nope.sql" > "$WORKDIR/out.txt" 2> "$WORKDIR/err.txt"; then
  fail "a missing dump file exits non-zero"
else
  pass "a missing dump file exits non-zero"
fi
if grep -q 'No such dump file' "$WORKDIR/err.txt" && [ ! -s "$FAKE_DOCKER_LOG" ]; then
  pass "a missing dump file fails before docker"
else
  fail "a missing dump file fails before docker"
fi

# 9. Settings overrides: PG_SERVICE, PG_USER, PG_DB, API_SERVICE.
new_case overrides
dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
PG_SERVICE=pgs PG_USER=u1 PG_DB=d1 API_SERVICE=web answer y || fail "override run exits 0"
expect_log 'compose stop web
compose exec -T pgs psql -v ON_ERROR_STOP=1 -U u1 -d d1
compose start web'

# 10. A dump without pg_dump's completion marker is truncated: it is refused
# before the prompt and before the api is stopped, with no docker call at all.
new_case truncated-dump
printf -- '-- PostgreSQL database dump\nINSERT INTO t VALUES (NEW);\n' > "$BACKUP_DIR/20200101_000000.sql"
if answer y; then fail "a dump without the completion marker exits non-zero"; else pass "a dump without the completion marker exits non-zero"; fi
if grep -q 'PostgreSQL database dump complete' "$WORKDIR/err.txt"; then
  pass "a truncated dump names the missing completion marker"
else
  fail "a truncated dump names the missing completion marker: $(cat "$WORKDIR/err.txt")"
fi
if [ ! -s "$FAKE_DOCKER_LOG" ]; then pass "a truncated dump calls no docker"; else fail "a truncated dump calls no docker: $(calls)"; fi
if grep -q 'Restoring from' "$WORKDIR/out.txt"; then fail "a truncated dump is refused before the prompt"; else pass "a truncated dump is refused before the prompt"; fi

# 11. psql exits 0 but its output has no commit marker: the input ended before
# COMMIT; (Ctrl-C on the client, a hangup, a dump cut inside a COPY), so
# nothing committed. The exit code alone must not be trusted.
new_case no-commit-marker
dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
FAKE_MODE=nomarker
export FAKE_MODE
if answer y; then fail "a stream ending before COMMIT exits non-zero"; else pass "a stream ending before COMMIT exits non-zero"; fi
unset FAKE_MODE
if grep -qi 'not committed' "$WORKDIR/err.txt" && grep -q 'database is unchanged' "$WORKDIR/err.txt"; then
  pass "a missing commit marker says the restore did not commit"
else
  fail "a missing commit marker says the restore did not commit: $(cat "$WORKDIR/err.txt")"
fi
if grep -q '✅ Restored from' "$WORKDIR/out.txt"; then fail "a missing commit marker does not claim success"; else pass "a missing commit marker does not claim success"; fi
if tail -1 "$FAKE_DOCKER_LOG" | grep -q '^compose start api$'; then pass "a not-committed run still starts the api again"; else fail "a not-committed run still starts the api again: $(calls)"; fi

# 12. COMPOSE override: every compose call (stop, exec, start) uses the
# command named by COMPOSE; unset or empty COMPOSE means the default.
new_case compose-override
dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
COMPOSE="docker compose -p ovr-test"
export COMPOSE
if answer y; then pass "a COMPOSE-override run exits 0"; else fail "a COMPOSE-override run exits 0"; cat "$WORKDIR/err.txt"; fi
unset COMPOSE
if [ "$(cat "$FAKE_DOCKER_LOG")" = "compose -p ovr-test stop api
compose -p ovr-test exec -T postgres psql -v ON_ERROR_STOP=1 -U triologue_user -d triologue
compose -p ovr-test start api" ]; then
  pass "COMPOSE is used for every compose call (stop, exec, start)"
else
  fail "COMPOSE is used for every compose call: $(calls)"
fi
new_case compose-empty
dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
COMPOSE=""
export COMPOSE
if answer y; then pass "COMPOSE empty falls back to the default"; else fail "COMPOSE empty falls back to the default"; cat "$WORKDIR/err.txt"; fi
unset COMPOSE
expect_log "$EXPECTED_OK_LOG"

# 13. The script runs from the repository root whatever the caller's cwd is.
new_case repo-root-cwd
dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
printf 'y\n' > "$WORKDIR/answer.txt"
( cd "$WORKDIR" && bash "$SUT" < "$WORKDIR/answer.txt" > "$WORKDIR/out.txt" 2> "$WORKDIR/err.txt" ) \
  || fail "run from a foreign cwd exits 0"
if [ "$(grep -c . "$FAKE_DOCKER_PWD")" = 3 ] && [ "$(sort -u "$FAKE_DOCKER_PWD" | grep -c .)" = 1 ] && [ "$(head -1 "$FAKE_DOCKER_PWD")" = "$REPO_ROOT" ]; then
  pass "every compose call runs from the repository root, not the caller's cwd"
else
  fail "every compose call runs from the repository root, not the caller's cwd: $(tr '\n' '|' < "$FAKE_DOCKER_PWD")"
fi

# 14. An interrupted run (TERM, HUP or INT while psql runs) is reported, says
# the outcome is unknown with a way to check it (not unchanged, not replaced),
# reports no success and still starts the api again. bash acts on the signal
# once the docker call returns, hence the sleep in the stub's slow mode. The
# loop runs under `set -m`: without job control a background non-interactive
# bash inherits SIGINT as ignored and refuses to trap it (the old survivor);
# with job control the INT trap is installed and the signal reaches the
# script.
set -m
for sig in TERM HUP INT; do
  new_case "signal-$sig"
  dump_body NEW > "$BACKUP_DIR/20200101_000000.sql"
  FAKE_MODE=slow
  export FAKE_MODE
  printf 'y\n' > "$WORKDIR/answer.txt"
  # The script runs with a file as stdin rather than in a pipeline: in a
  # backgrounded pipeline $! is the subshell's pid and the signal would miss the
  # script under test.
  bash "$SUT" < "$WORKDIR/answer.txt" > "$WORKDIR/out.txt" 2> "$WORKDIR/err.txt" &
  runs=$!
  tries=0
  while ! grep -q psql "$FAKE_DOCKER_LOG" && [ "$tries" -lt 100 ]; do sleep 0.1; tries=$((tries + 1)); done
  if grep -q psql "$FAKE_DOCKER_LOG"; then pass "$sig case: psql already started"; else fail "$sig case: psql already started"; fi
  kill -"$sig" "$runs" 2> /dev/null || true
  rc=0
  wait "$runs" || rc=$?
  if [ "$rc" -ne 0 ]; then pass "$sig exits non-zero"; else fail "$sig exits non-zero"; fi
  if grep -q "Interrupted by SIG$sig" "$WORKDIR/err.txt"; then pass "$sig is reported as an interruption"; else fail "$sig is reported as an interruption: $(cat "$WORKDIR/err.txt")"; fi
  if grep -q 'UNKNOWN' "$WORKDIR/err.txt" && grep -q '_prisma_migrations' "$WORKDIR/err.txt"; then
    pass "$sig mid-restore says the outcome is unknown and how to check it"
  else
    fail "$sig mid-restore says the outcome is unknown and how to check it: $(cat "$WORKDIR/err.txt")"
  fi
  if grep -q 'database is unchanged' "$WORKDIR/err.txt"; then fail "$sig does not claim the database is unchanged"; else pass "$sig does not claim the database is unchanged"; fi
  if tail -1 "$FAKE_DOCKER_LOG" | grep -q '^compose start api$'; then pass "$sig still starts the api again"; else fail "$sig still starts the api again: $(calls)"; fi
  if grep -q '✅ Restored from' "$WORKDIR/out.txt"; then fail "$sig does not claim success"; else pass "$sig does not claim success"; fi
  unset FAKE_MODE
done
set +m

echo "passed=$pass_count failed=$fail_count"
[ "$fail_count" -eq 0 ]
