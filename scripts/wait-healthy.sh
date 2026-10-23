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
#   running    + healthy or none -> pass, once the previous poll also saw it
#                                   running with the same .RestartCount (so a
#                                   pass costs at least one extra interval)
#   running    + starting        -> pending (the healthcheck start period)
#   running    + unhealthy       -> fail at once
#   restarting + any health      -> pending; at the timeout it is named as
#                                   restarting
#   created, exited, dead, paused, removing, anything else -> fail at once
#   docker inspect fails         -> "container not found", fail
#
# Limit of the restart check. Docker raises .RestartCount when a container enters
# `restarting`, and the start that follows keeps that count (restarting 4 ->
# running 4), so a count alone cannot tell a settled container from one that
# has just been restarted. The script therefore passes a container only when two
# consecutive polls both see it `running` with the same count (and `healthy`
# on the second poll when it has a healthcheck). Caught: the restarting,
# paused, exited, dead and unhealthy states, a restart between two polls, and
# any crash loop whose running phase is shorter than one HEALTH_INTERVAL (the
# loop shows up as restarting or as a moved count at one of the two polls). Not
# caught: a crash loop whose running phase outlasts one HEALTH_INTERVAL (for
# example runs of 7 s with HEALTH_INTERVAL=5; Docker resets its restart backoff
# after 10 s of uptime, so runs of 10 s or more pass almost every time), and a
# container that fails after the wait is over. A larger HEALTH_INTERVAL
# lengthens the running phase that is still caught, but does not close the gap.
#
# Usage: wait-healthy.sh CONTAINER [CONTAINER ...]
#   HEALTH_TIMEOUT   seconds to wait before declaring failure (default 120)
#   HEALTH_INTERVAL  seconds between polls (default 5)
#
# Exit codes: 0 = every container healthy, or running with no healthcheck to wait
# for, at two consecutive polls with the same restart count; 1 = a container is
# unhealthy, not running, missing, or still waiting at the timeout; 2 = no
# container names, or HEALTH_TIMEOUT / HEALTH_INTERVAL is not a positive integer
# of at most 6 digits without a leading zero.
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

# Run state and restart count seen at the previous poll, as "name=status:count"
# lines (bash 3.2 has no associative arrays). Names are matched literally (awk
# string compare), not as a regex: a dot in a container name must not match
# another character.
seen=""
prev_count() {
	printf '%s\n' "$seen" | awk -F= -v n="$1" '$1 == n { print $2; exit }'
}
set_count() {
	seen="$(printf '%s\n' "$seen" | awk -F= -v n="$1" '$1 != n')
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
		set_count "$name" "$status:$count"
		case "$status" in
			running)
				case "$health" in
					healthy | none)
						if [ "$before" != "running:$count" ]; then
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
