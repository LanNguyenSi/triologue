#!/usr/bin/env bash
# Test driver for scripts/schema-drift-report.sh and scripts/check-schema-drift.sh.
# No docker or postgres needed: a fake `docker` on PATH stands in for
# `docker compose exec ... prisma migrate diff`.
#   bash scripts/schema-drift.test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPORT="$SCRIPT_DIR/schema-drift-report.sh"
CHECK="$SCRIPT_DIR/check-schema-drift.sh"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail_count=0
pass_count=0
pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# Fake docker: prints $FAKE_DOCKER_OUT and exits $FAKE_DOCKER_RC.
mkdir -p "$WORKDIR/bin"
cat > "$WORKDIR/bin/docker" <<'FAKE'
#!/bin/sh
printf '%s\n' "${FAKE_DOCKER_OUT:-}"
exit "${FAKE_DOCKER_RC:-0}"
FAKE
chmod +x "$WORKDIR/bin/docker"

run_report() { # <status file> <rc> <out>; sets rc and out
  rc=0
  out=$(PATH="$WORKDIR/bin:$PATH" DRIFT_STATUS_FILE="$1" FAKE_DOCKER_RC="$2" FAKE_DOCKER_OUT="$3" sh "$REPORT") || rc=$?
}
run_check() { # <status file>; sets rc and out
  rc=0
  out=$(DRIFT_STATUS_FILE="$1" "$CHECK") || rc=$?
}

drift_diff='[-] Removed index on columns (createdBy)
  postgresql://user:secret@db.internal:5432/triologue leaked'

# --- (a) clean database: report OK, exit 0; check prints OK, exit 0 ---
{
  f="$WORKDIR/a/status"
  run_report "$f" 0 "No difference detected."
  if [ "$rc" -eq 0 ] && [ "$(head -n 1 "$f" | awk '{print $2 " " $3}')" = "schema-drift OK" ]; then
    pass "(a) clean report: exit 0, status file says OK"
  else
    fail "(a) clean report: rc=$rc out=$out file=$(cat "$f" 2>/dev/null)"
  fi
  run_check "$f"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "schema-drift OK:"; then
    pass "(a) clean check: exit 0, OK line"
  else
    fail "(a) clean check: rc=$rc out=$out"
  fi
}

# --- (b) drift: report still exits 0, records DRIFT without a URL; check FAILs ---
{
  f="$WORKDIR/b/status"
  run_report "$f" 2 "$drift_diff"
  if [ "$rc" -eq 0 ] && grep -q "schema-drift DRIFT" "$f" && grep -q "Removed index" "$f" \
    && ! grep -q "postgresql://" "$f" && ! printf '%s' "$out" | grep -q "postgresql://" \
    && printf '%s' "$out" | grep -q "WARNING"; then
    pass "(b) drift report: exit 0, DRIFT recorded, warning printed, URL line dropped"
  else
    fail "(b) drift report: rc=$rc out=$out file=$(cat "$f" 2>/dev/null)"
  fi
  run_check "$f"
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "schema-drift FAIL:.*state=DRIFT"; then
    pass "(b) drift check: exit 1, FAIL line"
  else
    fail "(b) drift check: rc=$rc out=$out"
  fi
}

# --- (c) a later clean report clears an earlier DRIFT record ---
{
  f="$WORKDIR/c/status"
  run_report "$f" 2 "$drift_diff"
  run_report "$f" 0 "No difference detected."
  run_check "$f"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "schema-drift OK:" && ! grep -q "Removed index" "$f"; then
    pass "(c) clean report after drift: record cleared, check OK"
  else
    fail "(c) clear: rc=$rc out=$out file=$(cat "$f")"
  fi
}

# --- (d) check that could not run: ERROR, exit 0, no output text (may name the host) ---
{
  f="$WORKDIR/d/status"
  run_report "$f" 1 "Error: P1001 Can't reach database server at db.internal:5432"
  if [ "$rc" -eq 0 ] && grep -q "schema-drift ERROR" "$f" && ! grep -q "db.internal" "$f" \
    && ! printf '%s' "$out" | grep -q "db.internal"; then
    pass "(d) failed check: exit 0, ERROR recorded without the prisma error text"
  else
    fail "(d) failed check: rc=$rc out=$out file=$(cat "$f" 2>/dev/null)"
  fi
  run_check "$f"
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "state=ERROR"; then
    pass "(d) ERROR check: exit 1"
  else
    fail "(d) ERROR check: rc=$rc out=$out"
  fi
}

# --- (e) no report yet: UNKNOWN, exit 0 ---
{
  run_check "$WORKDIR/e/missing"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "schema-drift UNKNOWN:"; then
    pass "(e) no report: UNKNOWN, exit 0"
  else
    fail "(e) no report: rc=$rc out=$out"
  fi
}

# --- (f) unwritable status path: report still exits 0 and warns ---
{
  run_report "/dev/null/blocked/status" 2 "$drift_diff"
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q "could not write"; then
    pass "(f) unwritable status file: exit 0, warning"
  else
    fail "(f) unwritable: rc=$rc out=$out"
  fi
}

# --- (g) garbled status file: FAIL, exit 1 ---
{
  f="$WORKDIR/g/status"
  mkdir -p "$WORKDIR/g"
  echo "garbage" > "$f"
  run_check "$f"
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "state=unreadable"; then
    pass "(g) garbled status: FAIL, exit 1"
  else
    fail "(g) garbled: rc=$rc out=$out"
  fi
}

# --- (h) exit 2 without prisma diff markers is an ERROR, never DRIFT ---
{
  f="$WORKDIR/h/status"
  run_report "$f" 2 "usage: docker exec to db.internal:5432 failed"
  if [ "$rc" -eq 0 ] && grep -q "schema-drift ERROR" "$f" && ! grep -q "schema-drift DRIFT" "$f" \
    && ! grep -q "db.internal" "$f" && ! printf '%s' "$out" | grep -q "db.internal"; then
    pass "(h) exit 2 without diff markers: ERROR, raw text not stored"
  else
    fail "(h) exit 2 without markers: rc=$rc out=$out file=$(cat "$f" 2>/dev/null)"
  fi
  run_check "$f"
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q "state=ERROR"; then
    pass "(h) check: exit 1 on that ERROR"
  else
    fail "(h) check: rc=$rc out=$out"
  fi
}

# --- (i) ERROR keeps the prisma error code in the file and the step output ---
{
  f="$WORKDIR/i/status"
  run_report "$f" 1 "Error: P1000 Authentication failed against database server at db.internal:5432"
  if [ "$rc" -eq 0 ] && grep -q "schema-drift ERROR" "$f" && grep -q "P1000" "$f" \
    && printf '%s' "$out" | grep -q "P1000" \
    && ! grep -q "db.internal" "$f" && ! printf '%s' "$out" | grep -q "db.internal"; then
    pass "(i) ERROR records the prisma error code, no host"
  else
    fail "(i) error code: rc=$rc out=$out file=$(cat "$f" 2>/dev/null)"
  fi
  run_report "$f" 1 "boom without a code"
  if grep -q "exit 1" "$f" && ! grep -q "prisma error" "$f"; then
    pass "(i) ERROR without a prisma code: exit code only"
  else
    fail "(i) no code: file=$(cat "$f" 2>/dev/null)"
  fi
}

echo "passed=$pass_count failed=$fail_count"
[ "$fail_count" -eq 0 ]
