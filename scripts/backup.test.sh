#!/usr/bin/env bash
# Test driver for scripts/backup.sh. Uses a fake `docker` on PATH so no real
# postgres/container is needed. Run directly or via CI:
#   bash scripts/backup.test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"

WORKDIR="$(mktemp -d)"
FAKE_BIN="$WORKDIR/bin"
LOGS="$WORKDIR/logs"
mkdir -p "$FAKE_BIN" "$LOGS"

# Safety: never run the script under test against the real HOME.
export HOME="$WORKDIR/home"
mkdir -p "$HOME"
case "$HOME" in
  "$WORKDIR"/*) ;;
  *) echo "refusing to run: HOME is not inside the scratch dir" >&2; exit 2 ;;
esac

# Fixtures for the file archives: an uploads directory on the host and the
# content of /app/data that the fake `docker exec ... tar` streams back.
UPLOADS_FIXTURE="$WORKDIR/uploads"
API_DATA_FIXTURE="$WORKDIR/api_data_src"
mkdir -p "$UPLOADS_FIXTURE/sub" "$API_DATA_FIXTURE"
echo "attachment one" > "$UPLOADS_FIXTURE/a.txt"
echo "attachment two" > "$UPLOADS_FIXTURE/sub/b.txt"
echo "state" > "$API_DATA_FIXTURE/state.json"
export UPLOADS_DIR="$UPLOADS_FIXTURE"
export FAKE_API_SRC="$API_DATA_FIXTURE"
export FAKE_DOCKER_LOG="$WORKDIR/docker.log"
export FAKE_API_MODE=ok

fail_count=0
pass_count=0

pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# A realistic pg_dump 15.18 tail: the completion marker sits exactly 5 lines
# from EOF because of the trailing \unrestrict block newer pg_dump versions
# emit ("--" separator, blank line, \unrestrict line, trailing blank). This
# is the exact shape that left the old `tail -n 5` marker check with zero
# margin, and that a `tail -n 4` regression must still catch as a marker hit
# while a broader window (or a whole-file grep) does.
valid_dump_body() {
  printf -- '-- PostgreSQL database dump\n'
  printf -- '-- some SQL statements here\n'
  for i in $(seq 1 50); do
    printf -- 'INSERT INTO t VALUES (%d);\n' "$i"
  done
  printf -- '-- PostgreSQL database dump complete\n'
  printf -- '--\n'
  printf -- '\n'
  printf -- '\\unrestrict deadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234\n'
  printf -- '\n'
}

# Write the valid dump body to a fixture file; the fake docker cats it back
# rather than re-embedding it into a heredoc.
write_valid_fixture() {
  valid_dump_body > "$WORKDIR/valid_dump.sql"
}

write_fake_docker() {
  local mode="$1"
  cat > "$FAKE_BIN/docker" <<EOF
#!/usr/bin/env bash
mode="$mode"
echo "\$*" >> "\$FAKE_DOCKER_LOG"
# \`docker exec <container> tar ...\` is the api_data archive; everything else
# is the pg_dump call.
if [ "\$1" = exec ] && [ "\$3" = tar ]; then
  case "\${FAKE_API_MODE:-ok}" in
    ok) exec tar -C "\$FAKE_API_SRC" -czf - . ;;
    fail) echo "tar: container not running" >&2; exit 1 ;;
    garbage) printf 'not a tar archive at all\n'; exit 0 ;;
    partial) tar -C "\$FAKE_API_SRC" -czf - . ; echo "tar: file changed as we read it" >&2; exit 2 ;;
    *) exit 2 ;;
  esac
fi
case "\$mode" in
  fail)
    echo "pg_dump: fatal error" >&2
    exit 1
    ;;
  empty)
    exit 0
    ;;
  no_marker)
    printf -- '-- PostgreSQL database dump\n'
    for i in \$(seq 1 50); do printf -- 'INSERT INTO t VALUES (%d);\n' "\$i"; done
    exit 0
    ;;
  valid)
    cat "$WORKDIR/valid_dump.sql"
    exit 0
    ;;
  *)
    echo "unknown fake docker mode: \$mode" >&2
    exit 2
    ;;
esac
EOF
  chmod +x "$FAKE_BIN/docker"
}

run_backup() {
  local backup_dir="$1"
  PATH="$FAKE_BIN:$PATH" BACKUP_DIR="$backup_dir" PG_CONTAINER=x PG_USER=x PG_DB=x \
    "$BACKUP_SCRIPT"
}

# --- (a) docker failure -> exit 1, no .sql published, no .tmp left ---
{
  d="$WORKDIR/case_a"
  mkdir -p "$d"
  write_valid_fixture
  write_fake_docker fail
  rc=0
  run_backup "$d" >/dev/null 2>&1 || rc=$?
  sql_count=$(find "$d" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
  tmp_count=$(find "$d" -maxdepth 1 -name '.*.tmp' | wc -l | tr -d ' ')
  if [ "$rc" -ne 0 ] && [ "$sql_count" -eq 0 ] && [ "$tmp_count" -eq 0 ]; then
    pass "(a) docker failure -> exit 1, no .sql, no .tmp"
  else
    fail "(a) docker failure: rc=$rc sql_count=$sql_count tmp_count=$tmp_count"
  fi
}

# --- (b) empty output -> refused ---
{
  d="$WORKDIR/case_b"
  mkdir -p "$d"
  write_fake_docker empty
  rc=0
  run_backup "$d" >/dev/null 2>&1 || rc=$?
  sql_count=$(find "$d" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
  if [ "$rc" -ne 0 ] && [ "$sql_count" -eq 0 ]; then
    pass "(b) empty output -> refused"
  else
    fail "(b) empty output: rc=$rc sql_count=$sql_count"
  fi
}

# --- (c) output without completion marker -> refused ---
{
  d="$WORKDIR/case_c"
  mkdir -p "$d"
  write_fake_docker no_marker
  rc=0
  run_backup "$d" >/dev/null 2>&1 || rc=$?
  sql_count=$(find "$d" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
  if [ "$rc" -ne 0 ] && [ "$sql_count" -eq 0 ]; then
    pass "(c) output without completion marker -> refused"
  else
    fail "(c) output without completion marker: rc=$rc sql_count=$sql_count"
  fi
}

# --- (d) valid dump (with trailing \unrestrict line after marker) -> published, perms 0600 ---
{
  d="$WORKDIR/case_d"
  mkdir -p "$d"
  write_valid_fixture
  write_fake_docker valid
  rc=0
  run_backup "$d" >/dev/null 2>&1 || rc=$?
  sql_file=$(find "$d" -maxdepth 1 -name '*.sql' | head -1)
  if [ "$rc" -eq 0 ] && [ -n "$sql_file" ]; then
    # GNU stat first (-c fails on BSD/macOS, which then falls back to -f);
    # the reverse order breaks on GNU, where -f means filesystem status and succeeds.
    perms=$(stat -c '%a' "$sql_file" 2>/dev/null || stat -f '%Lp' "$sql_file" 2>/dev/null)
    if [ "$perms" = "600" ]; then
      pass "(d) valid dump -> published with 0600 perms"
    else
      fail "(d) valid dump published but perms=$perms (want 600)"
    fi
  else
    fail "(d) valid dump: rc=$rc sql_file='$sql_file'"
  fi
}

# --- (e) rotation keeps KEEP_FILES newest ---
{
  d="$WORKDIR/case_e"
  mkdir -p "$d"
  # Seed 5 pre-existing .sql files with distinct mtimes, oldest first.
  for i in 1 2 3 4 5; do
    f="$d/2020010${i}_000000.sql"
    echo "seed $i" > "$f"
    touch -t "20200101010${i}" "$f"
  done
  write_valid_fixture
  write_fake_docker valid
  rc=0
  PATH="$FAKE_BIN:$PATH" BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x KEEP_FILES=3 KEEP_DAYS=3650 \
    "$BACKUP_SCRIPT" >/dev/null 2>&1 || rc=$?
  remaining=$(find "$d" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
  # 5 seeded + 1 new = 6, KEEP_FILES=3 -> 3 newest survive (the new one plus
  # the two most recently seeded).
  newest_seed_gone=1
  [ -f "$d/2020010101_000000.sql" ] && newest_seed_gone=0
  if [ "$rc" -eq 0 ] && [ "$remaining" -eq 3 ] && [ "$newest_seed_gone" -eq 1 ]; then
    pass "(e) rotation keeps KEEP_FILES newest"
  else
    fail "(e) rotation: rc=$rc remaining=$remaining (want 3), oldest-seed-gone=$newest_seed_gone"
  fi
}

count_files() { find "$1" -maxdepth 1 -name "$2" | wc -l | tr -d ' '; }
perms_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }

# Seed N old sets (sql + both archives) with distinct, old mtimes.
seed_sets() {
  local dir="$1" n="$2" i f
  for i in $(seq 1 "$n"); do
    for kind in sql uploads.tar.gz api_data.tar.gz; do
      f="$dir/2020010${i}_000000.$kind"
      echo "seed $i" > "$f"
      touch -t "20200101010${i}" "$f"
    done
  done
}

# --- (f) valid run -> sql + uploads + api_data archives, 0600, right content ---
{
  d="$WORKDIR/case_f"
  mkdir -p "$d"
  write_valid_fixture
  write_fake_docker valid
  rc=0
  run_backup "$d" >/dev/null 2>&1 || rc=$?
  up=$(find "$d" -maxdepth 1 -name '*.uploads.tar.gz' | head -1)
  da=$(find "$d" -maxdepth 1 -name '*.api_data.tar.gz' | head -1)
  if [ "$rc" -eq 0 ] && [ -n "$up" ] && [ -n "$da" ] \
    && tar -tzf "$up" | grep -q 'sub/b.txt' \
    && tar -tzf "$da" | grep -q 'state.json' \
    && [ "$(perms_of "$up")" = "600" ] && [ "$(perms_of "$da")" = "600" ]; then
    pass "(f) valid run -> uploads and api_data archives with content, 0600"
  else
    fail "(f) valid run archives: rc=$rc up='$up' da='$da'"
  fi
}

# --- (g) uploads dir missing -> non-zero, no uploads archive, no tmp, rotation skipped ---
{
  d="$WORKDIR/case_g"
  mkdir -p "$d"
  seed_sets "$d" 4
  write_valid_fixture
  write_fake_docker valid
  rc=0
  UPLOADS_DIR="$WORKDIR/does-not-exist" PATH="$FAKE_BIN:$PATH" BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x KEEP_FILES=1 KEEP_DAYS=3650 \
    "$BACKUP_SCRIPT" >/dev/null 2>&1 || rc=$?
  up_count=$(count_files "$d" '*.uploads.tar.gz')
  tmp_count=$(count_files "$d" '.*.tmp')
  da_count=$(count_files "$d" '*.api_data.tar.gz')
  # 4 seeded uploads archives remain (no rotation), none new; api_data still got its new archive (5).
  if [ "$rc" -ne 0 ] && [ "$up_count" -eq 4 ] && [ "$tmp_count" -eq 0 ] && [ "$da_count" -eq 5 ]; then
    pass "(g) uploads failure -> exit non-zero, nothing published for uploads, rotation skipped"
  else
    fail "(g) uploads failure: rc=$rc up=$up_count tmp=$tmp_count da=$da_count"
  fi
}

# --- (h) api_data tar fails -> non-zero, no api_data archive, no tmp, rotation skipped ---
{
  d="$WORKDIR/case_h"
  mkdir -p "$d"
  seed_sets "$d" 4
  write_valid_fixture
  write_fake_docker valid
  rc=0
  FAKE_API_MODE=fail PATH="$FAKE_BIN:$PATH" BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x KEEP_FILES=1 KEEP_DAYS=3650 \
    "$BACKUP_SCRIPT" >/dev/null 2>&1 || rc=$?
  da_count=$(count_files "$d" '*.api_data.tar.gz')
  tmp_count=$(count_files "$d" '.*.tmp')
  sql_count=$(count_files "$d" '*.sql')
  up_count=$(count_files "$d" '*.uploads.tar.gz')
  if [ "$rc" -ne 0 ] && [ "$da_count" -eq 4 ] && [ "$tmp_count" -eq 0 ] && [ "$sql_count" -eq 5 ] && [ "$up_count" -eq 5 ]; then
    pass "(h) api_data failure -> exit non-zero, nothing published for api_data, rotation skipped"
  else
    fail "(h) api_data failure: rc=$rc da=$da_count tmp=$tmp_count sql=$sql_count up=$up_count"
  fi
}

# --- (i) api_data output that is not a tar archive -> refused ---
{
  d="$WORKDIR/case_i"
  mkdir -p "$d"
  write_valid_fixture
  write_fake_docker valid
  rc=0
  FAKE_API_MODE=garbage run_backup "$d" >/dev/null 2>&1 || rc=$?
  da_count=$(count_files "$d" '*.api_data.tar.gz')
  tmp_count=$(count_files "$d" '.*.tmp')
  if [ "$rc" -ne 0 ] && [ "$da_count" -eq 0 ] && [ "$tmp_count" -eq 0 ]; then
    pass "(i) non-tar api_data output -> refused"
  else
    fail "(i) non-tar api_data output: rc=$rc da=$da_count tmp=$tmp_count"
  fi
}

# --- (j) rotation covers the new archives with KEEP_FILES ---
{
  d="$WORKDIR/case_j"
  mkdir -p "$d"
  seed_sets "$d" 5
  write_valid_fixture
  write_fake_docker valid
  rc=0
  PATH="$FAKE_BIN:$PATH" BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x KEEP_FILES=3 KEEP_DAYS=3650 \
    "$BACKUP_SCRIPT" >/dev/null 2>&1 || rc=$?
  ok=1
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    [ "$(count_files "$d" "*.$kind")" -eq 3 ] || ok=0
    [ -f "$d/20200101_000000.$kind" ] && ok=0
  done
  if [ "$rc" -eq 0 ] && [ "$ok" -eq 1 ]; then
    pass "(j) rotation keeps KEEP_FILES newest of each archive kind"
  else
    fail "(j) archive rotation: rc=$rc ok=$ok"
  fi
}

# --- (k) rotation by age covers the new archives ---
{
  d="$WORKDIR/case_k"
  mkdir -p "$d"
  seed_sets "$d" 2
  write_valid_fixture
  write_fake_docker valid
  rc=0
  PATH="$FAKE_BIN:$PATH" BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x KEEP_FILES=50 KEEP_DAYS=30 \
    "$BACKUP_SCRIPT" >/dev/null 2>&1 || rc=$?
  ok=1
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    [ "$(count_files "$d" "*.$kind")" -eq 1 ] || ok=0
  done
  if [ "$rc" -eq 0 ] && [ "$ok" -eq 1 ]; then
    pass "(k) KEEP_DAYS removes old archives of every kind"
  else
    fail "(k) age rotation: rc=$rc ok=$ok"
  fi
}

# --- (l) off-host hook set -> called once after success with the new set, rotation still runs ---
{
  d="$WORKDIR/case_l"
  mkdir -p "$d"
  seed_sets "$d" 4
  write_valid_fixture
  write_fake_docker valid
  hook_log="$WORKDIR/hook_l.log"
  : > "$hook_log"
  # shellcheck disable=SC2016  # the hook text must reach sh -c unexpanded
  hook='for f in "$@"; do [ -s "$f" ] || exit 9; done; printf "%s\n" "$BACKUP_TS" "$@" >> "'"$hook_log"'"'
  rc=0
  BACKUP_REMOTE_CMD="$hook" PATH="$FAKE_BIN:$PATH" BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x KEEP_FILES=2 KEEP_DAYS=3650 \
    "$BACKUP_SCRIPT" >/dev/null 2>&1 || rc=$?
  calls=$(grep -c '^[0-9]\{8\}_[0-9]\{6\}$' "$hook_log" || true)
  args=$(grep -c '/20[0-9]\{6\}_[0-9]\{6\}\.\(sql\|uploads\.tar\.gz\|api_data\.tar\.gz\)$' "$hook_log" || true)
  old_gone=1
  [ -f "$d/20200101_000000.sql" ] && old_gone=0
  if [ "$rc" -eq 0 ] && [ "$calls" -eq 1 ] && [ "$args" -eq 3 ] && [ "$old_gone" -eq 1 ]; then
    pass "(l) BACKUP_REMOTE_CMD called once with the three new files, then rotation runs"
  else
    fail "(l) off-host hook: rc=$rc calls=$calls args=$args old_gone=$old_gone"
  fi
}

# --- (m) off-host hook fails -> non-zero, local set kept, rotation skipped ---
{
  d="$WORKDIR/case_m"
  mkdir -p "$d"
  seed_sets "$d" 4
  write_valid_fixture
  write_fake_docker valid
  rc=0
  BACKUP_REMOTE_CMD='exit 7' PATH="$FAKE_BIN:$PATH" BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x KEEP_FILES=1 KEEP_DAYS=0 \
    "$BACKUP_SCRIPT" >/dev/null 2>&1 || rc=$?
  ok=1
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    # 4 seeded + 1 new, nothing deleted even with KEEP_FILES=1 and KEEP_DAYS=0.
    [ "$(count_files "$d" "*.$kind")" -eq 5 ] || ok=0
  done
  if [ "$rc" -ne 0 ] && [ "$ok" -eq 1 ]; then
    pass "(m) failing off-host command -> exit non-zero, nothing rotated away"
  else
    fail "(m) failing off-host command: rc=$rc ok=$ok"
  fi
}

# --- (n) archive failure -> off-host command is not called ---
{
  d="$WORKDIR/case_n"
  mkdir -p "$d"
  write_valid_fixture
  write_fake_docker valid
  hook_marker="$WORKDIR/hook_n.called"
  rc=0
  FAKE_API_MODE=fail BACKUP_REMOTE_CMD='touch "'"$hook_marker"'"' run_backup "$d" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 0 ] && [ ! -e "$hook_marker" ]; then
    pass "(n) incomplete local set -> off-host command not called"
  else
    fail "(n) hook after failed archive: rc=$rc marker_exists=$([ -e "$hook_marker" ] && echo yes || echo no)"
  fi
}

# --- (o) hook unset or empty -> default behaviour, exit 0, nothing extra ---
{
  d="$WORKDIR/case_o"
  mkdir -p "$d"
  write_valid_fixture
  write_fake_docker valid
  rc_unset=0
  run_backup "$d" >/dev/null 2>&1 || rc_unset=$?
  rc_empty=0
  BACKUP_REMOTE_CMD='' run_backup "$d" >/dev/null 2>&1 || rc_empty=$?
  if [ "$rc_unset" -eq 0 ] && [ "$rc_empty" -eq 0 ]; then
    pass "(o) hook unset or empty -> backup succeeds as before"
  else
    fail "(o) hook unset/empty: rc_unset=$rc_unset rc_empty=$rc_empty"
  fi
}

# --- (p) API_CONTAINER / API_DATA_PATH select the container and path ---
{
  d="$WORKDIR/case_p"
  mkdir -p "$d"
  write_valid_fixture
  write_fake_docker valid
  : > "$FAKE_DOCKER_LOG"
  rc=0
  API_CONTAINER=my-api API_DATA_PATH=/srv/data run_backup "$d" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ] && grep -q '^exec my-api tar -C /srv/data ' "$FAKE_DOCKER_LOG"; then
    pass "(p) API_CONTAINER and API_DATA_PATH are honoured"
  else
    fail "(p) api container selection: rc=$rc log=$(cat "$FAKE_DOCKER_LOG")"
  fi
}

# --- (q) uploads tar that exits 0 but writes a non-tar file -> refused ---
{
  d="$WORKDIR/case_q"
  mkdir -p "$d" "$WORKDIR/faketar"
  real_tar="$(command -v tar)"
  # Only the uploads call (tar -C <dir> -czf <file> .) is corrupted; every
  # other tar call (tar -t, the api_data stream) goes to the real tar.
  cat > "$WORKDIR/faketar/tar" <<TAREOF
#!/usr/bin/env bash
if [ "\$1" = -C ] && [ "\$3" = -czf ] && [ "\$4" != - ]; then
  printf 'not a tar archive\n' > "\$4"
  exit 0
fi
exec "$real_tar" "\$@"
TAREOF
  chmod +x "$WORKDIR/faketar/tar"
  write_valid_fixture
  write_fake_docker valid
  rc=0
  PATH="$WORKDIR/faketar:$FAKE_BIN:$PATH" BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x \
    "$BACKUP_SCRIPT" >/dev/null 2>&1 || rc=$?
  up_count=$(count_files "$d" '*.uploads.tar.gz')
  tmp_count=$(count_files "$d" '.*.tmp')
  if [ "$rc" -ne 0 ] && [ "$up_count" -eq 0 ] && [ "$tmp_count" -eq 0 ]; then
    pass "(q) corrupt uploads archive -> refused"
  else
    fail "(q) corrupt uploads archive: rc=$rc up=$up_count tmp=$tmp_count"
  fi
}

# --- (r) api_data tar writes a valid archive but exits non-zero -> refused ---
# GNU tar reports unreadable or changed files this way: the archive is
# complete enough for `tar -t`, so the exit code is the only guard.
# (Real GNU tar exits 1 for a changed file and 2 for an unreadable one; the
# fakes here pair message and code loosely, backup.sh only needs a non-zero exit.)
{
  d="$WORKDIR/case_r"
  mkdir -p "$d"
  seed_sets "$d" 4
  write_valid_fixture
  write_fake_docker valid
  rc=0
  FAKE_API_MODE=partial PATH="$FAKE_BIN:$PATH" BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x KEEP_FILES=1 KEEP_DAYS=3650 \
    "$BACKUP_SCRIPT" >/dev/null 2>&1 || rc=$?
  da_count=$(count_files "$d" '*.api_data.tar.gz')
  tmp_count=$(count_files "$d" '.*.tmp')
  sql_count=$(count_files "$d" '*.sql')
  up_count=$(count_files "$d" '*.uploads.tar.gz')
  if [ "$rc" -eq 1 ] && [ "$da_count" -eq 4 ] && [ "$tmp_count" -eq 0 ] && [ "$sql_count" -eq 5 ] && [ "$up_count" -eq 5 ]; then
    pass "(r) api_data tar with a valid archive but non-zero exit -> exit 1, not published, rotation skipped"
  else
    fail "(r) api_data partial: rc=$rc da=$da_count tmp=$tmp_count sql=$sql_count up=$up_count"
  fi
}

# --- (s) uploads tar writes a valid archive but exits non-zero -> refused ---
{
  d="$WORKDIR/case_s"
  mkdir -p "$d" "$WORKDIR/faketar_s"
  seed_sets "$d" 4
  real_tar="$(command -v tar)"
  # Only the uploads call runs the real tar and then reports failure, like a
  # tar that hit an unreadable file; every other tar call is the real one.
  cat > "$WORKDIR/faketar_s/tar" <<TAREOF
#!/usr/bin/env bash
if [ "\$1" = -C ] && [ "\$3" = -czf ] && [ "\$4" != - ]; then
  "$real_tar" "\$@"
  echo "tar: some/file: Cannot open: Permission denied" >&2
  exit 1
fi
exec "$real_tar" "\$@"
TAREOF
  chmod +x "$WORKDIR/faketar_s/tar"
  write_valid_fixture
  write_fake_docker valid
  rc=0
  PATH="$WORKDIR/faketar_s:$FAKE_BIN:$PATH" BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x KEEP_FILES=1 KEEP_DAYS=3650 \
    "$BACKUP_SCRIPT" >/dev/null 2>&1 || rc=$?
  up_count=$(count_files "$d" '*.uploads.tar.gz')
  tmp_count=$(count_files "$d" '.*.tmp')
  sql_count=$(count_files "$d" '*.sql')
  da_count=$(count_files "$d" '*.api_data.tar.gz')
  if [ "$rc" -eq 1 ] && [ "$up_count" -eq 4 ] && [ "$tmp_count" -eq 0 ] && [ "$sql_count" -eq 5 ] && [ "$da_count" -eq 5 ]; then
    pass "(s) uploads tar with a valid archive but non-zero exit -> exit 1, not published, rotation skipped"
  else
    fail "(s) uploads partial: rc=$rc up=$up_count tmp=$tmp_count sql=$sql_count da=$da_count"
  fi
}

# --- retention validation helpers ---
# Directory state an untouched run must not change: the names present and the
# directory mode (a run chmods BACKUP_DIR to 700).
dir_state() {
  find "$1" -maxdepth 1 -print | sort
  perms_of "$1"
}

# A dir whose contents show whether the script got to work at all: one stale
# temp file older than a day (the stale-tmp reap deletes it), one old set per
# kind (rotation deletes it) and a mode of 755 (the run would chmod it to 700).
seed_evidence_dir() {
  local d="$1" f kind
  mkdir -p "$d"
  chmod 755 "$d"
  f="$d/.20200101_000000.sql.tmp"
  echo "stale" > "$f"
  touch -t 202001010100 "$f"
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    f="$d/20200101_000000.$kind"
    echo "seed" > "$f"
    touch -t 202001010100 "$f"
  done
}

# Run the script with the given VAR=value settings plus the usual fakes. Sets
# run_rc, run_log and docker_calls (lines the fake docker logged, 0 when the
# script stopped before the dump). The log goes to its own subdirectory so a
# case that watches the scratch dir does not see it.
run_with_settings() {
  local d="$1"
  shift
  : > "$FAKE_DOCKER_LOG"
  run_log="$LOGS/run_log"
  run_rc=0
  PATH="$FAKE_BIN:$PATH" env BACKUP_DIR="$d" "$@" PG_CONTAINER=x PG_USER=x PG_DB=x \
    "$BACKUP_SCRIPT" >"$run_log" 2>&1 || run_rc=$?
  docker_calls=$(grep -c . "$FAKE_DOCKER_LOG" || true)
}

# N sets with the current mtime: only the KEEP_FILES count can reduce them,
# the KEEP_DAYS age pass leaves files this new alone.
seed_fresh_sets() {
  local dir="$1" n="$2" i kind f
  for i in $(seq 1 "$n"); do
    for kind in sql uploads.tar.gz api_data.tar.gz; do
      f="$dir/$(printf '202401%02d_000000' "$i").$kind"
      echo "seed $i" > "$f"
    done
  done
}

# --- (t) invalid KEEP_FILES -> non-zero before the dump, the mkdir and any delete ---
{
  ok=1
  detail=""
  i=0
  for bad in 0 -1 abc 1.5 "1 2"; do
    i=$((i + 1))
    d="$WORKDIR/case_t$i"
    seed_evidence_dir "$d"
    before=$(dir_state "$d")
    run_with_settings "$d" KEEP_FILES="$bad" KEEP_DAYS=3650
    [ "$run_rc" -ne 0 ] || { ok=0; detail="$detail KEEP_FILES=$bad:rc=$run_rc"; }
    grep -q "KEEP_FILES must be a positive integer" "$run_log" \
      || { ok=0; detail="$detail KEEP_FILES=$bad:message"; }
    [ "$docker_calls" -eq 0 ] || { ok=0; detail="$detail KEEP_FILES=$bad:docker_calls=$docker_calls"; }
    [ "$(dir_state "$d")" = "$before" ] || { ok=0; detail="$detail KEEP_FILES=$bad:dir-changed"; }
  done
  if [ "$ok" -eq 1 ]; then
    pass "(t) KEEP_FILES 0, -1, abc, 1.5 and '1 2' -> non-zero naming KEEP_FILES, docker untouched, dir untouched"
  else
    fail "(t) invalid KEEP_FILES:$detail"
  fi
}

# --- (u) invalid KEEP_DAYS -> same; negative counts even though 0 would be valid ---
{
  ok=1
  detail=""
  i=0
  for bad in -1 abc 1.5 "1 2"; do
    i=$((i + 1))
    d="$WORKDIR/case_u$i"
    seed_evidence_dir "$d"
    before=$(dir_state "$d")
    run_with_settings "$d" KEEP_FILES=3 KEEP_DAYS="$bad"
    [ "$run_rc" -ne 0 ] || { ok=0; detail="$detail KEEP_DAYS=$bad:rc=$run_rc"; }
    grep -q "KEEP_DAYS must be a non-negative integer" "$run_log" \
      || { ok=0; detail="$detail KEEP_DAYS=$bad:message"; }
    [ "$docker_calls" -eq 0 ] || { ok=0; detail="$detail KEEP_DAYS=$bad:docker_calls=$docker_calls"; }
    [ "$(dir_state "$d")" = "$before" ] || { ok=0; detail="$detail KEEP_DAYS=$bad:dir-changed"; }
  done
  if [ "$ok" -eq 1 ]; then
    pass "(u) KEEP_DAYS -1, abc, 1.5 and '1 2' -> non-zero naming KEEP_DAYS, docker untouched, dir untouched"
  else
    fail "(u) invalid KEEP_DAYS:$detail"
  fi
}

# --- (v) KEEP_DAYS=0 is valid: rotation runs and keeps the fresh set ---
{
  d="$WORKDIR/case_v"
  mkdir -p "$d"
  seed_sets "$d" 2
  write_valid_fixture
  write_fake_docker valid
  run_with_settings "$d" KEEP_FILES=50 KEEP_DAYS=0
  ok=1
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    [ "$(count_files "$d" "*.$kind")" -eq 1 ] || ok=0
  done
  grep -q 'retention KEEP_FILES=50 KEEP_DAYS=0' "$run_log" || ok=0
  if [ "$run_rc" -eq 0 ] && [ "$ok" -eq 1 ]; then
    pass "(v) KEEP_DAYS=0 accepted -> everything older than a day rotated away, fresh set kept"
  else
    fail "(v) KEEP_DAYS=0: rc=$run_rc ok=$ok out=$(cat "$run_log")"
  fi
}

# --- (w) empty KEEP_FILES and KEEP_DAYS mean unset -> the default 10 wins ---
{
  d="$WORKDIR/case_w"
  mkdir -p "$d"
  seed_fresh_sets "$d" 12
  write_valid_fixture
  write_fake_docker valid
  run_with_settings "$d" KEEP_FILES= KEEP_DAYS=
  ok=1
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    [ "$(count_files "$d" "*.$kind")" -eq 10 ] || ok=0
  done
  grep -q 'retention KEEP_FILES=10 KEEP_DAYS=10' "$run_log" || ok=0
  if [ "$run_rc" -eq 0 ] && [ "$ok" -eq 1 ]; then
    pass "(w) empty KEEP_FILES and KEEP_DAYS -> default 10 per kind (13 sets become 10)"
  else
    fail "(w) empty retention settings: rc=$run_rc ok=$ok counts=$(for k in sql uploads.tar.gz api_data.tar.gz; do printf '%s=%s ' "$k" "$(count_files "$d" "*.$k")"; done) out=$(cat "$run_log")"
  fi
}

# --- (x) leading zeros are accepted and read as decimal (08 means 8) ---
{
  d="$WORKDIR/case_x"
  mkdir -p "$d"
  seed_fresh_sets "$d" 10
  write_valid_fixture
  write_fake_docker valid
  run_with_settings "$d" KEEP_FILES=08 KEEP_DAYS=0010
  ok=1
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    [ "$(count_files "$d" "*.$kind")" -eq 8 ] || ok=0
  done
  grep -q 'retention KEEP_FILES=8 KEEP_DAYS=10' "$run_log" || ok=0
  if [ "$run_rc" -eq 0 ] && [ "$ok" -eq 1 ]; then
    pass "(x) KEEP_FILES=08 and KEEP_DAYS=0010 accepted as decimal 8 and 10"
  else
    fail "(x) leading zeros: rc=$run_rc ok=$ok out=$(cat "$run_log")"
  fi
}

# --- (y) BACKUP_DIR with spaces rotates by count, nothing sees a path fragment ---
{
  spaced="$WORKDIR/backup dir with spaces"
  mkdir -p "$spaced"
  seed_sets "$spaced" 5
  write_valid_fixture
  write_fake_docker valid
  : > "$FAKE_DOCKER_LOG"
  outside_before=$(find "$WORKDIR" -maxdepth 1 -print | grep -v "^$spaced$" | sort)
  run_with_settings "$spaced" KEEP_FILES=3 KEEP_DAYS=3650
  ok=1
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    # 5 seeded + 1 new, keep 3 newest: the oldest seed goes, the newest stays.
    [ "$(count_files "$spaced" "*.$kind")" -eq 3 ] || ok=0
    [ -f "$spaced/20200101_000000.$kind" ] && ok=0
    [ -f "$spaced/20200105_000000.$kind" ] || ok=0
  done
  outside_after=$(find "$WORKDIR" -maxdepth 1 -print | grep -v "^$spaced$" | sort)
  [ "$outside_after" = "$outside_before" ] || ok=0
  if [ "$run_rc" -eq 0 ] && [ "$ok" -eq 1 ]; then
    pass "(y) BACKUP_DIR with spaces -> KEEP_FILES newest of each kind survive, nothing else touched"
  else
    fail "(y) spaced BACKUP_DIR: rc=$run_rc ok=$ok out=$(cat "$run_log") state=$(find "$spaced" -maxdepth 1 -print | sort)"
  fi
}

# --- (z) rotation keeps the newest by mtime, not by name ---
# The names run opposite to the mtimes here, so an implementation that ordered
# the listing by name would keep 20200103 and delete 20200101.
{
  d="$WORKDIR/case_z"
  mkdir -p "$d"
  i=0
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    for n in 1 2 3; do
      f="$d/2020010${n}_000000.$kind"
      echo "seed $n" > "$f"
      # name 01 gets the newest mtime (01:03), name 03 the oldest (01:01)
      i=$((4 - n))
      touch -t "20200101010${i}" "$f"
    done
  done
  write_valid_fixture
  write_fake_docker valid
  run_with_settings "$d" KEEP_FILES=3 KEEP_DAYS=3650
  ok=1
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    [ "$(count_files "$d" "*.$kind")" -eq 3 ] || ok=0
    [ -f "$d/20200101_000000.$kind" ] || ok=0
    [ -f "$d/20200102_000000.$kind" ] || ok=0
    [ -f "$d/20200103_000000.$kind" ] && ok=0
  done
  if [ "$run_rc" -eq 0 ] && [ "$ok" -eq 1 ]; then
    pass "(z) rotation orders by mtime, so the file with the oldest mtime goes even when its name is newest"
  else
    fail "(z) mtime ordering: rc=$run_rc ok=$ok state=$(find "$d" -maxdepth 1 -name '*.sql' | sort)"
  fi
}

# --- (aa) over-long or over-cap values are refused before any work, with the
# value shown as given (not a wrapped one); the upper caps themselves are accepted ---
{
  ok=1
  detail=""
  i=0
  for bad in 9999999999999999999 9223372036854775808 18446744073709551616 36501; do
    i=$((i + 1))
    d="$WORKDIR/case_aa_days$i"
    seed_evidence_dir "$d"
    before=$(dir_state "$d")
    run_with_settings "$d" KEEP_FILES=3 KEEP_DAYS="$bad"
    [ "$run_rc" -ne 0 ] || { ok=0; detail="$detail KEEP_DAYS=$bad:rc=$run_rc"; }
    grep -q "KEEP_DAYS must be a non-negative integer" "$run_log" \
      || { ok=0; detail="$detail KEEP_DAYS=$bad:message"; }
    grep -qF "'$bad'" "$run_log" \
      || { ok=0; detail="$detail KEEP_DAYS=$bad:value-as-given"; }
    [ "$docker_calls" -eq 0 ] || { ok=0; detail="$detail KEEP_DAYS=$bad:docker_calls=$docker_calls"; }
    [ "$(dir_state "$d")" = "$before" ] || { ok=0; detail="$detail KEEP_DAYS=$bad:dir-changed"; }
  done
  j=0
  for bad in 18446744073709551617 100001; do
    j=$((j + 1))
    d="$WORKDIR/case_aa_files$j"
    seed_evidence_dir "$d"
    before=$(dir_state "$d")
    run_with_settings "$d" KEEP_FILES="$bad" KEEP_DAYS=3650
    [ "$run_rc" -ne 0 ] || { ok=0; detail="$detail KEEP_FILES=$bad:rc=$run_rc"; }
    grep -q "KEEP_FILES must be a positive integer" "$run_log" \
      || { ok=0; detail="$detail KEEP_FILES=$bad:message"; }
    grep -qF "'$bad'" "$run_log" \
      || { ok=0; detail="$detail KEEP_FILES=$bad:value-as-given"; }
    [ "$docker_calls" -eq 0 ] || { ok=0; detail="$detail KEEP_FILES=$bad:docker_calls=$docker_calls"; }
    [ "$(dir_state "$d")" = "$before" ] || { ok=0; detail="$detail KEEP_FILES=$bad:dir-changed"; }
  done
  d="$WORKDIR/case_aa_bounds"
  mkdir -p "$d"
  seed_sets "$d" 2
  write_valid_fixture
  write_fake_docker valid
  run_with_settings "$d" KEEP_FILES=100000 KEEP_DAYS=36500
  if [ "$run_rc" -eq 0 ] && grep -q 'retention KEEP_FILES=100000 KEEP_DAYS=36500' "$run_log"; then
    for kind in sql uploads.tar.gz api_data.tar.gz; do
      # 2 seeded + 1 new: the caps keep every file, nothing is rotated away.
      [ "$(count_files "$d" "*.$kind")" -eq 3 ] || { ok=0; detail="$detail bounds:$kind"; }
    done
  else
    ok=0
    detail="$detail bounds:rc=$run_rc"
  fi
  if [ "$ok" -eq 1 ]; then
    pass "(aa) KEEP_DAYS 19-digit/overflow/36501 and KEEP_FILES 19-digit/100001 refused with the value as given, dir and docker untouched; caps 100000 and 36500 accepted"
  else
    fail "(aa) retention overflow and caps:$detail"
  fi
}

# --- (bb) a file name with a newline rotates whole: the NUL-delimited listing
# never splits it into fragments, so an unrelated file in the script's cwd
# whose name looks like one of those fragments survives ---
{
  d="$WORKDIR/case_bb"
  cwd_dir="$WORKDIR/case_bb_cwd"
  mkdir -p "$d" "$cwd_dir"
  # The crafted name is "a<newline>1<tab>victim<newline>.sql". With a
  # newline-delimited pipeline its single record would be read as three:
  # "mtime<tab>a", "1<tab>victim" and ".sql"; the second hands the path
  # "victim" to rm, relative to the script's cwd. The run below therefore
  # has case_bb_cwd as its cwd and a sentinel "victim" inside it.
  crafted_name="$(printf 'a\n1\tvictim\n.sql')"
  crafted="$d/$crafted_name"
  echo crafted > "$crafted"
  touch -t 202001010100 "$crafted"
  seed_sets "$d" 3
  write_valid_fixture
  write_fake_docker valid
  echo sentinel > "$cwd_dir/victim"
  : > "$FAKE_DOCKER_LOG"
  run_log="$LOGS/run_log_bb"
  run_rc=0
  ( cd "$cwd_dir" && PATH="$FAKE_BIN:$PATH" env BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x \
      KEEP_FILES=2 KEEP_DAYS=36500 "$BACKUP_SCRIPT" ) >"$run_log" 2>&1 || run_rc=$?
  ok=1
  [ "$run_rc" -eq 0 ] || { ok=0; detail="rc=$run_rc"; }
  if [ ! -f "$cwd_dir/victim" ] || [ "$(cat "$cwd_dir/victim")" != "sentinel" ]; then
    ok=0
    detail="$detail victim-gone-or-changed"
  fi
  # The crafted file is the oldest .sql, so KEEP_FILES=2 must delete it whole.
  [ -e "$crafted" ] && { ok=0; detail="$detail crafted-still-there"; }
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    # 3 seeded + 1 new, keep 2 newest: the newest seed survives, the oldest goes.
    [ "$(count_files "$d" "*.$kind")" -eq 2 ] || { ok=0; detail="$detail count-$kind=$(count_files "$d" "*.$kind")"; }
    [ -f "$d/20200103_000000.$kind" ] || { ok=0; detail="$detail newest-seed-$kind-gone"; }
    [ -f "$d/20200101_000000.$kind" ] && { ok=0; detail="$detail oldest-seed-$kind-kept"; }
  done
  if [ "$ok" -eq 1 ]; then
    pass "(bb) file name with a newline rotates whole, sentinel 'victim' in the cwd survives"
  else
    fail "(bb) newline file name rotation: $detail out=$(cat "$run_log")"
  fi
}

# --- (cc) BACKUP_DIR given as a symlink rotates by count through the link ---
{
  real="$WORKDIR/case_cc_real"
  link="$WORKDIR/case_cc_link"
  mkdir -p "$real"
  ln -s "$real" "$link"
  seed_sets "$real" 5
  write_valid_fixture
  write_fake_docker valid
  run_with_settings "$link" KEEP_FILES=3 KEEP_DAYS=36500
  ok=1
  detail=""
  for kind in sql uploads.tar.gz api_data.tar.gz; do
    # 5 seeded + 1 new through the link, keep 3 newest: without -L on the
    # rotation find the symlink is not followed and nothing is rotated.
    [ "$(count_files "$real" "*.$kind")" -eq 3 ] || { ok=0; detail="$detail count-$kind=$(count_files "$real" "*.$kind")"; }
    [ -f "$real/20200101_000000.$kind" ] && { ok=0; detail="$detail oldest-$kind-kept"; }
    [ -f "$real/20200105_000000.$kind" ] || { ok=0; detail="$detail newest-seed-$kind-gone"; }
  done
  if [ "$run_rc" -eq 0 ] && [ "$ok" -eq 1 ]; then
    pass "(cc) BACKUP_DIR as a symlink -> count rotation deletes through the link"
  else
    fail "(cc) symlinked BACKUP_DIR: rc=$run_rc $detail out=$(cat "$run_log")"
  fi
}

# --- (dd) leading zeros are stripped before the digit count: a long
# zero-padded valid value is accepted, a long zero-padded over-cap value is
# refused with the value as given ---
{
  ok=1
  detail=""
  d="$WORKDIR/case_dd_ok"
  mkdir -p "$d"
  write_valid_fixture
  write_fake_docker valid
  run_with_settings "$d" KEEP_FILES=0000000000000000000005 KEEP_DAYS=00000000000000000000036500
  [ "$run_rc" -eq 0 ] || { ok=0; detail="$detail ok-rc=$run_rc"; }
  grep -q "retention KEEP_FILES=5 KEEP_DAYS=36500" "$run_log" || { ok=0; detail="$detail ok-retention-line"; }
  d="$WORKDIR/case_dd_bad"
  seed_evidence_dir "$d"
  before=$(dir_state "$d")
  run_with_settings "$d" KEEP_FILES=3 KEEP_DAYS=0000000000000000000036501
  [ "$run_rc" -ne 0 ] || { ok=0; detail="$detail bad-rc=$run_rc"; }
  grep -q "0000000000000000000036501" "$run_log" || { ok=0; detail="$detail bad-value-as-given"; }
  [ "$docker_calls" -eq 0 ] || { ok=0; detail="$detail bad-docker=$docker_calls"; }
  [ "$(dir_state "$d")" = "$before" ] || { ok=0; detail="$detail bad-dir-changed"; }
  if [ "$ok" -eq 1 ]; then
    pass "(dd) zero-padded KEEP_FILES=...05 accepted as 5; zero-padded KEEP_DAYS=...36501 refused as given"
  else
    fail "(dd) zero-padded retention values:$detail out=$(cat "$run_log")"
  fi
}

# --- (ee) a file whose mtime cannot be read is skipped instead of shifting
# the "<mtime><TAB><path>" split: with an empty mtime field a path containing
# a tab would be cut at the tab and its tail removed relative to the cwd ---
{
  d="$WORKDIR/case_ee"
  cwd_dir="$WORKDIR/case_ee_cwd"
  stub_bin="$WORKDIR/case_ee_bin"
  mkdir -p "$d" "$cwd_dir" "$stub_bin"
  real_stat=$(command -v stat)
  cat > "$stub_bin/stat" <<EOF
#!/usr/bin/env bash
for a in "\$@"; do
  case "\$a" in *RACE*) exit 1 ;; esac
done
exec "$real_stat" "\$@"
EOF
  chmod +x "$stub_bin/stat"
  crafted="$d/$(printf 'x\tRACE.sql')"
  echo crafted > "$crafted"
  seed_sets "$d" 2
  write_valid_fixture
  write_fake_docker valid
  echo sentinel > "$cwd_dir/RACE.sql"
  : > "$FAKE_DOCKER_LOG"
  run_log="$LOGS/run_log_ee"
  run_rc=0
  ( cd "$cwd_dir" && PATH="$stub_bin:$FAKE_BIN:$PATH" env BACKUP_DIR="$d" PG_CONTAINER=x PG_USER=x PG_DB=x \
      KEEP_FILES=1 KEEP_DAYS=36500 "$BACKUP_SCRIPT" ) >"$run_log" 2>&1 || run_rc=$?
  ok=1
  detail=""
  [ "$run_rc" -eq 0 ] || { ok=0; detail="rc=$run_rc"; }
  if [ ! -f "$cwd_dir/RACE.sql" ] || [ "$(cat "$cwd_dir/RACE.sql")" != "sentinel" ]; then
    ok=0
    detail="$detail cwd-sentinel-gone"
  fi
  [ -e "$crafted" ] || { ok=0; detail="$detail unreadable-mtime-file-deleted"; }
  if [ "$ok" -eq 1 ]; then
    pass "(ee) a file whose mtime cannot be read is skipped; the cwd sentinel survives"
  else
    fail "(ee) unreadable mtime with a tab in the path:$detail out=$(cat "$run_log")"
  fi
}

# --- (ff) a symlink loop named *.sql does not fail a good run, and the kept
# count counts files, not lines ---
{
  d="$WORKDIR/case_ff"
  mkdir -p "$d"
  ln -s loop.sql "$d/loop.sql"
  printf 'n\n' > "$d/$(printf 'n\nl.sql')"
  touch -t 202001010100 "$d/$(printf 'n\nl.sql')"
  seed_sets "$d" 2
  write_valid_fixture
  write_fake_docker valid
  run_with_settings "$d" KEEP_FILES=5 KEEP_DAYS=36500
  if [ "$run_rc" -eq 0 ] && grep -q "rotation done (4 backups kept)" "$run_log"; then
    pass "(ff) symlink loop named *.sql: exit 0; kept count 4 with a newline-named file"
  else
    fail "(ff) symlink loop: rc=$run_rc out=$(cat "$run_log")"
  fi
}

echo
echo "backup.test.sh: $pass_count passed, $fail_count failed"
rm -rf "$WORKDIR"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
