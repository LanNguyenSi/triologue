#!/usr/bin/env bash
# Behaviour guards for the `make migrate` target. Without the opt-in a failing
# first `prisma migrate deploy` must fail the target right away: the original
# error, then one line naming the opt-in, and no `prisma migrate resolve`
# call. The recovery (two resolve calls and a second deploy) runs only when
# MIGRATE_RECOVERY is exactly 1, as a make variable or in the environment,
# with the make variable winning when both are given; absent, empty and 0 all
# keep it off. With the opt-in a failing second deploy still fails the target
# (the recipe's set -e). The target runs with COMPOSE pointed at a stub that
# logs every call's arguments and fails on demand, so no Docker is needed.
# Negative controls run the same checks against mutated Makefile copies in a
# temp dir, so a check weakened to always-true fails this script.
#   bash scripts/make-migrate.test.sh
# MAKE_MIGRATE_TMPDIR forces the temp dir base path (needed where
# `mktemp -d` ignores TMPDIR, e.g. macOS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAKEFILE="$ROOT/Makefile"

if [ -n "${MAKE_MIGRATE_TMPDIR:-}" ]; then
  WORKDIR="$(mktemp -d "${MAKE_MIGRATE_TMPDIR%/}/mm.XXXXXXXX")"
else
  WORKDIR="$(mktemp -d)"
fi
trap 'rm -rf "$WORKDIR"' EXIT

fail_count=0
pass_count=0
pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

STUB="$WORKDIR/compose-stub"
cat > "$STUB" <<'STUB_EOF'
#!/usr/bin/env bash
# Stub for the COMPOSE make variable: logs the arguments of every call and
# fails per the mode file next to it. Modes: ok (everything succeeds),
# fail-first-deploy (only the first `prisma migrate deploy` fails),
# fail-all-deploys (every `prisma migrate deploy` fails). Resolve calls
# always succeed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
printf '%s\n' "$*" >> "$here/calls.log"
last="${*: -1}"
mode="$(cat "$here/mode")"
kind=other
case "$last" in
  *"prisma migrate deploy"*) kind=deploy ;;
  *"migrate resolve --rolled-back 20260221_agent_visibility"*) kind=resolve_agent ;;
  *"migrate resolve --rolled-back 20260221_byoa_unified_agents"*) kind=resolve_byoa ;;
esac
case "$mode:$kind" in
  fail-first-deploy:deploy)
    if [ "$(grep -c 'prisma migrate deploy' "$here/calls.log")" -eq 1 ]; then
      echo "STUB deploy error: simulated migrate deploy failure" >&2
      exit 1
    fi
    ;;
  fail-all-deploys:deploy)
    echo "STUB deploy error: simulated migrate deploy failure" >&2
    exit 1
    ;;
esac
STUB_EOF
chmod +x "$STUB"

OUT=""
STATUS=0
LOG=""
SEQ_DEPLOY="npx prisma migrate deploy"
SEQ_RECOVERY="npx prisma migrate deploy
npx prisma migrate resolve --rolled-back 20260221_agent_visibility
npx prisma migrate resolve --rolled-back 20260221_byoa_unified_agents
npx prisma migrate deploy"

# invoke <makefile> <mode> <env-spec> <cli-spec>; a spec of "-" means unset,
# "" means set but empty. Sets OUT (merged recipe output), STATUS (make's
# exit code) and LOG (the stub call log, one line of arguments per call).
invoke() {
  local makefile="$1" mode="$2" envspec="$3" clispec="$4" dir
  dir="$(mktemp -d "$WORKDIR/case.XXXXXXXX")"
  printf '%s' "$mode" > "$dir/mode"
  cp "$STUB" "$dir/compose"
  chmod +x "$dir/compose"
  unset MIGRATE_RECOVERY
  if [ "$envspec" != "-" ]; then export MIGRATE_RECOVERY="$envspec"; fi
  STATUS=0
  if [ "$clispec" = "-" ]; then
    OUT="$(make -s -C "$ROOT" -f "$makefile" migrate "COMPOSE=$dir/compose" 2>&1)" || STATUS=$?
  else
    OUT="$(make -s -C "$ROOT" -f "$makefile" migrate "MIGRATE_RECOVERY=$clispec" "COMPOSE=$dir/compose" 2>&1)" || STATUS=$?
  fi
  unset MIGRATE_RECOVERY
  LOG="$(cat "$dir/calls.log" 2>/dev/null || true)"
}

# One line per logged call: the inner command the target hands to sh -lc.
inner_seq() {
  printf '%s\n' "$LOG" | sed -n 's/.*sh -lc //p'
}

b_success() { # first deploy succeeds: one deploy call, success line, exit 0
  local mf="$1" bad=0 seq
  invoke "$mf" ok "$2" "$3"
  if [ "$STATUS" -ne 0 ]; then echo "exit code $STATUS, expected 0"; bad=1; fi
  seq="$(inner_seq)"
  if [ "$seq" != "$SEQ_DEPLOY" ]; then echo "unexpected compose calls: $(printf '%s' "$seq" | tr '\n' ';')"; bad=1; fi
  if ! printf '%s\n' "$OUT" | grep -q 'Prisma migrations applied'; then
    echo "the success line is not in the output"
    bad=1
  fi
  return "$bad"
}

b_off() { # first deploy fails, opt-in not taken: fail fast, no resolve
  local mf="$1" bad=0 seq hints err_line hint_line
  invoke "$mf" fail-first-deploy "$2" "$3"
  if [ "$STATUS" -eq 0 ]; then echo "exit code 0, expected non-zero"; bad=1; fi
  seq="$(inner_seq)"
  if [ "$seq" != "$SEQ_DEPLOY" ]; then echo "recovery ran or deploy repeated: $(printf '%s' "$seq" | tr '\n' ';')"; bad=1; fi
  if ! printf '%s\n' "$OUT" | grep -q 'STUB deploy error'; then
    echo "the original deploy error is not in the output"
    bad=1
  fi
  hints="$(printf '%s\n' "$OUT" | grep -c 'MIGRATE_RECOVERY=1' || true)"
  if [ "$hints" != 1 ]; then echo "expected exactly one line naming the opt-in, got $hints"; bad=1; fi
  err_line="$(printf '%s\n' "$OUT" | grep -m1 -n 'STUB deploy error' | cut -d: -f1 || true)"
  hint_line="$(printf '%s\n' "$OUT" | grep -m1 -n 'MIGRATE_RECOVERY=1' | cut -d: -f1 || true)"
  if [ -n "$err_line" ] && [ -n "$hint_line" ] && [ "$err_line" -ge "$hint_line" ]; then
    echo "the opt-in line does not come after the original error"
    bad=1
  fi
  return "$bad"
}

b_on_second_ok() { # opt-in, first deploy fails, second succeeds: full recovery, exit 0
  local mf="$1" bad=0 seq
  invoke "$mf" fail-first-deploy "$2" "$3"
  if [ "$STATUS" -ne 0 ]; then echo "exit code $STATUS, expected 0"; bad=1; fi
  seq="$(inner_seq)"
  if [ "$seq" != "$SEQ_RECOVERY" ]; then echo "unexpected compose calls: $(printf '%s' "$seq" | tr '\n' ';')"; bad=1; fi
  if ! printf '%s\n' "$OUT" | grep -q 'Prisma migrations applied (after recovery)'; then
    echo "the after-recovery success line is not in the output"
    bad=1
  fi
  return "$bad"
}

b_on_second_fail() { # opt-in, both deploys fail: recovery ran, target still fails
  local mf="$1" bad=0 seq
  invoke "$mf" fail-all-deploys "$2" "$3"
  if [ "$STATUS" -eq 0 ]; then echo "exit code 0, expected non-zero"; bad=1; fi
  seq="$(inner_seq)"
  if [ "$seq" != "$SEQ_RECOVERY" ]; then echo "unexpected compose calls: $(printf '%s' "$seq" | tr '\n' ';')"; bad=1; fi
  if printf '%s\n' "$OUT" | grep -q 'Prisma migrations applied (after recovery)'; then
    echo "the after-recovery success line appeared although the second deploy failed"
    bad=1
  fi
  return "$bad"
}

# Runs a scenario against the real Makefile and reports one PASS or one FAIL.
guard_case() {
  local label="$1" fn="$2" out
  shift 2
  if out="$("$fn" "$@" 2>&1)"; then
    pass "$label"
  else
    fail "$label: $(printf '%s' "$out" | tr '\n' ';')"
  fi
}

# Runs a scenario against a mutated Makefile copy: it must fail there, or the
# scenario is not actually testing what it claims.
control_case() {
  local label="$1" fn="$2" out
  shift 2
  if out="$("$fn" "$@" 2>&1)"; then
    fail "control: $fn passed against $label: $(printf '%s' "$out" | tr '\n' ';')"
  else
    pass "control: $fn fails against $label"
  fi
}

# ── The real Makefile ───────────────────────────────────────────────────────

# Success behaves the same in both modes.
guard_case "success, no opt-in" b_success "$MAKEFILE" "-" "-"
guard_case "success, opt-in via make variable" b_success "$MAKEFILE" "-" "1"
# Opt-in absent, empty or 0 (as environment or make variable): off.
guard_case "first deploy fails, no opt-in at all" b_off "$MAKEFILE" "-" "-"
guard_case "first deploy fails, MIGRATE_RECOVERY set but empty in the environment" b_off "$MAKEFILE" "" "-"
guard_case "first deploy fails, MIGRATE_RECOVERY set but empty as a make variable" b_off "$MAKEFILE" "-" ""
guard_case "first deploy fails, MIGRATE_RECOVERY=0 in the environment" b_off "$MAKEFILE" "0" "-"
guard_case "first deploy fails, MIGRATE_RECOVERY=0 as a make variable" b_off "$MAKEFILE" "-" "0"
# Precedence: a make variable beats the environment, in both directions.
guard_case "first deploy fails, environment 1 but make variable 0: the make variable wins" b_off "$MAKEFILE" "1" "0"
# Opt-in via either source takes the recovery path.
guard_case "first deploy fails, MIGRATE_RECOVERY=1 in the environment: recovery, second deploy succeeds" b_on_second_ok "$MAKEFILE" "1" "-"
guard_case "first deploy fails, MIGRATE_RECOVERY=1 as a make variable: recovery, second deploy succeeds" b_on_second_ok "$MAKEFILE" "-" "1"
guard_case "first deploy fails, environment 0 but make variable 1: the make variable wins" b_on_second_ok "$MAKEFILE" "0" "1"
guard_case "opt-in and the second deploy fails too: target fails after the recovery" b_on_second_fail "$MAKEFILE" "-" "1"

# ── Negative controls: each check must fail on a mutated copy ───────────────

mut="$WORKDIR/mutated"
mkdir -p "$mut"

awk 'index($0, "elif [ \"$(MIGRATE_RECOVERY)\" = \"1\" ]; then") { print "\telif true; then \\"; next } { print }' "$MAKEFILE" > "$mut/Makefile-optin-check-removed"
control_case "a Makefile whose opt-in check always passes" b_off "$mut/Makefile-optin-check-removed" "-" "-"

awk 'index($0, "exit 1; \\") { next } { print }' "$MAKEFILE" > "$mut/Makefile-no-exit"
control_case "a Makefile whose off path does not exit non-zero" b_off "$mut/Makefile-no-exit" "-" "-"

awk 'index($0, "\"npx prisma migrate deploy\";") && ++n == 2 { sub(/";/, "\" || true;") } { print }' "$MAKEFILE" > "$mut/Makefile-second-deploy-tolerated"
control_case "a Makefile that tolerates a failing second deploy" b_on_second_fail "$mut/Makefile-second-deploy-tolerated" "-" "1"

awk 'index($0, "To retry with the recovery") { next } { print }' "$MAKEFILE" > "$mut/Makefile-no-optin-line"
control_case "a Makefile whose off path does not name the opt-in" b_off "$mut/Makefile-no-optin-line" "-" "-"

echo ""
echo "make-migrate.test.sh: $pass_count passed, $fail_count failed"
[ "$fail_count" -eq 0 ]
