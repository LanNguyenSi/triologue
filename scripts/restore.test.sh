#!/usr/bin/env bash
# Test driver for scripts/restore.sh. Uses a fake `docker` on PATH that records
# every call and captures what psql was given on stdin, so no real postgres or
# container is needed. Run directly or via CI:
#   bash scripts/restore.test.sh
#
# What it proves about the sequence (docs/deployment.md, section Restore):
# the api is stopped before anything touches the database, the dump is loaded
# by a single psql call carrying -1 (one transaction) whose stdin starts with
# the DROP SCHEMA / CREATE SCHEMA pair, and the api is started again on every
# path, including a failing dump and an interrupted run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUT="$SCRIPT_DIR/restore.sh"

WORKDIR="$(mktemp -d)"
FAKE_BIN="$WORKDIR/bin"
mkdir -p "$FAKE_BIN"
trap 'rm -rf "$WORKDIR"' EXIT

export FAKE_DOCKER_LOG="$WORKDIR/docker.log"
export FAKE_PSQL_IN="$WORKDIR/psql-stdin.sql"
PATH="$FAKE_BIN:$PATH"
export PATH

fail_count=0
pass_count=0
pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# Fake docker: records the calls, saves psql's stdin, and fails on demand
# (FAKE_MODE for psql, FAKE_STOP_MODE / FAKE_START_MODE for the api service).
cat > "$FAKE_BIN/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = compose ] && [ "$2" = exec ]; then
  cat > "$FAKE_PSQL_IN"
  case "${FAKE_MODE:-ok}" in
    ok) : ;;
    fail) echo "stub psql: ERROR: cannot drop constraint t_pkey because other objects depend on it" >&2
      exit 3 ;;
    slow) sleep 3 ;;
  esac
elif [ "$1" = compose ] && [ "$2" = stop ]; then
  if [ "${FAKE_STOP_MODE:-ok}" != ok ]; then
    echo "stub docker: cannot stop container" >&2
    exit 1
  fi
elif [ "$1" = compose ] && [ "$2" = start ]; then
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
  : > "$FAKE_PSQL_IN"
  unset FAKE_MODE FAKE_STOP_MODE FAKE_START_MODE API_SERVICE PG_SERVICE PG_USER PG_DB || true
  unset FILE || true
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
compose exec -T postgres psql -1 -v ON_ERROR_STOP=1 -U triologue_user -d triologue
compose start api'

# 1. Confirmed run: api stopped first, one psql call with -1, api started last,
# and the newest dump is the one that is loaded.
new_case success
dump_body OLD > "$BACKUP_DIR/20200101_000000.sql"
dump_body NEW > "$BACKUP_DIR/20200102_000000.sql"
touch -t 202001010000 "$BACKUP_DIR/20200101_000000.sql"
touch -t 202001020000 "$BACKUP_DIR/20200102_000000.sql"
if answer y; then pass "confirmed run exits 0"; else fail "confirmed run exits 0"; cat "$WORKDIR/err.txt"; fi
expect_log "$EXPECTED_OK_LOG"
if [ "$(grep -c psql "$FAKE_DOCKER_LOG")" = 1 ]; then pass "exactly one psql call (one transaction)"; else fail "exactly one psql call"; fi
if head -2 "$FAKE_PSQL_IN" | tr '\n' '|' | grep -q '^DROP SCHEMA public CASCADE;|CREATE SCHEMA public;|'; then
  pass "the transaction starts with DROP SCHEMA public CASCADE and CREATE SCHEMA public"
else
  fail "the transaction starts with DROP SCHEMA public CASCADE and CREATE SCHEMA public: $(head -2 "$FAKE_PSQL_IN" | tr '\n' '|')"
fi
if grep -q 'INSERT INTO t VALUES (NEW);' "$FAKE_PSQL_IN"; then pass "the newest dump is the one fed to psql"; else fail "the newest dump is the one fed to psql"; fi
if grep -q 'INSERT INTO t VALUES (OLD);' "$FAKE_PSQL_IN"; then fail "the older dump is not fed to psql"; else pass "the older dump is not fed to psql"; fi
if [ "$(grep -c 'INSERT INTO t VALUES (NEW);' "$FAKE_PSQL_IN")" = 1 ]; then pass "the dump is fed exactly once"; else fail "the dump is fed exactly once"; fi
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
compose exec -T pgs psql -1 -v ON_ERROR_STOP=1 -U u1 -d d1
compose start web'

# 10. An interrupted run (HUP or TERM while psql runs) is reported, reports no
# success and still starts the api again. bash acts on the signal once the
# docker call returns, hence the sleep in the stub's slow mode. INT is not
# exercised: a background non-interactive bash inherits SIGINT as ignored and
# refuses to trap it, so only a foreground run with a helper could test it (see
# the INT case in scripts/pre-deploy-backup.test.sh); the trap line is the same
# handler the two signals here do exercise.
for sig in TERM HUP; do
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
  if tail -1 "$FAKE_DOCKER_LOG" | grep -q '^compose start api$'; then pass "$sig still starts the api again"; else fail "$sig still starts the api again: $(calls)"; fi
  if grep -q '✅ Restored from' "$WORKDIR/out.txt"; then fail "$sig does not claim success"; else pass "$sig does not claim success"; fi
  unset FAKE_MODE
done

echo "passed=$pass_count failed=$fail_count"
[ "$fail_count" -eq 0 ]
