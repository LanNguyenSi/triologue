#!/usr/bin/env bash
# Test driver for scripts/check-backup-freshness.sh. No docker or postgres
# needed: exercises the script against fixture files in a temp BACKUP_DIR.
#   bash scripts/check-backup-freshness.test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK_SCRIPT="$SCRIPT_DIR/check-backup-freshness.sh"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail_count=0
pass_count=0

pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# --- (a) fresh dump -> OK, exit 0 ---
{
  d="$WORKDIR/case_a"
  mkdir -p "$d"
  echo "-- fresh dump" > "$d/20260825_000000.sql"
  rc=0
  out=$(BACKUP_DIR="$d" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "backup-freshness OK:"; then
    pass "(a) fresh dump -> OK, exit 0"
  else
    fail "(a) fresh dump: rc=$rc out=$out"
  fi
}

# --- (b) dump aged past MAX_AGE_HOURS -> FAIL, exit 1 ---
{
  d="$WORKDIR/case_b"
  mkdir -p "$d"
  f="$d/20200101_000000.sql"
  echo "-- old dump" > "$f"
  # -t works on both GNU and BSD touch (unlike -d, which is GNU-only).
  old_stamp=$(date -u -v-3d +%Y%m%d%H%M.%S 2>/dev/null || date -u -d '3 days ago' +%Y%m%d%H%M.%S)
  touch -t "$old_stamp" "$f"
  rc=0
  out=$(BACKUP_DIR="$d" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "backup-freshness FAIL:"; then
    pass "(b) aged dump -> FAIL, exit 1"
  else
    fail "(b) aged dump: rc=$rc out=$out"
  fi
}

# --- (c) empty dir -> FAIL, exit 1, no dumps message ---
{
  d="$WORKDIR/case_c"
  mkdir -p "$d"
  rc=0
  out=$(BACKUP_DIR="$d" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "no dumps in"; then
    pass "(c) empty dir -> FAIL, exit 1, no dumps in <dir>"
  else
    fail "(c) empty dir: rc=$rc out=$out"
  fi
}

# --- (d) 0-byte newest dump -> FAIL, exit 1 ---
{
  d="$WORKDIR/case_d"
  mkdir -p "$d"
  : > "$d/20260825_000000.sql"
  rc=0
  out=$(BACKUP_DIR="$d" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "backup-freshness FAIL:"; then
    pass "(d) 0-byte newest dump -> FAIL, exit 1"
  else
    fail "(d) 0-byte newest dump: rc=$rc out=$out"
  fi
}

# --- (e) symlinked BACKUP_DIR -> OK, exit 0 (find must follow the link) ---
{
  d="$WORKDIR/case_e_real"
  mkdir -p "$d"
  echo "-- fresh dump behind symlink" > "$d/20260825_000000.sql"
  ln -s "$d" "$WORKDIR/case_e_link"
  rc=0
  out=$(BACKUP_DIR="$WORKDIR/case_e_link" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "backup-freshness OK:"; then
    pass "(e) symlinked BACKUP_DIR -> OK, exit 0"
  else
    fail "(e) symlinked BACKUP_DIR: rc=$rc out=$out"
  fi
}

echo
echo "check-backup-freshness.test.sh: $pass_count passed, $fail_count failed"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
