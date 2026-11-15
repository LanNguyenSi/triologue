#!/usr/bin/env bash
# Structural guards for the api container lifecycle:
#   - docker-compose.yml api has `init: true` and a `stop_grace_period`, so
#     `docker stop` reaches node (or the init shim) and the grace window is
#     longer than the 10 s server.close() timeout of the shutdown handler;
#   - server/entrypoint.sh's last line is `exec node dist/index.js`, so node
#     (not npm) is the long-running process that receives the signal;
#   - every Makefile wait-healthy.sh invocation lists triologue-redis, so a
#     broken Redis fails `make status` (the api answers 200 "degraded" on a
#     Redis outage on purpose, so the api healthcheck cannot catch it alone).
# Negative controls run the same checks against mutated copies in a temp dir,
# so a check weakened to always-true fails this script.
#   bash scripts/compose-lifecycle.test.sh
# COMPOSE_LIFECYCLE_TMPDIR forces the temp dir base path (needed where
# `mktemp -d` ignores TMPDIR, e.g. macOS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker-compose.yml"
ENTRYPOINT_FILE="$ROOT/server/entrypoint.sh"
MAKEFILE="$ROOT/Makefile"

if [ -n "${COMPOSE_LIFECYCLE_TMPDIR:-}" ]; then
  WORKDIR="$(mktemp -d "${COMPOSE_LIFECYCLE_TMPDIR%/}/cl.XXXXXXXX")"
else
  WORKDIR="$(mktemp -d)"
fi
trap 'rm -rf "$WORKDIR"' EXIT

fail_count=0
pass_count=0

pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# Each check_* echoes one line per failed expectation (none when all pass)
# and returns 0 when there is nothing to report.

# The `api:` service block: its four-space-indented lines, up to the next
# top-level two-space key.
api_block() {
  awk '/^  api:$/{f=1; next} f && /^  [^ ]/{f=0} f' "$1"
}

check_compose() {
  local file="$1" bad=0 block
  block="$(api_block "$file")"
  if ! printf '%s\n' "$block" | grep -Eq '^    init: true[[:space:]]*$'; then
    echo "api is missing init: true"
    bad=1
  fi
  if ! printf '%s\n' "$block" | grep -Eq '^    stop_grace_period: [0-9]+s[[:space:]]*$'; then
    echo "api has no stop_grace_period in seconds"
    bad=1
  fi
  return "$bad"
}

check_entrypoint() {
  local file="$1" last
  last="$(awk 'NF{line=$0} END{print line}' "$file")"
  if [ "$last" != "exec node dist/index.js" ]; then
    printf 'last line is "%s", expected "exec node dist/index.js"\n' "$last"
    return 1
  fi
}

check_makefile() {
  local file="$1" found=0 bad=0 line name
  while IFS= read -r line; do
    found=$((found + 1))
    for name in triologue-api triologue-frontend triologue-postgres triologue-redis; do
      if ! printf '%s\n' "$line" | grep -q "$name"; then
        echo "wait-healthy.sh invocation is missing $name"
        bad=1
      fi
    done
  done < <(grep 'wait-healthy\.sh' "$file")
  if [ "$found" -eq 0 ]; then
    echo "no wait-healthy.sh invocation found"
    return 1
  fi
  return "$bad"
}

# Runs a check against the real file and reports one PASS or one FAIL.
guard() {
  local label="$1" out
  shift
  if out="$("$@" 2>&1)" && [ -z "$out" ]; then
    pass "$label"
  else
    fail "$label: $(printf '%s' "$out" | tr '\n' ';')"
  fi
}

guard "compose: api lifecycle keys" check_compose "$COMPOSE_FILE"
guard "entrypoint: exec node dist/index.js" check_entrypoint "$ENTRYPOINT_FILE"
guard "makefile: status waits for all four containers" check_makefile "$MAKEFILE"

# ── Negative controls: each check must fail on a mutated copy ───────────────

mut="$WORKDIR/mutated"
mkdir -p "$mut"

sed '/^    init: true$/d' "$COMPOSE_FILE" > "$mut/compose-no-init.yml"
if out="$(check_compose "$mut/compose-no-init.yml" 2>&1)"; then
  fail "control: compose check passed a file without init: true"
else
  pass "control: compose check fails a file without init: true"
fi

sed '/^    stop_grace_period: /d' "$COMPOSE_FILE" > "$mut/compose-no-grace.yml"
if out="$(check_compose "$mut/compose-no-grace.yml" 2>&1)"; then
  fail "control: compose check passed a file without stop_grace_period"
else
  pass "control: compose check fails a file without stop_grace_period"
fi

{ sed '$d' "$ENTRYPOINT_FILE"; echo "exec npm start"; } > "$mut/entrypoint-npm-start.sh"
if out="$(check_entrypoint "$mut/entrypoint-npm-start.sh" 2>&1)"; then
  fail "control: entrypoint check passed an exec npm start copy"
else
  pass "control: entrypoint check fails an exec npm start copy"
fi

sed 's/ triologue-redis//' "$MAKEFILE" > "$mut/Makefile-no-redis"
if out="$(check_makefile "$mut/Makefile-no-redis" 2>&1)"; then
  fail "control: makefile check passed a Makefile without triologue-redis"
else
  pass "control: makefile check fails a Makefile without triologue-redis"
fi

echo ""
echo "compose-lifecycle.test.sh: $pass_count passed, $fail_count failed"
[ "$fail_count" -eq 0 ]
