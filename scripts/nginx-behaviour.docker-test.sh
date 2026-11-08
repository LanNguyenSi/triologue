#!/usr/bin/env bash
# Behavioural test of the four nginx proxy configs against a real nginx.
# scripts/nginx-configs.test.sh checks the configs structurally (fast, no
# daemon); this script runs each one in the nginx image client/Dockerfile uses
# and proves the two invariants at runtime:
#   1. a 10 MB body to /api/ is let through and a 13 MB body gets 413
#      (client_max_body_size 12m in location ^~ /api/),
#   2. GET and POST /api/files/<x>?token=SECRET never put the token or the
#      query into the access log, while the upstream still receives the query;
#      a request outside /api/files/ still logs its query, so the log check is
#      not vacuous.
# Per config: a private docker network, a stub upstream (nginx answering 200
# and echoing the request line it received) under the config's upstream
# hostname, and the nginx under test with the config copied to
# /etc/nginx/conf.d/default.conf (docker cp, not a bind mount, so it also works
# when the daemon cannot see the host's temp directory). client/nginx.conf is
# the TLS template: a throwaway self-signed certificate is placed at the
# letsencrypt path and requests go over 443 with -k.
#
#   bash scripts/nginx-behaviour.docker-test.sh
#
# Environment:
#   NGINX_BEHAVIOUR_REQUIRE_DOCKER=1   fail instead of skipping when no docker
#                                      daemon answers (the CI job sets it)
#   NGINX_BEHAVIOUR_ONLY=<substring>   only the configs whose path contains it
#   NGINX_BEHAVIOUR_MUTATE=<mutation>  negative control: test a mutated copy of
#                                      every selected config; the run must FAIL
#                                      (exit 1). Mutations:
#                                        no-body-limit       delete client_max_body_size
#                                        default-log-format  files access_log
#                                                            without files_without_query
# Skipped with exit 0 (SKIP: line) when no docker daemon answers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CONFIGS=(
  "client/nginx.default.conf:api-host=triologue-api:tls=0"
  "nginx/traefik.conf:api-host=triologue-api:tls=0"
  "nginx/dev.conf:api-host=api:tls=0"
  "client/nginx.conf:api-host=triologue-api:tls=1"
)

if ! command -v docker > /dev/null 2>&1 || ! docker info > /dev/null 2>&1; then
  if [ "${NGINX_BEHAVIOUR_REQUIRE_DOCKER:-}" = "1" ]; then
    echo "FAIL: no docker daemon reachable and NGINX_BEHAVIOUR_REQUIRE_DOCKER=1" >&2
    exit 1
  fi
  echo "SKIP: no Docker daemon reachable (docker info failed); nginx behaviour test not run"
  exit 0
fi

MUTATE="${NGINX_BEHAVIOUR_MUTATE:-}"
case "$MUTATE" in
  "" | no-body-limit | default-log-format) ;;
  *)
    echo "FAIL: unknown NGINX_BEHAVIOUR_MUTATE value: $MUTATE" >&2
    exit 2
    ;;
esac

# The image the frontend actually ships: the last FROM nginx line of the
# Dockerfile, so a later digest pin is followed without editing this script.
IMAGE="$(awk '$1 == "FROM" && $2 ~ /^nginx([:@]|$)/ { img = $2 } END { print img }' "$REPO_ROOT/client/Dockerfile")"
if [ -z "$IMAGE" ]; then
  echo "FAIL: no 'FROM nginx...' line in client/Dockerfile" >&2
  exit 2
fi

TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"
WORK="$(mktemp -d "$TMP_ROOT/nginx-behaviour.XXXXXX")"
RUN_ID="nginxbeh-$$-$(date +%s)"
CREATED_CONTAINERS=()
CREATED_NETWORKS=()

cleanup() {
  local c n
  for c in ${CREATED_CONTAINERS[@]+"${CREATED_CONTAINERS[@]}"}; do
    docker rm -f "$c" > /dev/null 2>&1 || true
  done
  for n in ${CREATED_NETWORKS[@]+"${CREATED_NETWORKS[@]}"}; do
    docker network rm "$n" > /dev/null 2>&1 || true
  done
  CREATED_CONTAINERS=()
  CREATED_NETWORKS=()
}
final_cleanup() {
  cleanup
  # Remove the temp dir only by the literal path mktemp printed, and only if it
  # still has the shape mktemp gave it.
  case "$WORK" in
    "$TMP_ROOT"/nginx-behaviour.??????)
      if [ -d "$WORK" ] && [ ! -L "$WORK" ]; then rm -rf "$WORK"; fi
      ;;
    *) echo "WARN: not removing unexpected temp path: $WORK" >&2 ;;
  esac
}
trap final_cleanup EXIT

FAILURES=0
fail() {
  echo "  FAIL: $*"
  FAILURES=$((FAILURES + 1))
}
pass() { echo "  ok: $*"; }

# Write the stub upstream config and the 10/13 MB payload sizes.
cat > "$WORK/stub.conf" << 'STUB'
server {
    listen 3001;
    client_max_body_size 0;
    location / {
        default_type text/plain;
        return 200 "STUB method=$request_method uri=$request_uri\n";
    }
}
STUB

mutate_config() { # mutate_config <src> <dst>
  local src="$1" dst="$2"
  case "$MUTATE" in
    no-body-limit)
      sed -E '/^[[:space:]]*client_max_body_size[[:space:]]/d' "$src" > "$dst"
      ;;
    default-log-format)
      sed -E 's/^([[:space:]]*access_log[[:space:]]+[^ ;]+)[[:space:]]+files_without_query;/\1;/' "$src" > "$dst"
      ;;
  esac
  if cmp -s "$src" "$dst"; then
    echo "FAIL: mutation $MUTATE changed nothing in $src" >&2
    exit 2
  fi
}

run_config() { # run_config <repo-relative config> <upstream host> <tls 0|1>
  local rel="$1" api_host="$2" tls="$3"
  local tag net stub ngx conf scheme dir
  tag="$RUN_ID-$(basename "$rel" .conf | tr -c 'a-z0-9\n' '-')"
  net="$tag-net"
  stub="$tag-stub"
  ngx="$tag-ngx"
  dir="$WORK/$(basename "$rel")"
  mkdir -p "$dir"
  conf="$REPO_ROOT/$rel"
  if [ -n "$MUTATE" ]; then
    mutate_config "$conf" "$dir/default.conf"
    conf="$dir/default.conf"
    echo "  mutation: $MUTATE"
  fi
  scheme=http
  [ "$tls" = 1 ] && scheme=https

  docker network create "$net" > /dev/null
  CREATED_NETWORKS+=("$net")

  docker create --name "$stub" --network "$net" --network-alias "$api_host" "$IMAGE" > /dev/null
  CREATED_CONTAINERS+=("$stub")
  docker cp "$WORK/stub.conf" "$stub:/etc/nginx/conf.d/default.conf"
  docker start "$stub" > /dev/null

  docker create --name "$ngx" --network "$net" "$IMAGE" > /dev/null
  CREATED_CONTAINERS+=("$ngx")
  docker cp "$conf" "$ngx:/etc/nginx/conf.d/default.conf"
  if [ "$tls" = 1 ]; then
    local cert="$dir/stage/etc/letsencrypt/live/opentriologue.ai"
    mkdir -p "$cert"
    openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=opentriologue.ai" \
      -keyout "$cert/privkey.pem" -out "$cert/fullchain.pem" > /dev/null 2>&1
    tar -C "$dir/stage" -cf - etc | docker cp - "$ngx:/"
  fi
  docker start "$ngx" > /dev/null

  # Readiness: bounded loop (30 x 0.5 s), any HTTP status counts.
  local i code ready=0 curl_base=(curl -s -k -m 20)
  [ "$tls" = 1 ] && curl_base+=(-H "Host: opentriologue.ai")
  for ((i = 0; i < 60; i++)); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$ngx" 2> /dev/null)" != "true" ]; then break; fi
    code="$(docker exec "$ngx" "${curl_base[@]}" -o /dev/null -w '%{http_code}' "$scheme://127.0.0.1/api/ready" 2> /dev/null || true)"
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      ready=1
      break
    fi
    sleep 0.5
  done
  if [ "$ready" != 1 ]; then
    fail "nginx did not become ready"
    docker logs "$ngx" 2>&1 | tail -n 10 | sed 's/^/    /'
    cleanup
    return
  fi

  docker exec "$ngx" sh -c 'head -c 10485760 /dev/zero > /tmp/b10m; head -c 13631488 /dev/zero > /tmp/b13m'

  req() { docker exec "$ngx" "${curl_base[@]}" "$@" || true; }
  status() { req -o /dev/null -w '%{http_code}' "$@"; }

  # 1. Body limit.
  code="$(status -X POST --data-binary @/tmp/b10m "$scheme://127.0.0.1/api/x")"
  if [ "$code" = 200 ]; then pass "10 MB POST /api/x -> $code"; else fail "10 MB POST /api/x -> $code (want 200)"; fi
  code="$(status -X POST --data-binary @/tmp/b13m "$scheme://127.0.0.1/api/x")"
  if [ "$code" = 413 ]; then pass "13 MB POST /api/x -> 413"; else fail "13 MB POST /api/x -> $code (want 413)"; fi

  # 2. Token never logged, query still reaches the upstream.
  local body
  body="$(req "$scheme://127.0.0.1/api/files/x?token=SECRET123")"
  case "$body" in
    *"method=GET uri=/api/files/x?token=SECRET123"*) pass "GET files: upstream got the query" ;;
    *) fail "GET files: upstream did not get the query (got: $body)" ;;
  esac
  body="$(req -X POST -d a=b "$scheme://127.0.0.1/api/files/x?token=SECRET123")"
  case "$body" in
    *"method=POST uri=/api/files/x?token=SECRET123"*) pass "POST files: upstream got the query" ;;
    *) fail "POST files: upstream did not get the query (got: $body)" ;;
  esac
  # A request outside /api/files/ keeps the default format, query included.
  status "$scheme://127.0.0.1/api/other?plain=VISIBLE456" > /dev/null

  local log files_lines
  sleep 0.5
  log="$(docker logs "$ngx" 2> /dev/null || true)"
  files_lines="$(printf '%s\n' "$log" | grep -c '/api/files/x' || true)"
  if [ "$files_lines" -ge 2 ]; then pass "access log has $files_lines /api/files/x lines"; else fail "access log has $files_lines /api/files/x lines (want >= 2)"; fi
  if printf '%s\n' "$log" | grep -q 'SECRET123'; then
    fail "SECRET123 found in nginx access log"
    printf '%s\n' "$log" | grep 'SECRET123' | head -n 3 | sed 's/^/    /'
  else
    pass "no SECRET123 in access log"
  fi
  if printf '%s\n' "$log" | grep '/api/files/x' | grep -q 'token='; then
    fail "token= found in a /api/files/ access log line"
  else
    pass "no token= in /api/files/ access log lines"
  fi
  if printf '%s\n' "$log" | grep -q 'plain=VISIBLE456'; then
    pass "non-files request still logs its query (log check not vacuous)"
  else
    fail "non-files request did not log its query; the log check would be vacuous"
  fi

  cleanup
}

echo "image: $IMAGE"
RAN=0
for entry in "${CONFIGS[@]}"; do
  rel="${entry%%:*}"
  rest="${entry#*:}"
  api_host="${rest#api-host=}"
  api_host="${api_host%%:*}"
  tls="${entry##*tls=}"
  if [ -n "${NGINX_BEHAVIOUR_ONLY:-}" ] && [[ "$rel" != *"$NGINX_BEHAVIOUR_ONLY"* ]]; then continue; fi
  echo "== $rel (upstream $api_host, tls=$tls)"
  before=$FAILURES
  run_config "$rel" "$api_host" "$tls"
  RAN=$((RAN + 1))
  if [ "$FAILURES" -eq "$before" ]; then echo "PASS: $rel"; else echo "FAIL: $rel"; fi
done

if [ "$RAN" -eq 0 ]; then
  echo "FAIL: NGINX_BEHAVIOUR_ONLY matched no config" >&2
  exit 2
fi
if [ "$FAILURES" -gt 0 ]; then
  echo "FAIL: $FAILURES check(s) failed"
  exit 1
fi
echo "PASS: all $RAN config(s)"
