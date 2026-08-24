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
    perms=$(stat -f '%Lp' "$sql_file" 2>/dev/null || stat -c '%a' "$sql_file" 2>/dev/null)
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

echo
echo "backup.test.sh: $pass_count passed, $fail_count failed"
rm -rf "$WORKDIR"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
