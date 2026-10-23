#!/usr/bin/env bash
# Test driver for scripts/wait-healthy.sh. Stubs `docker` with a script on a
# PATH-prepended directory so no real container or daemon is needed. Run
# directly or via CI:
#   bash scripts/wait-healthy.test.sh
#
# The fake docker models what `docker inspect --format` answers: every fake
# container has a state record under $FAKE_STATE_DIR/<name> (a health status, a
# running flag and a run state, the three fields the template reads), and the
# fake prints the token the real template produces for that record: the health
# status when the image declares a healthcheck, else "running" when the container
# runs, else the run state. It refuses any other template, so the script under
# test cannot drift away from the state semantics the fake implements.
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
FAKE_STATE_DIR="$WORKDIR/state"
mkdir -p "$FAKE_BIN" "$FAKE_STATE_DIR"

# The exact template wait-healthy.sh passes to `docker inspect`; the fake
# implements this one and rejects anything else.
FAKE_TEMPLATE='{{if .State.Health}}{{.State.Health.Status}}{{else if .State.Running}}running{{else}}{{.State.Status}}{{end}}'
export FAKE_STATE_DIR FAKE_TEMPLATE

fail_count=0
pass_count=0
rc=0
out=""
dur=0
pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# A fake `docker inspect --format TEMPLATE CONTAINER`. It reads the container's
# state record and prints what the real template would render for it; a missing
# record answers like a missing container (non-zero, "No such object"). Each call
# to this resets the state dir, so a case never inherits another's records.
write_fake_docker() {
  rm -rf "$FAKE_STATE_DIR"
  mkdir -p "$FAKE_STATE_DIR"
  cat > "$FAKE_BIN/docker" <<'EOF'
#!/usr/bin/env bash
sub="${1:-}"
shift || true
template="" name=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --format) template="$2"; shift 2 ;;
    --format=*) template="${1#--format=}"; shift ;;
    *) name="$1"; shift ;;
  esac
done
if [ "$sub" != "inspect" ]; then
  echo "fake docker: unsupported subcommand: $sub" >&2
  exit 2
fi
if [ "$template" != "$FAKE_TEMPLATE" ]; then
  echo "fake docker: unexpected inspect template: $template" >&2
  exit 3
fi
rec="$FAKE_STATE_DIR/$name"
if [ ! -d "$rec" ]; then
  echo "Error: No such object: $name" >&2
  exit 1
fi
if [ -f "$rec/steps" ]; then
  # State changes call by call: one HEALTH|RUNNING|STATUS line per call, and the
  # last line repeats for every later call.
  n=0
  [ -f "$rec/calls" ] && n="$(cat "$rec/calls")"
  n=$((n + 1))
  printf '%s\n' "$n" > "$rec/calls"
  line="$(sed -n "${n}p" "$rec/steps")"
  [ -n "$line" ] || line="$(tail -n 1 "$rec/steps")"
  IFS='|' read -r health running status <<< "$line"
  printf '%s' "$health" > "$rec/health"
  printf '%s' "$running" > "$rec/running"
  printf '%s' "$status" > "$rec/status"
else
  health="" running="false" status=""
  [ -f "$rec/health" ] && health="$(cat "$rec/health")"
  [ -f "$rec/running" ] && running="$(cat "$rec/running")"
  [ -f "$rec/status" ] && status="$(cat "$rec/status")"
fi
if [ -n "$health" ]; then
  printf '%s\n' "$health"
elif [ "$running" = "true" ]; then
  printf 'running\n'
else
  printf '%s\n' "$status"
fi
EOF
  chmod +x "$FAKE_BIN/docker"
}

# State record of one fake container. HEALTH empty means the image declares no
# healthcheck, so only the run state can be reported.
#   set_state NAME HEALTH RUNNING STATUS
set_state() {
  local dir="$FAKE_STATE_DIR/$1"
  mkdir -p "$dir"
  printf '%s' "$2" > "$dir/health"
  printf '%s' "$3" > "$dir/running"
  printf '%s' "$4" > "$dir/status"
  rm -f "$dir/steps" "$dir/calls"
}

# State record that changes call by call: one "HEALTH|RUNNING|STATUS" line per
# call, the last line repeating. Empty HEALTH means no healthcheck.
#   set_steps NAME STEP [STEP ...]
set_steps() {
  local name="$1" dir step
  shift
  dir="$FAKE_STATE_DIR/$name"
  mkdir -p "$dir"
  : > "$dir/steps"
  for step in "$@"; do printf '%s\n' "$step" >> "$dir/steps"; done
  rm -f "$dir/calls"
}

# Run the script under test with the fake docker first on PATH and explicit
# health bounds. Sets rc, out and dur (wall seconds).
run_case() {
  local start
  start="$(date +%s)"
  rc=0
  out="$(env HEALTH_TIMEOUT="$1" HEALTH_INTERVAL="$2" PATH="$FAKE_BIN:$PATH" \
    "$WAIT_SCRIPT" "${@:3}" 2>&1)" || rc=$?
  dur=$(( $(date +%s) - start ))
}

# --- (a) all healthy at once -> exit 0, no waiting ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  run_case 10 1 triologue-api
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'all containers up and healthy'; then
    pass "(a) all healthy at once -> exit 0"
  else
    fail "(a) all healthy at once: rc=$rc out='$out'"
  fi
}

# --- (b) becomes healthy after some polls -> exit 0 ---
{
  write_fake_docker
  set_steps triologue-api 'starting|true|running' 'starting|true|running' 'healthy|true|running'
  run_case 15 1 triologue-api
  if [ "$rc" -eq 0 ]; then
    pass "(b) becomes healthy after some polls -> exit 0"
  else
    fail "(b) becomes healthy after polls: rc=$rc"
  fi
}

# --- (c) stays starting -> exit 1 after the timeout ---
{
  write_fake_docker
  set_state triologue-api starting true running
  run_case 2 1 triologue-api
  if [ "$rc" -eq 1 ] && [ "$dur" -ge 2 ]; then
    pass "(c) stays starting -> exit 1 after timeout (${dur}s)"
  else
    fail "(c) stays starting: rc=$rc dur=${dur}s (want rc=1, >=2s)"
  fi
}

# --- (d) unhealthy -> exit 1 ---
{
  write_fake_docker
  set_state triologue-api unhealthy true running
  run_case 30 1 triologue-api
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'unhealthy' && [ "$dur" -le 3 ]; then
    pass "(d) unhealthy -> exit 1 at once"
  else
    fail "(d) unhealthy: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (e) container missing (inspect fails) -> exit 1, reported as not found ---
{
  write_fake_docker
  run_case 10 1 triologue-api
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'not found'; then
    pass "(e) missing container -> exit 1, 'not found'"
  else
    fail "(e) missing container: rc=$rc out='$out'"
  fi
}

# --- (f) no container names -> exit non-zero with a usage message ---
{
  write_fake_docker
  rc=0
  out="$(env PATH="$FAKE_BIN:$PATH" "$WAIT_SCRIPT" 2>&1)" || rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'usage:'; then
    pass "(f) no container names -> exit non-zero with usage"
  else
    fail "(f) no container names: rc=$rc out='$out'"
  fi
}

# --- (g) multi-container: all healthy -> exit 0 ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  set_state triologue-frontend healthy true running
  set_state triologue-postgres healthy true running
  run_case 10 1 triologue-api triologue-frontend triologue-postgres
  if [ "$rc" -eq 0 ]; then
    pass "(g) all three containers healthy -> exit 0"
  else
    fail "(g) multi-container healthy: rc=$rc"
  fi
}

# --- (h) multi-container: one stays starting -> exit 1 after timeout ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  set_state triologue-frontend '' true running
  set_state triologue-postgres starting true running
  run_case 2 1 triologue-api triologue-frontend triologue-postgres
  if [ "$rc" -eq 1 ]; then
    pass "(h) one container stuck starting -> exit 1 after timeout"
  else
    fail "(h) stuck starting: rc=$rc"
  fi
}

# --- (i) no healthcheck but running -> pass, exit 0 without waiting ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  set_state triologue-postgres healthy true running
  set_state triologue-frontend '' true running
  run_case 30 1 triologue-api triologue-frontend triologue-postgres
  if [ "$rc" -eq 0 ] && [ "$dur" -le 3 ]; then
    pass "(i) running container without a healthcheck -> exit 0 at once"
  else
    fail "(i) running without healthcheck: rc=$rc dur=${dur}s"
  fi
}

# --- (j) no healthcheck and exited -> exit 1 at once, not at the timeout ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  set_state triologue-postgres healthy true running
  set_state triologue-frontend '' false exited
  run_case 30 1 triologue-api triologue-frontend triologue-postgres
  if [ "$rc" -eq 1 ] && [ "$dur" -le 3 ] \
    && printf '%s' "$out" | grep -q 'triologue-frontend: ERROR exited'; then
    pass "(j) stopped container without a healthcheck -> exit 1 at once (${dur}s of 30s)"
  else
    fail "(j) stopped without healthcheck: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (k) restarting -> keeps waiting, exit 1 at the timeout ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  set_state triologue-frontend '' false restarting
  run_case 2 1 triologue-api triologue-frontend
  if [ "$rc" -eq 1 ] && [ "$dur" -ge 2 ]; then
    pass "(k) restarting -> keeps waiting, exit 1 after timeout (${dur}s)"
  else
    fail "(k) restarting: rc=$rc dur=${dur}s (want rc=1, >=2s)"
  fi
}

# --- (l) restarting that becomes running -> exit 0 ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  set_steps triologue-frontend '|false|restarting' '|false|restarting' '|true|running'
  run_case 15 1 triologue-api triologue-frontend
  if [ "$rc" -eq 0 ]; then
    pass "(l) restarting becomes running -> exit 0"
  else
    fail "(l) restarting becomes running: rc=$rc"
  fi
}

# --- (m) unknown run state -> exit 1 at once ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  set_state triologue-frontend '' false stopping
  run_case 30 1 triologue-api triologue-frontend
  if [ "$rc" -eq 1 ] && [ "$dur" -le 3 ] \
    && printf '%s' "$out" | grep -q 'triologue-frontend: ERROR stopping'; then
    pass "(m) unknown state -> exit 1 at once"
  else
    fail "(m) unknown state: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (n) HEALTH_TIMEOUT=abc -> usage, exit 2, before any waiting ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  run_case abc 1 triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_TIMEOUT must be'; then
    pass "(n) HEALTH_TIMEOUT=abc -> exit 2"
  else
    fail "(n) HEALTH_TIMEOUT=abc: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (o) HEALTH_TIMEOUT=2.5 (not a whole number) -> exit 2 ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  run_case 2.5 1 triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_TIMEOUT must be'; then
    pass "(o) HEALTH_TIMEOUT=2.5 -> exit 2"
  else
    fail "(o) HEALTH_TIMEOUT=2.5: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (p) HEALTH_TIMEOUT=0 -> exit 2 ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  run_case 0 1 triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_TIMEOUT must be'; then
    pass "(p) HEALTH_TIMEOUT=0 -> exit 2"
  else
    fail "(p) HEALTH_TIMEOUT=0: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (q) HEALTH_INTERVAL=0 -> exit 2 ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  run_case 10 0 triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_INTERVAL must be'; then
    pass "(q) HEALTH_INTERVAL=0 -> exit 2"
  else
    fail "(q) HEALTH_INTERVAL=0: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (r) HEALTH_INTERVAL=abc -> exit 2 ---
{
  write_fake_docker
  set_state triologue-api healthy true running
  run_case 10 abc triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_INTERVAL must be'; then
    pass "(r) HEALTH_INTERVAL=abc -> exit 2"
  else
    fail "(r) HEALTH_INTERVAL=abc: rc=$rc dur=${dur}s out='$out'"
  fi
}

echo
echo "wait-healthy.test.sh: $pass_count passed, $fail_count failed"
rm -rf "$WORKDIR"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
