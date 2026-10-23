#!/usr/bin/env bash
# Smoke test of scripts/wait-healthy.sh against a real Docker daemon, to check
# the script against Docker's actual state fields rather than a fake. Starts
# throwaway containers with a unique name prefix (no network), covers the cases
# that the fake-docker suite (wait-healthy.test.sh) can only model, and removes
# every container on any exit. Skipped with exit 0 when no daemon answers.
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
check() {
  rc=0
  out="$(env HEALTH_TIMEOUT=6 HEALTH_INTERVAL=1 "$WAIT_SCRIPT" "$@" 2>&1)" || rc=$?
}

start plain --entrypoint sh "$IMAGE" -c 'sleep 300'
start hc --entrypoint sh --health-cmd 'exit 0' --health-interval 1s "$IMAGE" -c 'sleep 300'
start crash --entrypoint sh --restart unless-stopped "$IMAGE" -c 'exit 1'
start paused --entrypoint sh "$IMAGE" -c 'sleep 300'
docker pause "$PREFIX-paused" > /dev/null
start exited --entrypoint sh "$IMAGE" -c 'exit 0'
docker wait "$PREFIX-exited" > /dev/null

check "$PREFIX-plain"
if [ "$rc" -eq 0 ]; then pass "running without a healthcheck -> pass"; else fail "running without a healthcheck: rc=$rc out='$out'"; fi

check "$PREFIX-hc"
if [ "$rc" -eq 0 ]; then pass "running with a passing healthcheck -> pass"; else fail "running with a healthcheck: rc=$rc out='$out'"; fi

check "$PREFIX-crash"
if [ "$rc" -ne 0 ]; then pass "crash loop without a healthcheck -> not a pass (rc=$rc)"; else fail "crash loop passed: out='$out'"; fi

check "$PREFIX-paused"
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'ERROR paused'; then pass "paused -> fail naming paused"; else fail "paused: rc=$rc out='$out'"; fi

check "$PREFIX-exited"
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'ERROR exited'; then pass "exited -> fail naming exited"; else fail "exited: rc=$rc out='$out'"; fi

check "$PREFIX-missing"
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'not found'; then pass "missing -> not found"; else fail "missing: rc=$rc out='$out'"; fi

cleanup
left="$(docker ps -a -q --filter "name=$PREFIX" | wc -l | tr -d ' ')"
if [ "$left" -eq 0 ]; then pass "no test containers left behind"; else fail "$left test containers left behind"; fi

echo
echo "wait-healthy.docker-test.sh: $pass_count passed, $fail_count failed (image $IMAGE)"
[ "$fail_count" -eq 0 ]
