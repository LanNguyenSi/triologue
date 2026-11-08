#!/bin/sh
# Test driver for scripts/pre-deploy-backup.sh, written in POSIX sh because the
# script runs under busybox ash in the relay container. Uses a fake `docker` on
# PATH, so no real postgres is needed.
#   sh scripts/pre-deploy-backup.test.sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUT="$SCRIPT_DIR/pre-deploy-backup.sh"

WORKDIR="$(mktemp -d)"
FAKE_BIN="$WORKDIR/bin"
mkdir -p "$FAKE_BIN"
trap 'rm -rf "$WORKDIR"' EXIT
export FAKE_DOCKER_LOG="$WORKDIR/docker.log"
PATH="$FAKE_BIN:$PATH"
export PATH

fail_count=0
pass_count=0
pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# Real pg_dump 15 pairs a "\restrict <key>" opener with the matching
# "\unrestrict <key>" line after the completion marker; the anchored check
# pairs them.
valid_dump_body() {
  printf -- '-- PostgreSQL database dump\n'
  printf -- '\\restrict deadbeef\n'
  i=1
  while [ "$i" -le 50 ]; do
    printf -- 'INSERT INTO t VALUES (%d);\n' "$i"
    i=$((i + 1))
  done
  printf -- '-- PostgreSQL database dump complete\n--\n\n\\unrestrict deadbeef\n\n'
}

# Fake docker: FAKE_MODE selects the behaviour of `docker exec ... pg_dump`.
cat > "$FAKE_BIN/docker" <<'STUB'
#!/bin/sh
echo "$*" >> "$FAKE_DOCKER_LOG"
case "${FAKE_MODE:-ok}" in
  ok) cat "$FAKE_DUMP" ;;
  empty) : ;;
  nomarker)
    i=1
    while [ "$i" -le 100 ]; do echo "INSERT INTO t VALUES ($i);"; i=$((i + 1)); done ;;
  # Keeps the temp file open for a few seconds so a signal can hit mid-dump,
  # then completes a valid dump: a run the signal never reached succeeds, so
  # the INT case can only pass when the trap really fired.
  slow) echo "-- partial dump"; sleep 3; cat "$FAKE_DUMP" ;;
  tiny) echo "-- PostgreSQL database dump complete" ;;
  # A complete-looking dump followed by a failing exit: only the exit status
  # can reject it.
  fail) cat "$FAKE_DUMP"; echo "Error: container went away" >&2; exit 1 ;;
esac
STUB
chmod +x "$FAKE_BIN/docker"
export FAKE_DUMP="$WORKDIR/valid.sql"
valid_dump_body > "$FAKE_DUMP"

new_case() {
  BACKUP_DIR="$WORKDIR/case-$1/backups"
  export BACKUP_DIR
  mkdir -p "$BACKUP_DIR"
  : > "$FAKE_DOCKER_LOG"
  unset KEEP_PRE_DEPLOY PG_CONTAINER PG_USER PG_DB || true
}
run_sut() {
  sh "$SUT" > "$WORKDIR/out.txt" 2> "$WORKDIR/err.txt"
}
count_in() { # dir, count entries (including hidden) in dir
  n=0
  for e in "$1"/* "$1"/.[!.]*; do
    [ -e "$e" ] || [ -L "$e" ] || continue
    n=$((n + 1))
  done
  echo "$n"
}
STAMP_RE='[0-9]\{8\}_[0-9]\{6\}Z\.sql'

# 1. Success publishes exactly one dump, mode 600 in a 700 dir, with the stub's content.
new_case success
FAKE_MODE=ok; export FAKE_MODE
if run_sut; then
  d="$BACKUP_DIR/pre-deploy"
  if [ "$(count_in "$d")" = 1 ]; then pass "success leaves exactly one file"; else fail "success leaves exactly one file ($(count_in "$d"))"; fi
  # shellcheck disable=SC2012
  f=$(ls "$d")
  if echo "$f" | grep -q "^$STAMP_RE\$"; then pass "dump name is a UTC stamp .sql"; else fail "dump name is a UTC stamp .sql ($f)"; fi
  if cmp -s "$d/$f" "$FAKE_DUMP"; then pass "published dump has the dumped content"; else fail "published dump has the dumped content"; fi
  # shellcheck disable=SC2012
  if [ "$(ls -ld "$d" | cut -c1-10)" = "drwx------" ] && [ "$(ls -l "$d/$f" | cut -c1-10)" = "-rw-------" ]; then pass "dir 700 and file 600"; else fail "dir 700 and file 600"; fi
else
  fail "success run exits 0"; cat "$WORKDIR/err.txt"
fi

# 2. Docker arguments and the overrides PG_CONTAINER / PG_USER / PG_DB.
if grep -q '^exec triologue-postgres pg_dump --clean --if-exists -U triologue_user triologue$' "$FAKE_DOCKER_LOG"; then pass "default container, user and database"; else fail "default container, user and database: $(cat "$FAKE_DOCKER_LOG")"; fi
new_case overrides
PG_CONTAINER=pgx PG_USER=u1 PG_DB=db1 run_sut || fail "override run exits 0"
if grep -q '^exec pgx pg_dump --clean --if-exists -U u1 db1$' "$FAKE_DOCKER_LOG"; then pass "PG_* overrides are used"; else fail "PG_* overrides are used: $(cat "$FAKE_DOCKER_LOG")"; fi

# 3. Empty, unmarked and failing dumps fail with FATAL and leave nothing behind.
for mode in empty tiny nomarker fail; do
  new_case "bad-$mode"
  FAKE_MODE=$mode; export FAKE_MODE
  if run_sut; then
    fail "$mode dump exits non-zero"
  else
    pass "$mode dump exits non-zero"
  fi
  if grep -q '^\[backup\] FATAL' "$WORKDIR/err.txt"; then pass "$mode dump prints [backup] FATAL"; else fail "$mode dump prints [backup] FATAL"; fi
  if [ "$(count_in "$BACKUP_DIR/pre-deploy")" = 0 ]; then pass "$mode dump leaves no file (not even a temp file)"; else fail "$mode dump leaves no file"; fi
done
FAKE_MODE=ok; export FAKE_MODE

# 4. Retention: keep the newest N matching files; never touch anything else.
seed_old() {
  d="$BACKUP_DIR/pre-deploy"
  mkdir -p "$d"
  for day in 01 02 03 04 05 06 07; do : > "$d/202001${day}_120000Z.sql"; done
  echo keep > "$d/notes.txt"
  echo keep > "$d/.hidden.sql"
  echo keep > "$d/20200101_120000Z.sql.bak"
  echo keep > "$d/x20200101_120000Z.sql"
  mkdir "$d/20200102_120000Z.dir"
  echo keep > "$BACKUP_DIR/20200101_000000.sql"
  echo keep > "$BACKUP_DIR/20200101_000000.uploads.tar.gz"
}
matching() { # count files with the pre-deploy name shape
  # shellcheck disable=SC2010
  ls "$BACKUP_DIR/pre-deploy" | grep -c "^$STAMP_RE\$" || true
}
others_intact() {
  d="$BACKUP_DIR/pre-deploy"
  [ -f "$d/notes.txt" ] && [ -f "$d/.hidden.sql" ] && [ -f "$d/20200101_120000Z.sql.bak" ] \
    && [ -f "$d/x20200101_120000Z.sql" ] && [ -d "$d/20200102_120000Z.dir" ] \
    && [ -f "$BACKUP_DIR/20200101_000000.sql" ] && [ -f "$BACKUP_DIR/20200101_000000.uploads.tar.gz" ]
}
new_case retention-default
seed_old
if run_sut; then
  if [ "$(matching)" = 5 ]; then pass "default keeps 5 dumps"; else fail "default keeps 5 dumps ($(matching))"; fi
  d="$BACKUP_DIR/pre-deploy"
  if [ ! -e "$d/20200101_120000Z.sql" ] && [ ! -e "$d/20200103_120000Z.sql" ] && [ -e "$d/20200104_120000Z.sql" ] && [ -e "$d/20200107_120000Z.sql" ]; then pass "oldest dumps are dropped, newest old ones stay"; else fail "oldest dumps are dropped, newest old ones stay"; fi
  if others_intact; then pass "default run leaves non-matching files and backups/ untouched"; else fail "default run leaves non-matching files and backups/ untouched"; fi
else
  fail "retention run exits 0"
fi
new_case retention-2
seed_old
KEEP_PRE_DEPLOY=2 run_sut || fail "KEEP_PRE_DEPLOY=2 run exits 0"
if [ "$(matching)" = 2 ]; then pass "KEEP_PRE_DEPLOY=2 keeps 2 dumps"; else fail "KEEP_PRE_DEPLOY=2 keeps 2 dumps ($(matching))"; fi
if [ -e "$BACKUP_DIR/pre-deploy/20200107_120000Z.sql" ] && others_intact; then pass "newest old dump and other files survive KEEP_PRE_DEPLOY=2"; else fail "newest old dump and other files survive KEEP_PRE_DEPLOY=2"; fi
new_case retention-fewer
mkdir -p "$BACKUP_DIR/pre-deploy"; : > "$BACKUP_DIR/pre-deploy/20200101_120000Z.sql"
run_sut || fail "fewer-than-N run exits 0"
if [ "$(matching)" = 2 ]; then pass "below N nothing is deleted"; else fail "below N nothing is deleted ($(matching))"; fi

# Symlinks named like a dump are neither counted nor deleted.
new_case retention-symlink
mkdir -p "$BACKUP_DIR/pre-deploy"
echo outside > "$WORKDIR/outside-target"
ln -s "$WORKDIR/outside-target" "$BACKUP_DIR/pre-deploy/20190101_120000Z.sql"
for day in 01 02 03; do : > "$BACKUP_DIR/pre-deploy/202001${day}_120000Z.sql"; done
KEEP_PRE_DEPLOY=2 run_sut || fail "symlink run exits 0"
if [ -L "$BACKUP_DIR/pre-deploy/20190101_120000Z.sql" ] && [ -f "$WORKDIR/outside-target" ]; then pass "a symlink with a dump name is left alone"; else fail "a symlink with a dump name is left alone"; fi
if [ ! -e "$BACKUP_DIR/pre-deploy/20200101_120000Z.sql" ] && [ ! -e "$BACKUP_DIR/pre-deploy/20200102_120000Z.sql" ] && [ -e "$BACKUP_DIR/pre-deploy/20200103_120000Z.sql" ]; then pass "regular dumps still rotate next to a symlink"; else fail "regular dumps still rotate next to a symlink"; fi

# 5. A failed run does not rotate. (A prefix assignment on a shell function
# call persists in dash, so the failing mode is set in a subshell.)
new_case fail-no-rotate
seed_old
if (FAKE_MODE=fail; export FAKE_MODE; run_sut); then fail "failing run exits non-zero"; else pass "failing run exits non-zero"; fi
if [ "$(matching)" = 7 ] && others_intact; then pass "a failed run deletes nothing"; else fail "a failed run deletes nothing ($(matching))"; fi

# 6. Invalid KEEP_PRE_DEPLOY stops before docker is called; empty means default.
for v in 0 abc -1 1001 007 99999 '1 2'; do
  new_case "keep-$(echo "$v" | tr -c 'A-Za-z0-9\n' _)"
  if KEEP_PRE_DEPLOY="$v" run_sut; then fail "KEEP_PRE_DEPLOY='$v' is refused"; else pass "KEEP_PRE_DEPLOY='$v' is refused"; fi
  if [ ! -s "$FAKE_DOCKER_LOG" ] && grep -q '^\[backup\] FATAL' "$WORKDIR/err.txt"; then pass "KEEP_PRE_DEPLOY='$v' fails before docker with FATAL"; else fail "KEEP_PRE_DEPLOY='$v' fails before docker with FATAL"; fi
done
new_case keep-empty
seed_old
KEEP_PRE_DEPLOY='' run_sut || fail "empty KEEP_PRE_DEPLOY exits 0"
if [ "$(matching)" = 5 ]; then pass "empty KEEP_PRE_DEPLOY means the default 5"; else fail "empty KEEP_PRE_DEPLOY means the default 5 ($(matching))"; fi

# 7. A TERM, INT or HUP during the dump leaves no temp file behind. ash acts on
# the signal once the running docker call returns, hence the short sleep in the
# stub; without the trap the shell dies at once and the temp file stays (on
# shells that run the EXIT trap themselves, such as bash, this check cannot
# tell; it discriminates under dash and busybox).
for sig in TERM HUP; do
  new_case "signal-$sig"
  FAKE_MODE=slow; export FAKE_MODE
  sh "$SUT" > "$WORKDIR/out.txt" 2> "$WORKDIR/err.txt" < /dev/null &
  spid=$!
  tries=0
  while [ "$(count_in "$BACKUP_DIR/pre-deploy")" = 0 ] && [ "$tries" -lt 50 ]; do
    sleep 0.1; tries=$((tries + 1))
  done
  if [ "$(count_in "$BACKUP_DIR/pre-deploy")" = 1 ]; then pass "$sig case: temp file exists mid-dump"; else fail "$sig case: temp file exists mid-dump"; fi
  kill -$sig "$spid" 2> /dev/null || true
  rc=0
  wait "$spid" || rc=$?
  if [ "$rc" -ne 0 ]; then pass "$sig exits non-zero"; else fail "$sig exits non-zero"; fi
  if [ "$(count_in "$BACKUP_DIR/pre-deploy")" = 0 ]; then pass "$sig leaves no temp file"; else fail "$sig leaves no temp file ($(ls -A "$BACKUP_DIR/pre-deploy"))"; fi
done
# INT: a background non-interactive sh ignores SIGINT, so the script runs in the
# foreground here and a background helper reads its pid from the temp file name
# (.<stamp>.<pid>.sql.tmp) and sends INT. If this test shell itself was started
# with SIGINT ignored (for example from a background job) the signal has no
# effect and the case is skipped instead of failing.
new_case signal-INT
FAKE_MODE=slow; export FAKE_MODE
(
  tries=0
  while [ "$(count_in "$BACKUP_DIR/pre-deploy")" = 0 ] && [ "$tries" -lt 50 ]; do
    sleep 0.1; tries=$((tries + 1))
  done
  # shellcheck disable=SC2012
  f=$(ls -A "$BACKUP_DIR/pre-deploy" | head -1)
  f=${f%.sql.tmp}
  kill -INT "${f##*.}" 2> /dev/null || true
) &
helper=$!
rc=0
sh "$SUT" > "$WORKDIR/out.txt" 2> "$WORKDIR/err.txt" < /dev/null || rc=$?
wait "$helper" || true
if [ "$rc" -eq 0 ]; then
  echo "SKIP: INT case (SIGINT is ignored in this context, the script finished normally)"
  rm -f "$BACKUP_DIR"/pre-deploy/*.sql
else
  pass "INT exits non-zero"
  if [ "$(count_in "$BACKUP_DIR/pre-deploy")" = 0 ]; then pass "INT leaves no temp file"; else fail "INT leaves no temp file ($(ls -A "$BACKUP_DIR/pre-deploy"))"; fi
fi
FAKE_MODE=ok; export FAKE_MODE

# 8. Stale hidden temp files of this script's shape are reaped; everything else
# (fresh temp, other hidden names, regular dumps) stays.
new_case stale-sweep
d="$BACKUP_DIR/pre-deploy"
mkdir -p "$d"
: > "$d/.20200101_120000Z.111.sql.tmp"
: > "$d/.20200101_120000Z.222.sql.tmp"
: > "$d/.other.sql.tmp"
: > "$d/.20200101_120000Z.333.sql.tmp.keep"
: > "$d/.20200101_120000Z.444.sql.tmp"
: > "$d/.20200101_120000Zx.sql.tmp"
touch -t 202001011200 "$d/.20200101_120000Zx.sql.tmp" "$d/.20200101_120000Z.111.sql.tmp" "$d/.20200101_120000Z.222.sql.tmp" "$d/.other.sql.tmp" "$d/.20200101_120000Z.333.sql.tmp.keep"
# 444 keeps its fresh mtime: a concurrent run's temp file
run_sut || fail "stale sweep run exits 0"
if [ ! -e "$d/.20200101_120000Z.111.sql.tmp" ] && [ ! -e "$d/.20200101_120000Z.222.sql.tmp" ]; then pass "old temp files of the script's shape are removed"; else fail "old temp files of the script's shape are removed"; fi
if [ -e "$d/.20200101_120000Z.444.sql.tmp" ]; then pass "a fresh temp file is kept"; else fail "a fresh temp file is kept"; fi
if [ -e "$d/.other.sql.tmp" ] && [ -e "$d/.20200101_120000Z.333.sql.tmp.keep" ] && [ -e "$d/.20200101_120000Zx.sql.tmp" ]; then pass "old hidden files of another shape are kept"; else fail "old hidden files of another shape are kept"; fi

# 9. Anchored completion rule (scripts/dump-complete.sh, shared with
# backup.sh): a dump that is not complete at its end is refused. Refused:
# the phrase only inside a comment or inside data with no whole completion
# line, a data line (quoting the phrase) after the last completion line, a
# \restrict opener without its matching \unrestrict line, a mismatched key.
# Published: the matching pair.
write_dump_shape() {
  {
    printf -- '-- PostgreSQL database dump\n'
    case "$1" in
      phrase_in_comment)
        # The completion line quoted inside a comment: an unanchored match
        # exists, no whole line does, and every line passes the trailing
        # filter, so only the -x anchors refuse this.
        printf -- '-- a chat message quoted: -- PostgreSQL database dump complete\n'
        i=1
        while [ "$i" -le 40 ]; do
          printf -- '-- padding comment line %02d for the 1024 byte size floor\n' "$i"
          i=$((i + 1))
        done
        ;;
      phrase_in_data)
        printf -- 'COPY messages (content) FROM stdin;\n'
        printf -- 'chat message: PostgreSQL database dump complete\n'
        printf -- '\\.\n'
        i=1
        while [ "$i" -le 50 ]; do printf -- 'INSERT INTO t VALUES (%d);\n' "$i"; i=$((i + 1)); done
        ;;
      data_after_marker)
        printf -- '\\restrict deadbeef\n'
        i=1
        while [ "$i" -le 50 ]; do printf -- 'INSERT INTO t VALUES (%d);\n' "$i"; i=$((i + 1)); done
        printf -- '-- PostgreSQL database dump complete\n'
        printf -- 'INSERT INTO t VALUES (51);\n'
        printf -- '-- quoted completion line: -- PostgreSQL database dump complete\n'
        printf -- '--\n\n\\unrestrict deadbeef\n\n'
        ;;
      restrict_unpaired)
        printf -- '\\restrict deadbeef\n'
        i=1
        while [ "$i" -le 50 ]; do printf -- 'INSERT INTO t VALUES (%d);\n' "$i"; i=$((i + 1)); done
        printf -- '-- PostgreSQL database dump complete\n--\n\n\n'
        ;;
      restrict_wrong_key)
        printf -- '\\restrict deadbeef\n'
        i=1
        while [ "$i" -le 50 ]; do printf -- 'INSERT INTO t VALUES (%d);\n' "$i"; i=$((i + 1)); done
        printf -- '-- PostgreSQL database dump complete\n--\n\n\\unrestrict otherkey\n\n'
        ;;
      pair_ok)
        valid_dump_body
        ;;
    esac
  } > "$FAKE_DUMP"
}
FAKE_MODE=ok; export FAKE_MODE
for shape in phrase_in_comment phrase_in_data data_after_marker restrict_unpaired restrict_wrong_key pair_ok; do
  new_case "dump-$shape"
  write_dump_shape "$shape"
  rc=0
  run_sut || rc=$?
  d="$BACKUP_DIR/pre-deploy"
  case "$shape" in
    pair_ok)
      if [ "$rc" -eq 0 ] && [ "$(count_in "$d")" = 1 ]; then pass "a dump with a matching restrict/unrestrict key pair is published"; else fail "a dump with a matching restrict/unrestrict key pair is published (rc=$rc files=$(count_in "$d"))"; fi
      ;;
    *)
      if [ "$rc" -ne 0 ] && [ "$(count_in "$d")" = 0 ]; then pass "a $shape dump is refused"; else fail "a $shape dump is refused (rc=$rc files=$(count_in "$d"))"; fi
      if grep -q '^\[backup\] FATAL' "$WORKDIR/err.txt"; then pass "$shape prints [backup] FATAL"; else fail "$shape prints [backup] FATAL"; fi
      ;;
  esac
done
valid_dump_body > "$FAKE_DUMP"

echo "passed=$pass_count failed=$fail_count"
[ "$fail_count" -eq 0 ]
