#!/usr/bin/env bash
# Guards the nginx config the client image bakes into
# /etc/nginx/conf.d/default.conf. The file under test is read from the COPY line
# of client/Dockerfile, so re-pointing the Dockerfile at another file cannot
# dodge the checks. That config is what runs whenever nothing mounts its own
# config over it (both compose files do), and the image ships no certificates,
# so it must:
#   - serve plain HTTP on port 80, the port both compose files expect inside the
#     container, and carry no TLS directive (a certificate path the image does
#     not have makes nginx fail at start and the container restart-loop),
#   - keep the SPA fallback and the /api/, /socket.io/ and /uploads/ proxies to
#     the same upstream the TLS template uses,
#   - set no wildcard Access-Control-Allow-Origin (the SPA is same-origin and the
#     API sets its own CORS headers, server/src/index.ts).
# Needs no docker and no nginx binary; it is a structural check of the text.
#   bash scripts/frontend-nginx-default.test.sh [--config <file>]
# --config checks the given file instead of the one client/Dockerfile copies, so
# the TLS template client/nginx.conf is expected to fail these checks.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCKERFILE="$ROOT/client/Dockerfile"
CONFIG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --config)
      if [ $# -lt 2 ]; then
        echo "FAIL: --config needs a file path"
        exit 2
      fi
      CONFIG="$2"
      shift 2
      ;;
    *)
      echo "FAIL: unknown argument: $1"
      exit 2
      ;;
  esac
done

if [ -z "$CONFIG" ]; then
  if [ ! -f "$DOCKERFILE" ]; then
    echo "FAIL: $DOCKERFILE not found"
    exit 1
  fi
  srcs="$(awk '$1 == "COPY" && $NF ~ /\/etc\/nginx\/conf\.d\/default\.conf$/ { print $2 }' "$DOCKERFILE")"
  n="$(printf '%s\n' "$srcs" | grep -c . || true)"
  if [ "$n" -ne 1 ]; then
    echo "FAIL: expected exactly one COPY into /etc/nginx/conf.d/default.conf in client/Dockerfile, found $n"
    exit 1
  fi
  CONFIG="$ROOT/client/$srcs"
fi

fails=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
has() { grep -Eiq -- "$1" "$CONFIG"; }
hasf() { grep -Fqi -- "$1" "$CONFIG"; }

if [ ! -f "$CONFIG" ]; then
  echo "FAIL: config not found: $CONFIG"
  echo "checked failed=1"
  exit 1
fi
label="${CONFIG#"$ROOT"/}"
echo "frontend-nginx-default: checking $label"

if has 'ssl_[a-z_]+'; then
  fail "$label: carries a TLS directive, the image ships no certificates"
else
  pass "$label: no ssl_* directive"
fi

if has 'listen[^;]*(^|[[:space:]])ssl([[:space:];]|$)' || has 'listen[[:space:]]+443([^0-9]|$)'; then
  fail "$label: listens with TLS or on 443, nothing in the image terminates TLS"
else
  pass "$label: no TLS or 443 listener"
fi

if has '^[[:space:]]*listen[[:space:]]+80[[:space:]]*;'; then
  pass "$label: plain HTTP server on port 80"
else
  fail "$label: no plain HTTP 'listen 80;' server (both compose files expect port 80 inside the container)"
fi

if has 'return[[:space:]]+30[1238][[:space:]]+https://'; then
  fail "$label: redirects to https, which is dead when no TLS is configured"
else
  pass "$label: no redirect to https"
fi

# Fixed string, not just any try_files: the html location also falls back to
# index.html, and the SPA routing depends on the one in "location /".
# shellcheck disable=SC2016
if hasf 'try_files $uri $uri/ /index.html;'; then
  pass "$label: SPA fallback to index.html"
else
  fail "$label: no 'try_files \$uri \$uri/ /index.html;' fallback, client-side routes would 404"
fi

for path in api socket.io uploads; do
  # /api/ is a "^~" prefix location so no regex location can take an /api/ path
  # (scripts/nginx-configs.test.sh asserts that form); the others stay plain.
  if { hasf "location /${path}/ {" || hasf "location ^~ /${path}/ {"; } && hasf "proxy_pass http://triologue-api:3001/${path}/;"; then
    pass "$label: /${path}/ proxied to triologue-api:3001"
  else
    fail "$label: /${path}/ is not proxied to triologue-api:3001 the way the TLS template does"
  fi
done

if has 'add_header[[:space:]]+Access-Control-Allow-Origin[[:space:]]+\*'; then
  fail "$label: wildcard Access-Control-Allow-Origin, the SPA is same-origin and the API sets its own CORS headers"
else
  pass "$label: no wildcard Access-Control-Allow-Origin"
fi

if [ -f "$DOCKERFILE" ] && grep -Eq '^[[:space:]]*EXPOSE([^#]*[^0-9])?443([^0-9]|$)' "$DOCKERFILE"; then
  fail "client/Dockerfile: EXPOSE advertises 443 while the image listens on 80 only"
else
  pass "client/Dockerfile: no EXPOSE 443"
fi

echo "checked failed=$fails"
if [ "$fails" -gt 0 ]; then
  exit 1
fi
