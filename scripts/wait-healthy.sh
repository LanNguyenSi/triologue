#!/usr/bin/env bash
# wait-healthy.sh - block until every named Docker container is up: healthy when
# its image declares a healthcheck (api, postgres), simply running when it does
# not (the nginx frontend). Give up after HEALTH_TIMEOUT seconds and exit
# non-zero; a container that has exited or died fails at once instead of being
# waited for.
#
# It backs `make status` (and so `make restart` and `make deploy`): a deploy
# must not print a success line, nor unblock the next `make deploy` step, until
# the containers are actually up. The api healthcheck alone carries a 60s
# start period, so the old fixed `sleep 15` was too short to be honest.
#
# Usage: wait-healthy.sh CONTAINER [CONTAINER ...]
#   HEALTH_TIMEOUT   seconds to wait before declaring failure (default 120)
#   HEALTH_INTERVAL  seconds between polls (default 5)
#
# Exit codes: 0 = every container healthy, or running with no healthcheck to wait
# for; 1 = a container is unhealthy, not running, missing, or still waiting at
# the timeout; 2 = no container names, or HEALTH_TIMEOUT / HEALTH_INTERVAL is not
# a positive integer.
set -eu

usage() {
	printf 'usage: %s CONTAINER [CONTAINER ...]\n' "${0##*/}" >&2
	printf '  set HEALTH_TIMEOUT (default 120) and HEALTH_INTERVAL (default 5) in seconds\n' >&2
}

if [ "$#" -eq 0 ]; then
	usage
	exit 2
fi

# $1 = variable name, $2 = its value. A positive integer, or a usage message and
# exit 2: an unvalidated HEALTH_TIMEOUT=abc would otherwise die on the first
# arithmetic comparison, seconds into the wait and without a usage line.
positive_int() {
	case "$2" in
		'' | *[!0-9]*)
			printf '%s: %s must be a whole number of seconds (got "%s")\n' "${0##*/}" "$1" "$2" >&2
			usage
			exit 2
			;;
	esac
	if [ "$2" -lt 1 ]; then
		printf '%s: %s must be at least 1 second (got "%s")\n' "${0##*/}" "$1" "$2" >&2
		usage
		exit 2
	fi
}

HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
positive_int HEALTH_TIMEOUT "$HEALTH_TIMEOUT"
positive_int HEALTH_INTERVAL "$HEALTH_INTERVAL"

# One container's state as a single token. A container whose image declares a
# healthcheck reports the healthcheck status (starting, healthy, unhealthy); any
# other reports its run state (running, restarting, exited, dead, created,
# paused, removing), so a stopped container with no healthcheck can never be
# mistaken for a passing one. The query itself only fails when the container is
# missing.
inspect() {
	docker inspect \
		--format '{{if .State.Health}}{{.State.Health.Status}}{{else if .State.Running}}running{{else}}{{.State.Status}}{{end}}' \
		"$1" 2>/dev/null
}

waited=0
while :; do
	pending=""
	for name in "$@"; do
		if ! state="$(inspect "$name")"; then
			printf '%s: ERROR container not found (docker inspect failed)\n' "$name" >&2
			exit 1
		fi
		case "$state" in
			healthy | running) ;;
			starting | restarting)
				printf '%s: %s\n' "$name" "$state"
				pending="$pending $name"
				;;
			*)
				printf '%s: ERROR %s (not healthy, not running)\n' "$name" "$state" >&2
				exit 1
				;;
		esac
	done

	if [ -z "$pending" ]; then
		printf 'all containers up and healthy\n'
		exit 0
	fi

	if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
		printf 'timed out after %ss, still waiting for:%s\n' "$HEALTH_TIMEOUT" "$pending" >&2
		exit 1
	fi

	sleep "$HEALTH_INTERVAL"
	waited=$((waited + HEALTH_INTERVAL))
done
