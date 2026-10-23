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
# The verdict reads the run state (.State.Status) first and the healthcheck
# second, because .State.Running stays true while a container is restarting or
# paused, a crash-looping container can keep a leftover healthy status, and a
# stopped container with a healthcheck reports unhealthy:
#   running    + healthy or none -> pass, once .RestartCount is unchanged since
#                                   the previous poll (a crash loop that is
#                                   momentarily running keeps counting up, so a
#                                   pass costs at least one extra interval)
#   running    + starting        -> pending (the healthcheck start period)
#   running    + unhealthy       -> fail at once
#   restarting + any health      -> pending; at the timeout it is named as
#                                   restarting
#   created, exited, dead, paused, removing, anything else -> fail at once
#   docker inspect fails         -> "container not found", fail
#
# Usage: wait-healthy.sh CONTAINER [CONTAINER ...]
#   HEALTH_TIMEOUT   seconds to wait before declaring failure (default 120)
#   HEALTH_INTERVAL  seconds between polls (default 5)
#
# Exit codes: 0 = every container healthy, or running with no healthcheck to wait
# for, with a stable restart count; 1 = a container is unhealthy, not running,
# missing, or still waiting at the timeout; 2 = no container names, or
# HEALTH_TIMEOUT / HEALTH_INTERVAL is not a positive integer of at most 6 digits
# without a leading zero.
set -eu

usage() {
	printf 'usage: %s CONTAINER [CONTAINER ...]\n' "${0##*/}" >&2
	printf '  set HEALTH_TIMEOUT (default 120) and HEALTH_INTERVAL (default 5) in seconds\n' >&2
}

if [ "$#" -eq 0 ]; then
	usage
	exit 2
fi

# $1 = variable name, $2 = its value. A positive base-10 integer of at most 6
# digits without a leading zero, or a usage message and exit 2: an unvalidated
# HEALTH_TIMEOUT=abc would otherwise die on the first arithmetic comparison,
# seconds into the wait, "08" is an invalid octal number to the shell, "010"
# would silently mean 8, and a 20-digit value overflows.
positive_int() {
	case "$2" in
		'' | *[!0-9]* | 0[0-9]* | ???????*)
			printf '%s: %s must be a whole number of seconds, 1 to 6 digits, no leading zero (got "%s")\n' "${0##*/}" "$1" "$2" >&2
			usage
			exit 2
			;;
	esac
	if [ "$((10#$2))" -lt 1 ]; then
		printf '%s: %s must be at least 1 second (got "%s")\n' "${0##*/}" "$1" "$2" >&2
		usage
		exit 2
	fi
}

HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"
positive_int HEALTH_TIMEOUT "$HEALTH_TIMEOUT"
positive_int HEALTH_INTERVAL "$HEALTH_INTERVAL"

# One container's state: "STATUS HEALTH RESTARTCOUNT", e.g. "running healthy 0".
# HEALTH is "none" when the image declares no healthcheck. The query itself only
# fails when the container is missing.
inspect() {
	docker inspect \
		--format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' \
		"$1" 2>/dev/null
}

# Restart count seen at the previous poll, as "name=count" lines (bash 3.2 has
# no associative arrays).
seen=""
prev_count() {
	printf '%s\n' "$seen" | sed -n "s/^$1=//p" | head -n 1
}
set_count() {
	seen="$(printf '%s\n' "$seen" | grep -v "^$1=" || true)
$1=$2"
}

waited=0
while :; do
	pending=""
	for name in "$@"; do
		if ! state="$(inspect "$name")"; then
			printf '%s: ERROR container not found (docker inspect failed)\n' "$name" >&2
			exit 1
		fi
		status="" health="" count=""
		read -r status health count <<< "$state" || true
		before="$(prev_count "$name")"
		set_count "$name" "$count"
		case "$status" in
			running)
				case "$health" in
					healthy | none)
						if [ "$before" != "$count" ]; then
							printf '%s: running, waiting for a stable restart count\n' "$name"
							pending="$pending $name(running, restart count not yet stable)"
						fi
						;;
					starting)
						printf '%s: starting\n' "$name"
						pending="$pending $name(starting)"
						;;
					*)
						printf '%s: ERROR %s (running but not healthy)\n' "$name" "$health" >&2
						exit 1
						;;
				esac
				;;
			restarting)
				printf '%s: restarting\n' "$name"
				pending="$pending $name(restarting)"
				;;
			*)
				printf '%s: ERROR %s (not healthy, not running)\n' "$name" "$status" >&2
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
