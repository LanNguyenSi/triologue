#!/usr/bin/env bash
# Smoke test of scripts/wait-healthy.sh against a real Docker daemon, to check
# the script against Docker's actual state fields rather than a fake. Starts
# throwaway containers with a unique name prefix (no network), covers the cases
# that the fake-docker suite (wait-healthy.test.sh) can only model, and removes
# every container on any exit. Run locally against a Docker daemon; it is not a
# CI step (it needs a daemon and a local image, and takes about 90 seconds).
# Skipped with exit 0 when no daemon answers.
#   bash scripts/wait-healthy.docker-test.sh
#   WAIT_HEALTHY_TEST_IMAGE=busybox bash scripts/wait-healthy.docker-test.sh
# The image only needs `sh` and `sleep`; by default the first of busybox, alpine
# and postgres:16-alpine that is already present locally is used (nothing is
# pulled).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WAIT_SCRIPT="${WAIT_SCRIPT:-$SCRIPT_DIR/wait-healthy.sh}"

if ! command -v docker > /dev/null 2>&1 || ! docker info > /dev/null 2>&1; then
  echo "SKIP: no Docker daemon reachable (docker info failed); real-Docker smoke test not run"
  exit 0
fi

IMAGE="${WAIT_HEALTHY_TEST_IMAGE:-}"
if [ -z "$IMAGE" ]; then
  for cand in busybox alpine postgres:16-alpine; do
    if docker image inspect "$cand" > /dev/null 2>&1; then IMAGE="$cand"; break; fi
  done
fi
if [ -z "$IMAGE" ]; then
  echo "SKIP: no local busybox, alpine or postgres:16-alpine image; set WAIT_HEALTHY_TEST_IMAGE"
  exit 0
fi

PREFIX="whtest$$-$(date +%s)"
cleanup() {
  local ids
  ids="$(docker ps -a -q --filter "name=$PREFIX" 2> /dev/null || true)"
  # shellcheck disable=SC2086
  [ -z "$ids" ] || docker rm -f $ids > /dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

fail_count=0
pass_count=0
pass() { pass_count=$((pass_count + 1)); echo "PASS: $1"; }
fail() { fail_count=$((fail_count + 1)); echo "FAIL: $1"; }

# start NAME [docker run options...] -- COMMAND : a detached container without
# network; the image entrypoint is replaced by sh so any of the images works.
start() {
  local name="$PREFIX-$1"
  shift
  docker run -d --name "$name" --network none "$@" > /dev/null
}

rc=0
out=""
# run_wh TIMEOUT INTERVAL NAME... : the script under test with explicit bounds.
# A perl alarm in its own process group is the watchdog (rc 142 and a kill of the
# whole group when the script outlasts its own bounds plus a margin), as in the
# fake-docker suite, so a hung script fails the case instead of hanging the run.
run_wh() {
  local limit=$(( $1 + 3 * $2 + 30 ))
  rc=0
  # shellcheck disable=SC2016  # the perl program is single-quoted on purpose
  out="$(env HEALTH_TIMEOUT="$1" HEALTH_INTERVAL="$2" \
    perl -e 'setpgrp(0, 0); my $limit = shift; $SIG{ALRM} = sub { kill "TERM", -$$; exit 142 }; alarm $limit;
      my $pid = fork(); if (!$pid) { exec @ARGV or die "exec: $!" } waitpid($pid, 0); exit($? >> 8)' \
    "$limit" "$WAIT_SCRIPT" "${@:3}" 2>&1)" || rc=$?
}
check() { run_wh 6 1 "$@"; }

# Verdicts: a pass is rc 0 with the success line; a failure is rc 1 with either
# the timeout line or an ERROR line, and the line names the container.
is_pass() { [ "$rc" -eq 0 ] && printf '%s' "$out" | grep -q 'all containers up and healthy'; }
is_fail_naming() {
  [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -Eq 'timed out after|ERROR' && printf '%s' "$out" | grep -qF "$1"
}

start plain --entrypoint sh "$IMAGE" -c 'sleep 300'
start hc --entrypoint sh --health-cmd 'exit 0' --health-interval 1s "$IMAGE" -c 'sleep 300'
start crash --entrypoint sh --restart unless-stopped "$IMAGE" -c 'exit 1'
start shortcrash --entrypoint sh --restart unless-stopped "$IMAGE" -c 'sleep 2; exit 1'
start slowcrash --entrypoint sh --restart unless-stopped "$IMAGE" -c 'sleep 7; exit 1'
start paused --entrypoint sh "$IMAGE" -c 'sleep 300'
docker pause "$PREFIX-paused" > /dev/null
start exited --entrypoint sh "$IMAGE" -c 'exit 0'
docker wait "$PREFIX-exited" > /dev/null

check "$PREFIX-plain"
if is_pass; then pass "running without a healthcheck -> pass"; else fail "running without a healthcheck: rc=$rc out='$out'"; fi

check "$PREFIX-hc"
if is_pass; then pass "running with a passing healthcheck -> pass"; else fail "running with a healthcheck: rc=$rc out='$out'"; fi

check "$PREFIX-crash"
if is_fail_naming "$PREFIX-crash"; then pass "crash loop without a healthcheck -> fail naming it (rc=$rc)"; else fail "crash loop: rc=$rc out='$out'"; fi

# A crash loop whose runs (2 s) are shorter than one HEALTH_INTERVAL (5 s) is
# inside the check: two polls 5 s apart can never both see the same run, so it
# must not pass.
run_wh 30 5 "$PREFIX-shortcrash"
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'timed out after' && printf '%s' "$out" | grep -qF "$PREFIX-shortcrash"; then
  pass "short-run crash loop (2 s runs, HEALTH_INTERVAL=5) -> fail at the timeout naming it"
else
  fail "short-run crash loop: rc=$rc out='$out'"
fi

# Documented limit: a crash loop whose running phase (7 s) outlasts one
# HEALTH_INTERVAL (5 s) can be seen running with an unchanged restart count at
# two polls, so the script may pass it. This case pins what the script does
# today and does not claim it is caught; either clean verdict is accepted.
run_wh 40 5 "$PREFIX-slowcrash"
echo "NOTE: slow crash loop (runs of 7 s, HEALTH_INTERVAL=5) -> rc=$rc; this is the documented limit of the restart check (see the header of wait-healthy.sh), not a guaranteed catch"
if is_pass || is_fail_naming "$PREFIX-slowcrash"; then pass "slow crash loop -> clean verdict, rc=$rc (documented limit, not asserted as caught)"; else fail "slow crash loop: rc=$rc out='$out'"; fi

check "$PREFIX-paused"
if is_fail_naming "$PREFIX-paused" && printf '%s' "$out" | grep -q 'ERROR paused'; then pass "paused -> fail naming paused"; else fail "paused: rc=$rc out='$out'"; fi

check "$PREFIX-exited"
if is_fail_naming "$PREFIX-exited" && printf '%s' "$out" | grep -q 'ERROR exited'; then pass "exited -> fail naming exited"; else fail "exited: rc=$rc out='$out'"; fi

check "$PREFIX-missing"
if is_fail_naming "$PREFIX-missing" && printf '%s' "$out" | grep -q 'not found'; then pass "missing -> not found"; else fail "missing: rc=$rc out='$out'"; fi

cleanup
left="$(docker ps -a -q --filter "name=$PREFIX" | wc -l | tr -d ' ')"
if [ "$left" -eq 0 ]; then pass "no test containers left behind"; else fail "$left test containers left behind"; fi

echo
echo "wait-healthy.docker-test.sh: $pass_count passed, $fail_count failed (image $IMAGE)"
[ "$fail_count" -eq 0 ]
