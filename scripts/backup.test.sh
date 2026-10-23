#!/usr/bin/env bash
# Test driver for scripts/backup.sh. Uses a fake `docker` on PATH so no real
# postgres/container is needed. Run directly or via CI:
#   bash scripts/backup.test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"

WORKDIR="$(mktemp -d)"
FAKE_BIN="$WORKDIR/bin"
mkdir -p "$FAKE_BIN"

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

echo
echo "backup.test.sh: $pass_count passed, $fail_count failed"
rm -rf "$WORKDIR"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
