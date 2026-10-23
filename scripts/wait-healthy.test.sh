#!/usr/bin/env bash
# Test driver for scripts/wait-healthy.sh. Stubs `docker` with a script on a
# PATH-prepended directory so no real container or daemon is needed. Run
# directly; CI runs it as a step of the test job. Needs bash, perl
# (the per-case watchdog; ubuntu-latest has it) and coreutils, nothing else:
#   bash scripts/wait-healthy.test.sh
#
# The fake docker models Docker's state fields, not the template text. Every
# fake container has a record under $FAKE_STATE_DIR/<name> with the fields
# `docker inspect` exposes: State.Status, State.Running, State.Health.Status (or
# no Health block at all) and RestartCount, optionally as a sequence over polls.
# The fake parses the --format it is given, accepts only the one template the
# script uses and renders it from those fields the way Docker does; any other
# template, or a record Docker could not produce (for example a restarting
# container with Running=false), fails loudly. Measured with Docker 29: Running
# stays true while a container is restarting or paused, and a stopped container
# with a healthcheck reports Health.Status=unhealthy.
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
# renders this one and rejects anything else.
FAKE_TEMPLATE='{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}'
export FAKE_STATE_DIR FAKE_TEMPLATE

fail_count=0
pass_count=0
rc=0
out=""
dur=0
pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# A fake `docker inspect --format TEMPLATE CONTAINER`. A missing record answers
# like a missing container (non-zero, "No such object"). Each call to this
# resets the state dir, so a case never inherits another's records.
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
n=0
[ -f "$rec/calls" ] && n="$(cat "$rec/calls")"
n=$((n + 1))
printf '%s\n' "$n" > "$rec/calls"
# One STATUS|RUNNING|HEALTH|RESTARTCOUNT line per call; the last line repeats.
line="$(sed -n "${n}p" "$rec/steps")"
[ -n "$line" ] || line="$(tail -n 1 "$rec/steps")"
IFS='|' read -r status running health rc <<< "$line"
# Records Docker cannot produce are a bug in the test, not a state to render.
case "$status" in
  running | restarting | paused)
    [ "$running" = "true" ] || { echo "fake docker: $status needs Running=true: $line" >&2; exit 4; } ;;
  created | exited | dead | removing) ;;
  *) echo "fake docker: unknown State.Status in record: $line" >&2; exit 4 ;;
esac
case "$status" in
  created | exited | dead)
    [ "$running" = "false" ] || { echo "fake docker: $status needs Running=false: $line" >&2; exit 4; } ;;
esac
case "$status" in
  exited | dead)
    [ "$health" != "healthy" ] || { echo "fake docker: $status cannot show healthy: $line" >&2; exit 4; } ;;
esac
# Render: {{.State.Status}} {{if .State.Health}}..{{else}}none{{end}} {{.RestartCount}}
if [ -n "$health" ]; then shown="$health"; else shown="none"; fi
printf '%s %s %s\n' "$status" "$shown" "$rc"
EOF
  chmod +x "$FAKE_BIN/docker"
}

# State record of one fake container, constant over polls. HEALTH empty means
# the image declares no healthcheck (no State.Health block).
#   set_state NAME STATUS RUNNING HEALTH [RESTARTCOUNT]
set_state() {
  local dir="$FAKE_STATE_DIR/$1"
  mkdir -p "$dir"
  printf '%s|%s|%s|%s\n' "$2" "$3" "$4" "${5:-0}" > "$dir/steps"
  rm -f "$dir/calls"
}

# State record that changes poll by poll: one "STATUS|RUNNING|HEALTH|RC" line
# per poll, the last line repeating.
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

# Number of times the script inspected a container.
calls_of() { cat "$FAKE_STATE_DIR/$1/calls" 2>/dev/null || echo 0; }

# Run the script under test with the fake docker first on PATH and explicit
# health bounds. Sets rc, out and dur (wall seconds).
run_case() {
  local start
  start="$(date +%s)"
  rc=0
  # A perl alarm in its own process group is the watchdog: a script under test that waits far longer than
  # any case should (a mutated input check, say) is killed with its children (rc 142) and fails
  # the case instead of hanging the suite.
  # shellcheck disable=SC2016  # the perl program is single-quoted on purpose
  out="$(env HEALTH_TIMEOUT="$1" HEALTH_INTERVAL="$2" PATH="$FAKE_BIN:$PATH" \
    perl -e 'setpgrp(0, 0); $SIG{ALRM} = sub { kill "TERM", -$$; exit 142 }; alarm 25;
      my $pid = fork(); if (!$pid) { exec @ARGV or die "exec: $!" } waitpid($pid, 0); exit($? >> 8)' \
    "$WAIT_SCRIPT" "${@:3}" 2>&1)" || rc=$?
  dur=$(( $(date +%s) - start ))
}

# --- (a) healthy and stable -> exit 0 after one confirming poll ---
{
  write_fake_docker
  set_state triologue-api running true healthy
  run_case 10 1 triologue-api
  if [ "$rc" -eq 0 ] && [ "$dur" -le 3 ] && printf '%s' "$out" | grep -q 'all containers up and healthy'; then
    pass "(a) healthy and stable -> exit 0"
  else
    fail "(a) healthy and stable: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (b) becomes healthy after some polls -> exit 0 ---
{
  write_fake_docker
  set_steps triologue-api 'running|true|starting|0' 'running|true|starting|0' 'running|true|healthy|0'
  run_case 15 1 triologue-api
  if [ "$rc" -eq 0 ]; then
    pass "(b) becomes healthy after some polls -> exit 0"
  else
    fail "(b) becomes healthy after polls: rc=$rc"
  fi
}

# --- (c) stays starting -> exit 1 after the timeout, named as starting ---
{
  write_fake_docker
  set_state triologue-api running true starting
  run_case 2 1 triologue-api
  if [ "$rc" -eq 1 ] && [ "$dur" -ge 2 ] && printf '%s' "$out" | grep -q 'triologue-api(starting)'; then
    pass "(c) stays starting -> exit 1 after timeout (${dur}s)"
  else
    fail "(c) stays starting: rc=$rc dur=${dur}s out='$out' (want rc=1, >=2s)"
  fi
}

# --- (d) running but unhealthy -> exit 1 at once ---
{
  write_fake_docker
  set_state triologue-api running true unhealthy
  run_case 30 1 triologue-api
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'unhealthy' && [ "$dur" -le 3 ]; then
    pass "(d) running + unhealthy -> exit 1 at once"
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

# --- (g) multi-container: all up -> exit 0 ---
{
  write_fake_docker
  set_state triologue-api running true healthy
  set_state triologue-frontend running true ''
  set_state triologue-postgres running true healthy
  run_case 10 1 triologue-api triologue-frontend triologue-postgres
  if [ "$rc" -eq 0 ]; then
    pass "(g) all three containers up -> exit 0"
  else
    fail "(g) multi-container up: rc=$rc out='$out'"
  fi
}

# --- (h) multi-container: one stays starting -> exit 1 after timeout ---
{
  write_fake_docker
  set_state triologue-api running true healthy
  set_state triologue-frontend running true ''
  set_state triologue-postgres running true starting
  run_case 2 1 triologue-api triologue-frontend triologue-postgres
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'triologue-postgres(starting)'; then
    pass "(h) one container stuck starting -> exit 1 after timeout"
  else
    fail "(h) stuck starting: rc=$rc out='$out'"
  fi
}

# --- (i) no healthcheck, running, stable -> pass without waiting for the timeout ---
{
  write_fake_docker
  set_state triologue-frontend running true '' 3
  run_case 30 1 triologue-frontend
  if [ "$rc" -eq 0 ] && [ "$dur" -le 3 ]; then
    pass "(i) running without a healthcheck, stable restart count -> exit 0"
  else
    fail "(i) running without healthcheck: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (j) stopped, no healthcheck -> exit 1 at once ---
{
  write_fake_docker
  set_state triologue-api running true healthy
  set_state triologue-frontend exited false ''
  run_case 30 1 triologue-api triologue-frontend
  if [ "$rc" -eq 1 ] && [ "$dur" -le 3 ] \
    && printf '%s' "$out" | grep -q 'triologue-frontend: ERROR exited'; then
    pass "(j) exited without a healthcheck -> exit 1 at once (${dur}s of 30s)"
  else
    fail "(j) exited without healthcheck: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (k) restarting (Running=true, no healthcheck) forever -> pending, fails at the timeout naming restarting ---
{
  write_fake_docker
  set_state triologue-frontend restarting true '' 5
  run_case 2 1 triologue-frontend
  if [ "$rc" -eq 1 ] && [ "$dur" -ge 2 ] && printf '%s' "$out" | grep -q 'triologue-frontend(restarting)'; then
    pass "(k) restarting -> keeps waiting, exit 1 at the timeout naming restarting (${dur}s)"
  else
    fail "(k) restarting: rc=$rc dur=${dur}s out='$out' (want rc=1, >=2s)"
  fi
}

# --- (l) restarting with a leftover healthy status is still not a pass ---
{
  write_fake_docker
  set_state triologue-api restarting true healthy 7
  run_case 2 1 triologue-api
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'triologue-api(restarting)'; then
    pass "(l) restarting + leftover healthy -> exit 1, named restarting"
  else
    fail "(l) restarting + healthy: rc=$rc out='$out'"
  fi
}

# --- (m) restarting that settles into running with a stable count -> exit 0 ---
{
  write_fake_docker
  set_steps triologue-frontend 'restarting|true||4' 'restarting|true||4' 'running|true||5' 'running|true||5'
  run_case 15 1 triologue-frontend
  if [ "$rc" -eq 0 ]; then
    pass "(m) restarting settles into running, stable count -> exit 0"
  else
    fail "(m) restarting settles: rc=$rc out='$out'"
  fi
}

# --- (n) crash loop seen in its short running phase: count keeps rising -> never a pass ---
{
  write_fake_docker
  set_steps triologue-frontend 'running|true||1' 'running|true||2' 'running|true||3' 'running|true||4' 'running|true||5' 'running|true||6'
  run_case 3 1 triologue-frontend
  if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'restart count not yet stable'; then
    pass "(n) running with a rising restart count -> exit 1 at the timeout"
  else
    fail "(n) crash loop in running phase: rc=$rc out='$out'"
  fi
}

# --- (o) crash loop with a leftover healthy status and a rising count -> never a pass ---
{
  write_fake_docker
  set_steps triologue-api 'running|true|healthy|1' 'running|true|healthy|2' 'running|true|healthy|3' 'running|true|healthy|4'
  run_case 2 1 triologue-api
  if [ "$rc" -eq 1 ]; then
    pass "(o) leftover healthy with a rising restart count -> exit 1"
  else
    fail "(o) leftover healthy crash loop: rc=$rc out='$out'"
  fi
}

# --- (p) paused (Running=true) is a failure at once, with or without a healthcheck ---
{
  write_fake_docker
  set_state triologue-frontend paused true ''
  run_case 30 1 triologue-frontend
  if [ "$rc" -eq 1 ] && [ "$dur" -le 3 ] && printf '%s' "$out" | grep -q 'triologue-frontend: ERROR paused'; then
    pass "(p) paused -> exit 1 at once"
  else
    fail "(p) paused: rc=$rc dur=${dur}s out='$out'"
  fi
  write_fake_docker
  set_state triologue-api paused true healthy
  run_case 30 1 triologue-api
  if [ "$rc" -eq 1 ] && [ "$dur" -le 3 ] && printf '%s' "$out" | grep -q 'triologue-api: ERROR paused'; then
    pass "(p) paused + leftover healthy -> exit 1 at once"
  else
    fail "(p) paused + healthy: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (q) stopped container with a healthcheck reports unhealthy in Docker; the run state names it ---
{
  write_fake_docker
  set_state triologue-api exited false unhealthy
  run_case 30 1 triologue-api
  if [ "$rc" -eq 1 ] && [ "$dur" -le 3 ] && printf '%s' "$out" | grep -q 'triologue-api: ERROR exited'; then
    pass "(q) exited + unhealthy -> exit 1 at once, named exited"
  else
    fail "(q) exited + unhealthy: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (r) created, dead and removing each fail at once (the script's catch-all arm) ---
for st in created:false dead:false removing:true; do
  write_fake_docker
  set_state triologue-frontend "${st%%:*}" "${st##*:}" ''
  run_case 30 1 triologue-frontend
  if [ "$rc" -eq 1 ] && [ "$dur" -le 3 ] && printf '%s' "$out" | grep -q "triologue-frontend: ERROR ${st%%:*}"; then
    pass "(r) ${st%%:*} -> exit 1 at once"
  else
    fail "(r) ${st%%:*}: rc=$rc dur=${dur}s out='$out'"
  fi
done

# --- (r2) container names are matched literally, not as a regex ---
# axb is polled first and leaves its count (1) in the bookkeeping. a.b has the
# same count but has never been seen: it must still wait one more poll. A regex
# match of "a.b" would read axb's entry, find an equal count and pass at once.
{
  write_fake_docker
  set_state axb running true healthy 1
  set_state a.b running true healthy 1
  run_case 10 1 axb a.b
  if [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -qF 'a.b: running, waiting for a stable restart count'; then
    pass "(r2) dotted name a.b is not confused with axb in the restart bookkeeping"
  else
    fail "(r2) dotted name: rc=$rc out=[$out]"
  fi
}

# --- (s) the wait stops within HEALTH_TIMEOUT plus one interval ---
{
  write_fake_docker
  set_state triologue-api running true starting
  run_case 3 1 triologue-api
  n="$(calls_of triologue-api)"
  if [ "$rc" -eq 1 ] && [ "$n" -eq 4 ]; then
    pass "(s) timeout 3, interval 1 -> polls at 0,1,2,3 seconds, then stops (4 inspect calls)"
  else
    fail "(s) timeout boundary 3/1: rc=$rc inspect calls=$n (want 4)"
  fi
  write_fake_docker
  set_state triologue-api running true starting
  run_case 3 2 triologue-api
  n="$(calls_of triologue-api)"
  if [ "$rc" -eq 1 ] && [ "$n" -eq 3 ]; then
    pass "(s) timeout 3, interval 2 -> polls at 0,2,4 seconds, then stops (3 inspect calls)"
  else
    fail "(s) timeout boundary 3/2: rc=$rc inspect calls=$n (want 3)"
  fi
}

# --- (t) HEALTH_TIMEOUT=abc -> usage, exit 2, before any waiting ---
{
  write_fake_docker
  set_state triologue-api running true healthy
  run_case abc 1 triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_TIMEOUT must be'; then
    pass "(t) HEALTH_TIMEOUT=abc -> exit 2"
  else
    fail "(t) HEALTH_TIMEOUT=abc: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (u) HEALTH_TIMEOUT=2.5 (not a whole number) -> exit 2 ---
{
  write_fake_docker
  set_state triologue-api running true healthy
  run_case 2.5 1 triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_TIMEOUT must be'; then
    pass "(u) HEALTH_TIMEOUT=2.5 -> exit 2"
  else
    fail "(u) HEALTH_TIMEOUT=2.5: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (v) HEALTH_TIMEOUT=0 -> exit 2 ---
{
  write_fake_docker
  set_state triologue-api running true healthy
  run_case 0 1 triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_TIMEOUT must be'; then
    pass "(v) HEALTH_TIMEOUT=0 -> exit 2"
  else
    fail "(v) HEALTH_TIMEOUT=0: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (w) HEALTH_INTERVAL=0 -> exit 2 ---
{
  write_fake_docker
  set_state triologue-api running true healthy
  run_case 10 0 triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_INTERVAL must be'; then
    pass "(w) HEALTH_INTERVAL=0 -> exit 2"
  else
    fail "(w) HEALTH_INTERVAL=0: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (x) HEALTH_INTERVAL=abc -> exit 2 ---
{
  write_fake_docker
  set_state triologue-api running true healthy
  run_case 10 abc triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_INTERVAL must be'; then
    pass "(x) HEALTH_INTERVAL=abc -> exit 2"
  else
    fail "(x) HEALTH_INTERVAL=abc: rc=$rc dur=${dur}s out='$out'"
  fi
}

# --- (y) leading zeros, over-long and overflowing values -> exit 2, never reach arithmetic ---
for v in 08 010 99999999999999999999 1234567 -5 +5; do
  write_fake_docker
  set_state triologue-api running true healthy
  run_case "$v" 1 triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_TIMEOUT must be'; then
    pass "(y) HEALTH_TIMEOUT=$v -> exit 2"
  else
    fail "(y) HEALTH_TIMEOUT=$v: rc=$rc dur=${dur}s out='$out'"
  fi
  run_case 10 "$v" triologue-api
  if [ "$rc" -eq 2 ] && [ "$dur" -le 2 ] && printf '%s' "$out" | grep -q 'HEALTH_INTERVAL must be'; then
    pass "(y) HEALTH_INTERVAL=$v -> exit 2"
  else
    fail "(y) HEALTH_INTERVAL=$v: rc=$rc dur=${dur}s out='$out'"
  fi
done

echo
echo "wait-healthy.test.sh: $pass_count passed, $fail_count failed"
rm -rf "$WORKDIR"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
