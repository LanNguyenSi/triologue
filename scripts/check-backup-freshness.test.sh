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

# Write a fresh dump plus both archives (the complete set backup.sh publishes).
write_set() {
  local dir="$1" stamp="$2"
  echo "-- fresh dump" > "$dir/$stamp.sql"
  echo "archive" > "$dir/$stamp.uploads.tar.gz"
  echo "archive" > "$dir/$stamp.api_data.tar.gz"
}

# --- (a) fresh dump -> OK, exit 0 ---
{
  d="$WORKDIR/case_a"
  mkdir -p "$d"
  write_set "$d" 20260825_000000
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
  write_set "$d" 20260825_000000
  ln -s "$d" "$WORKDIR/case_e_link"
  rc=0
  out=$(BACKUP_DIR="$WORKDIR/case_e_link" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "backup-freshness OK:"; then
    pass "(e) symlinked BACKUP_DIR -> OK, exit 0"
  else
    fail "(e) symlinked BACKUP_DIR: rc=$rc out=$out"
  fi
}

# --- (f) dump fresh but no uploads archive -> FAIL naming the uploads archives ---
{
  d="$WORKDIR/case_f"
  mkdir -p "$d"
  write_set "$d" 20260825_000000
  rm "$d/20260825_000000.uploads.tar.gz"
  rc=0
  out=$(BACKUP_DIR="$d" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "no uploads archives in"; then
    pass "(f) missing uploads archive -> FAIL, exit 1"
  else
    fail "(f) missing uploads archive: rc=$rc out=$out"
  fi
}

# --- (g) dump fresh but no api_data archive -> FAIL naming the api_data archives ---
{
  d="$WORKDIR/case_g"
  mkdir -p "$d"
  write_set "$d" 20260825_000000
  rm "$d/20260825_000000.api_data.tar.gz"
  rc=0
  out=$(BACKUP_DIR="$d" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "no api_data archives in"; then
    pass "(g) missing api_data archive -> FAIL, exit 1"
  else
    fail "(g) missing api_data archive: rc=$rc out=$out"
  fi
}

# --- (h) fresh dump, stale uploads archive -> FAIL ---
{
  d="$WORKDIR/case_h"
  mkdir -p "$d"
  write_set "$d" 20260825_000000
  old_stamp=$(date -u -v-3d +%Y%m%d%H%M.%S 2>/dev/null || date -u -d '3 days ago' +%Y%m%d%H%M.%S)
  touch -t "$old_stamp" "$d/20260825_000000.uploads.tar.gz"
  rc=0
  out=$(BACKUP_DIR="$d" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "uploads.tar.gz age="; then
    pass "(h) stale uploads archive -> FAIL, exit 1"
  else
    fail "(h) stale uploads archive: rc=$rc out=$out"
  fi
}

# --- (i) fresh dump, stale api_data archive -> FAIL ---
{
  d="$WORKDIR/case_i"
  mkdir -p "$d"
  write_set "$d" 20260825_000000
  old_stamp=$(date -u -v-3d +%Y%m%d%H%M.%S 2>/dev/null || date -u -d '3 days ago' +%Y%m%d%H%M.%S)
  touch -t "$old_stamp" "$d/20260825_000000.api_data.tar.gz"
  rc=0
  out=$(BACKUP_DIR="$d" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "api_data.tar.gz age="; then
    pass "(i) stale api_data archive -> FAIL, exit 1"
  else
    fail "(i) stale api_data archive: rc=$rc out=$out"
  fi
}

# --- (j) 0-byte newest archive -> FAIL ---
{
  d="$WORKDIR/case_j"
  mkdir -p "$d"
  write_set "$d" 20260825_000000
  : > "$d/20260825_000000.api_data.tar.gz"
  rc=0
  out=$(BACKUP_DIR="$d" "$CHECK_SCRIPT") && rc=0 || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "reason=0-byte api_data"; then
    pass "(j) 0-byte archive -> FAIL, exit 1"
  else
    fail "(j) 0-byte archive: rc=$rc out=$out"
  fi
}

echo
echo "check-backup-freshness.test.sh: $pass_count passed, $fail_count failed"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
