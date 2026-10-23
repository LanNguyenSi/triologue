#!/usr/bin/env bash
# Test driver for scripts/wait-healthy.sh. Stubs `docker` with a script on a
# PATH-prepended directory so no real container or daemon is needed. Run
# directly or via CI:
#   bash scripts/wait-healthy.test.sh
#
# Each case bounds its own wait with HEALTH_TIMEOUT/HEALTH_INTERVAL of a few
# seconds, so the whole suite finishes in seconds.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WAIT_SCRIPT="$SCRIPT_DIR/wait-healthy.sh"
if [ ! -f "$WAIT_SCRIPT" ]; then
  echo "FAIL: $WAIT_SCRIPT not found" >&2
  exit 2
fi

# Temp dir: on Linux CI a bare `mktemp -d` honours TMPDIR; WAIT_HEALTHY_TMPDIR
# forces an explicit template path (needed where `mktemp -d` ignores TMPDIR).
if [ -n "${WAIT_HEALTHY_TMPDIR:-}" ]; then
  WORKDIR="$(mktemp -d "${WAIT_HEALTHY_TMPDIR%/}/wh.XXXXXXXX")"
else
  WORKDIR="$(mktemp -d)"
fi
FAKE_BIN="$WORKDIR/bin"
mkdir -p "$FAKE_BIN"

export FAKE_COUNT="$WORKDIR/calls"

fail_count=0
pass_count=0
pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# A fake docker inspect. It ignores the --format template and prints the health
# token the mode selects, for the container named in the last argument.
write_fake_docker() {
  cat > "$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
name="${*: -1}"
mode="${FAKE_DOCKER_MODE:-ok_healthy}"
if [ "$mode" = missing ]; then
  echo "Error: No such object: $name" >&2
  exit 1
fi
case "$mode" in
  ok_healthy) printf 'healthy\n'; exit 0 ;;
  starting)   printf 'starting\n'; exit 0 ;;
  unhealthy)  printf 'unhealthy\n'; exit 0 ;;
  transition)
    n="${FAKE_TRANSITION_N:-2}"
    c=0
    [ -f "$FAKE_COUNT" ] && c="$(cat "$FAKE_COUNT")"
    c=$((c + 1))
    printf '%s\n' "$c" > "$FAKE_COUNT"
    if [ "$c" -ge "$n" ]; then printf 'healthy\n'; else printf 'starting\n'; fi
    exit 0 ;;
  mixed)
    for kv in ${FAKE_MIXED:-}; do
      if [ "${kv%%=*}" = "$name" ]; then printf '%s\n' "${kv#*=}"; exit 0; fi
    done
    printf 'none\n'; exit 0 ;;
  *)
    echo "unknown fake docker mode: $mode" >&2
    exit 2 ;;
esac
EOF
  chmod +x "$FAKE_BIN/docker"
}

# Run the script under test with the fake docker first on PATH.
run_wait() {
  PATH="$FAKE_BIN:$PATH" "$@"
}

# --- (a) all healthy at once -> exit 0, no waiting ---
{
  write_fake_docker
  rc=0
  out="$(FAKE_DOCKER_MODE=ok_healthy HEALTH_TIMEOUT=10 HEALTH_INTERVAL=1 \
    run_wait "$WAIT_SCRIPT" triologue-api 2>&1)" || rc=$?
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'all containers healthy'; then
    pass "(a) all healthy at once -> exit 0"
  else
    fail "(a) all healthy at once: rc=$rc out='$out'"
  fi
}

# --- (b) becomes healthy after some polls -> exit 0 ---
{
  write_fake_docker
  : > "$FAKE_COUNT"
  rc=0
  FAKE_DOCKER_MODE=transition FAKE_TRANSITION_N=3 HEALTH_TIMEOUT=15 HEALTH_INTERVAL=1 \
    run_wait "$WAIT_SCRIPT" triologue-api >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then
    pass "(b) becomes healthy after some polls -> exit 0"
  else
    fail "(b) becomes healthy after polls: rc=$rc"
  fi
}

# --- (c) stays starting -> exit 1 after the timeout ---
{
  write_fake_docker
  rc=0
  start_ts=$(date +%s)
  FAKE_DOCKER_MODE=starting HEALTH_TIMEOUT=2 HEALTH_INTERVAL=1 \
    run_wait "$WAIT_SCRIPT" triologue-api >/dev/null 2>&1 || rc=$?
  dur=$(( $(date +%s) - start_ts ))
  if [ "$rc" -eq 1 ] && [ "$dur" -ge 2 ]; then
    pass "(c) stays starting -> exit 1 after timeout (${dur}s)"
  else
    fail "(c) stays starting: rc=$rc dur=${dur}s (want rc=1, >=2s)"
  fi
}

# --- (d) unhealthy -> exit 1 ---
{
  write_fake_docker
  rc=0
  out="$(FAKE_DOCKER_MODE=unhealthy HEALTH_TIMEOUT=10 HEALTH_INTERVAL=1 \
    run_wait "$WAIT_SCRIPT" triologue-api 2>&1)" || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'unhealthy'; then
    pass "(d) unhealthy -> exit 1"
  else
    fail "(d) unhealthy: rc=$rc out='$out'"
  fi
}

# --- (e) container missing (inspect fails) -> exit 1 ---
{
  write_fake_docker
  rc=0
  out="$(FAKE_DOCKER_MODE=missing HEALTH_TIMEOUT=10 HEALTH_INTERVAL=1 \
    run_wait "$WAIT_SCRIPT" triologue-api 2>&1)" || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'cannot inspect'; then
    pass "(e) missing container -> exit 1"
  else
    fail "(e) missing container: rc=$rc out='$out'"
  fi
}

# --- (f) no container names -> exit non-zero with a usage message ---
{
  write_fake_docker
  rc=0
  out="$(run_wait "$WAIT_SCRIPT" 2>&1)" || rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'usage:'; then
    pass "(f) no container names -> exit non-zero with usage"
  else
    fail "(f) no container names: rc=$rc out='$out'"
  fi
}

# --- (g) multi-container: all healthy -> exit 0 ---
{
  write_fake_docker
  rc=0
  FAKE_DOCKER_MODE=ok_healthy HEALTH_TIMEOUT=10 HEALTH_INTERVAL=1 \
    run_wait "$WAIT_SCRIPT" triologue-api triologue-frontend triologue-postgres \
    >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then
    pass "(g) all three containers healthy -> exit 0"
  else
    fail "(g) multi-container healthy: rc=$rc"
  fi
}

# --- (h) multi-container: one stays starting -> exit 1 after timeout ---
{
  write_fake_docker
  rc=0
  FAKE_DOCKER_MODE=mixed FAKE_MIXED='triologue-api=healthy triologue-frontend=none triologue-postgres=starting' \
    HEALTH_TIMEOUT=2 HEALTH_INTERVAL=1 \
    run_wait "$WAIT_SCRIPT" triologue-api triologue-frontend triologue-postgres \
    >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 1 ]; then
    pass "(h) one container stuck starting -> exit 1 after timeout"
  else
    fail "(h) stuck starting: rc=$rc"
  fi
}

echo
echo "wait-healthy.test.sh: $pass_count passed, $fail_count failed"
rm -rf "$WORKDIR"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
