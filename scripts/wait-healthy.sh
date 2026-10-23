#!/usr/bin/env bash
# wait-healthy.sh - block until every named Docker container reports a healthy
# healthcheck, or give up after HEALTH_TIMEOUT seconds and exit non-zero.
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
# Exit codes: 0 = every container healthy (or has no healthcheck to wait for);
# 1 = a container is unhealthy, cannot be inspected, or is still not healthy at
# the timeout; 2 = no container names were given.
set -eu

usage() {
	printf 'usage: %s CONTAINER [CONTAINER ...]\n' "${0##*/}" >&2
	printf '  set HEALTH_TIMEOUT (default 120) and HEALTH_INTERVAL (default 5) in seconds\n' >&2
}

if [ "$#" -eq 0 ]; then
	usage
	exit 2
fi

HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

# One container's health as a single token. A container with no healthcheck
# reports "none" (it needs no waiting); the query only fails when the container
# is missing or never created, which the caller treats as a hard failure.
inspect() {
	docker inspect \
		--format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
		"$1" 2>/dev/null
}

waited=0
while :; do
	pending=""
	for name in "$@"; do
		if ! state="$(inspect "$name")"; then
			printf '%s: ERROR cannot inspect container (missing or not running)\n' "$name" >&2
			exit 1
		fi
		case "$state" in
			healthy | none) ;;
			unhealthy)
				printf '%s: unhealthy\n' "$name" >&2
				exit 1
				;;
			*)
				printf '%s: %s\n' "$name" "$state"
				pending="$pending $name"
				;;
		esac
	done

	if [ -z "$pending" ]; then
		printf 'all containers healthy\n'
		exit 0
	fi

	if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
		printf 'timed out after %ss, still not healthy:%s\n' "$HEALTH_TIMEOUT" "$pending" >&2
		exit 1
	fi

	sleep "$HEALTH_INTERVAL"
	waited=$((waited + HEALTH_INTERVAL))
done
