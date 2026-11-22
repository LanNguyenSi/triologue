#!/usr/bin/env bash
# Structural guards for the api container lifecycle:
#   - docker-compose.yml api has `init: true` and a `stop_grace_period`, so
#     `docker stop` reaches node (or the init shim) and the grace window is
#     longer than the server.close() timeout of the shutdown handler
#     (DEFAULT_CLOSE_TIMEOUT_MS, parsed from server/src/lib/shutdown.ts);
#   - server/entrypoint.sh's last line is `exec node dist/index.js`, so node
#     (not npm) is the long-running process that receives the signal;
#   - docker-compose.yml api sets TRUST_PROXY_HOPS with the default 2 (Traefik
#     and the frontend nginx in front of the api), so req.ip and the IP-keyed
#     rate limiters see the client address, not the Traefik address;
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
SHUTDOWN_FILE="$ROOT/server/src/lib/shutdown.ts"

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

check_trust_proxy() {
  local file="$1"
  if ! api_block "$file" | grep -Eq '^      TRUST_PROXY_HOPS: [$][{]TRUST_PROXY_HOPS:-2[}][[:space:]]*$'; then
    echo "api environment is missing TRUST_PROXY_HOPS with the default 2"
    return 1
  fi
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

# The compose grace period must be longer than the shutdown handler's close
# timeout, otherwise docker kills the container before the handler proceeds.
# Arguments: compose file, shutdown.ts.
check_grace_vs_timeout() {
  local compose="$1" shutdown="$2" grace_s timeout_ms
  grace_s="$(api_block "$compose" | sed -n 's/^    stop_grace_period: \([0-9]*\)s[[:space:]]*$/\1/p')"
  timeout_ms="$(sed -n 's/^export const DEFAULT_CLOSE_TIMEOUT_MS = \([0-9]*\);.*$/\1/p' "$shutdown")"
  if [ -z "$grace_s" ] || [ -z "$timeout_ms" ]; then
    echo "could not parse stop_grace_period (\"$grace_s\") or DEFAULT_CLOSE_TIMEOUT_MS (\"$timeout_ms\")"
    return 1
  fi
  if [ $((grace_s * 1000)) -le "$timeout_ms" ]; then
    echo "stop_grace_period ${grace_s}s is not longer than the ${timeout_ms}ms close timeout"
    return 1
  fi
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
guard "compose: stop_grace_period is longer than the close timeout" check_grace_vs_timeout "$COMPOSE_FILE" "$SHUTDOWN_FILE"
guard "compose: api trusts two proxy hops by default" check_trust_proxy "$COMPOSE_FILE"
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

sed 's/^    stop_grace_period: .*$/    stop_grace_period: 5s/' "$COMPOSE_FILE" > "$mut/compose-short-grace.yml"
if out="$(check_grace_vs_timeout "$mut/compose-short-grace.yml" "$SHUTDOWN_FILE" 2>&1)"; then
  fail "control: grace check passed a 5s stop_grace_period"
else
  pass "control: grace check fails a 5s stop_grace_period"
fi

sed 's/^export const DEFAULT_CLOSE_TIMEOUT_MS = .*;/export const DEFAULT_CLOSE_TIMEOUT_MS = 100000;/' "$SHUTDOWN_FILE" > "$mut/shutdown-long-timeout.ts"
if out="$(check_grace_vs_timeout "$COMPOSE_FILE" "$mut/shutdown-long-timeout.ts" 2>&1)"; then
  fail "control: grace check passed a 100000ms close timeout"
else
  pass "control: grace check fails a 100000ms close timeout"
fi

sed '/^      TRUST_PROXY_HOPS: /d' "$COMPOSE_FILE" > "$mut/compose-no-trust-proxy.yml"
if out="$(check_trust_proxy "$mut/compose-no-trust-proxy.yml" 2>&1)"; then
  fail "control: trust proxy check passed a file without TRUST_PROXY_HOPS"
else
  pass "control: trust proxy check fails a file without TRUST_PROXY_HOPS"
fi

sed 's/TRUST_PROXY_HOPS:-2}/TRUST_PROXY_HOPS:-1}/' "$COMPOSE_FILE" > "$mut/compose-one-hop.yml"
if out="$(check_trust_proxy "$mut/compose-one-hop.yml" 2>&1)"; then
  fail "control: trust proxy check passed a default of 1"
else
  pass "control: trust proxy check fails a default of 1"
fi

# The variable only in another service must not satisfy the api check.
awk '/^      TRUST_PROXY_HOPS: /{next} {print} /^  frontend:$/{print "    environment:"; print "      TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-2}"}' "$COMPOSE_FILE" > "$mut/compose-trust-proxy-on-frontend.yml"
if out="$(check_trust_proxy "$mut/compose-trust-proxy-on-frontend.yml" 2>&1)"; then
  fail "control: trust proxy check passed TRUST_PROXY_HOPS on the frontend service only"
else
  pass "control: trust proxy check fails TRUST_PROXY_HOPS on the frontend service only"
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
