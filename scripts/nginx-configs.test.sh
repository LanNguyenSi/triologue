#!/usr/bin/env bash
# Structural checks for every nginx config that proxies /api/
# (client/nginx.conf, client/nginx.default.conf, nginx/traefik.conf,
# nginx/dev.conf):
#   - location /api/ raises client_max_body_size to at least the server's
#     upload limit without going unlimited (0 is nginx's "unlimited"), and the
#     block carries a comment naming where that limit lives
#     (MAX_FILE_SIZE in server/src/routes/upload.ts), so the two stay in step,
#   - the files route has its own location /api/files/ whose access_log uses a
#     log_format defined at the top level of the same file (these files are
#     included inside http {}, so a top-level log_format is http level; the
#     test checks it sits before the first server block), and that format
#     never carries $request, $args or $query_string, so the ?token=<jwt> file
#     token (client/src/lib/fileUrl.ts, accepted by server/src/routes/files.ts)
#     stays out of the container log,
#   - the files location proxies to the same upstream as location /api/ with a
#     path that matches its location and nothing that rewrites $args, so the
#     proxied request still carries the query the server needs,
#   - the access log is never switched off anywhere in the file.
# If nginx is on PATH the test also runs nginx -t against a wrapper that
# includes each file inside http {}; the compose upstream hostnames and the
# TLS template's certificate paths only exist inside the deployed container,
# so an nginx -t that fails only for one of those is reported as a skip.
# Needs no docker; the structural checks need no nginx binary either.
#   bash scripts/nginx-configs.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

CONFIGS=(
  client/nginx.conf
  client/nginx.default.conf
  nginx/traefik.conf
  nginx/dev.conf
)

# The server accepts uploads of exactly this many MB (MAX_FILE_SIZE in
# server/src/routes/upload.ts); the nginx limit must not stay below it.
MIN_UPLOAD_MB=10

fails=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
skip() { echo "SKIP: $*"; }

# Print the text of the block opened by a line that is exactly
# "location <path> {" (leading whitespace allowed), that line included, up to
# the line closing it (brace counting). Empty output = no such block.
location_block() {
  awk -v want="location $2 {" '
    { line = $0; sub(/^[[:space:]]+/, "", line) }
    !inblk && line == want { inblk = 1; depth = 1; buf = $0; next }
    inblk {
      depth += gsub(/{/, "{") - gsub(/}/, "}")
      buf = buf ORS $0
      if (depth <= 0) { print buf; exit }
    }
  ' "$1"
}

# Print the text of the "log_format <name> ... ;" directive (leading
# whitespace allowed, the directive may span lines), empty if absent.
format_body() {
  awk -v name="$2" '
    !inblk {
      line = $0; sub(/^[[:space:]]+/, "", line)
      if (line ~ ("^log_format[[:space:]]+" name "[[:space:]]")) inblk = 1
    }
    inblk {
      buf = buf ORS $0
      if ($0 ~ /;[[:space:]]*$/) { sub(ORS, "", buf); print buf; exit }
    }
  ' "$1"
}

# Echo the directive value (the token after the directive word) or nothing.
first_value() {
  printf '%s\n' "$1" |
    sed -nE "s/^[[:space:]]*$2[[:space:]]+([^;[:space:]]+).*/\1/p" |
    head -n 1
}

for rel in "${CONFIGS[@]}"; do
  f="$ROOT/$rel"
  if [ ! -f "$f" ]; then
    fail "$rel: not found"
    continue
  fi
  if ! grep -Eq '^[[:space:]]*location /api/ \{' "$f"; then
    skip "$rel: does not proxy /api/, nothing to check"
    continue
  fi

  api_block="$(location_block "$f" /api/)"
  if [ -z "$api_block" ]; then
    fail "$rel: cannot extract the location /api/ block"
    continue
  fi

  # ── A: body limit inside location /api/ ──────────────────────────────────
  cms="$(first_value "$api_block" client_max_body_size)"
  if [ -z "$cms" ]; then
    fail "$rel: no client_max_body_size inside location /api/ (nginx's 1 MB default answers 413 for the server's ${MIN_UPLOAD_MB} MB uploads)"
  elif ! printf '%s' "$cms" | grep -Eq '^[0-9]+[kKmMgG]?$'; then
    fail "$rel: unparsable client_max_body_size value: $cms"
  else
    num="$(printf '%s' "$cms" | sed -E 's/[kKmMgG]$//')"
    mb=0
    case "$cms" in
      *[kK]) mb=$((num / 1024)) ;;
      *[mM]) mb=$num ;;
      *[gG]) mb=$((num * 1024)) ;;
      *) mb=$((num / 1048576)) ;;
    esac
    if [ "$num" -eq 0 ]; then
      fail "$rel: client_max_body_size 0 is nginx's unlimited, the limit must stay finite"
    elif [ "$mb" -lt "$MIN_UPLOAD_MB" ]; then
      fail "$rel: client_max_body_size $cms is below the ${MIN_UPLOAD_MB} MB upload limit"
    else
      pass "$rel: client_max_body_size $cms inside location /api/ covers a ${MIN_UPLOAD_MB} MB upload"
    fi
  fi

  if printf '%s\n' "$api_block" | grep -q 'server/src/routes/upload\.ts'; then
    pass "$rel: location /api/ names where the server-side limit lives"
  else
    fail "$rel: no comment near the body limit naming server/src/routes/upload.ts (MAX_FILE_SIZE)"
  fi

  # ── B: the files route is logged without the query string ────────────────
  files_block="$(location_block "$f" /api/files/)"
  if [ -z "$files_block" ]; then
    fail "$rel: no location /api/files/, the ?token= query would be logged in the clear"
  else
    log_line="$(printf '%s\n' "$files_block" | sed -nE '/^[[:space:]]*access_log[[:space:]]/p' | head -n 1)"
    if [ -z "$log_line" ]; then
      fail "$rel: location /api/files/ sets no access_log, it keeps the default format with \$request"
    else
      fmt="$(printf '%s\n' "$log_line" | awk '{ sub(/;[[:space:]]*$/, ""); print $NF }')"
      body="$(format_body "$f" "$fmt")"
      # shellcheck disable=SC2016
      if [ -z "$body" ]; then
        fail "$rel: location /api/files/ logs with format \"$fmt\" which no log_format in $rel defines"
      elif printf '%s' "$body" | grep -Eq '\$request\b|\$args\b|\$query_string\b'; then
        fail "$rel: log_format $fmt logs \$request, \$args or \$query_string, the file token would land in the log"
      else
        pass "$rel: location /api/files/ logs with format $fmt, no \$request/\$args/\$query_string"
      fi
      fmt_line="$(grep -nE "^[[:space:]]*log_format[[:space:]]+$fmt([[:space:]]|$)" "$f" | head -n 1 | cut -d: -f1 || true)"
      server_line="$(grep -nE '^[[:space:]]*server[[:space:]]*\{' "$f" | head -n 1 | cut -d: -f1 || true)"
      if [ -n "$fmt_line" ] && [ -n "$server_line" ] && [ "$fmt_line" -lt "$server_line" ]; then
        pass "$rel: log_format $fmt sits at file top level (before the first server block, these files are included inside http {})"
      elif [ -n "$fmt_line" ]; then
        fail "$rel: log_format $fmt is not at http level (line $fmt_line, first server block at line $server_line); in a conf.d file that means inside a server block, which nginx rejects"
      fi
    fi

    # shellcheck disable=SC2016
    if printf '%s\n' "$files_block" | grep -Eq '\$args|\$is_args'; then
      fail "$rel: location /api/files/ rewrites \$args, the server would lose the query token it needs"
    else
      pass "$rel: location /api/files/ leaves \$args untouched, the proxied request keeps the query"
    fi

    files_pp="$(first_value "$files_block" proxy_pass)"
    api_pp="$(first_value "$api_block" proxy_pass)"
    files_host="$(printf '%s' "$files_pp" | sed -E 's@^https?://@@; s@/.*$@@; s@;.*$@@')"
    api_host="$(printf '%s' "$api_pp" | sed -E 's@^https?://@@; s@/.*$@@; s@;.*$@@')"
    files_path="$(printf '%s' "$files_pp" | sed -E 's@^https?://[^/]*@@; s@;.*$@@')"
    case "$files_pp" in
      *\?*) fail "$rel: proxy_pass in location /api/files/ sets the query string itself" ;;
      *) pass "$rel: proxy_pass in location /api/files/ carries no query rewrite" ;;
    esac
    if [ -n "$api_host" ] && [ "$files_host" = "$api_host" ]; then
      pass "$rel: location /api/files/ proxies to the same upstream as location /api/ ($files_host)"
    else
      fail "$rel: location /api/files/ proxies to \"$files_host\", not the location /api/ upstream \"$api_host\""
    fi
    if [ -z "$files_path" ] || [ "$files_path" = "/api/files/" ]; then
      pass "$rel: location /api/files/ proxy_pass path preserves /api/files/ ($files_pp)"
    else
      fail "$rel: location /api/files/ proxy_pass rewrites the path to \"$files_path\""
    fi
  fi

  if grep -Eq '^[[:space:]]*access_log[[:space:]]+off' "$f"; then
    fail "$rel: switches the access log off"
  else
    pass "$rel: access log stays on"
  fi
done

# ── nginx -t against a wrapper, when nginx is on PATH ──────────────────────
if command -v nginx >/dev/null 2>&1; then
  mkdir -p "$ROOT/.ap-logs"
  wrapper="$ROOT/.ap-logs/nginx-configs-nginx-t.conf"
  for rel in "${CONFIGS[@]}"; do
    printf 'events {}\nhttp {\n    include %s;\n}\n' "$ROOT/$rel" > "$wrapper"
    if out="$(nginx -t -c "$wrapper" 2>&1)"; then
      pass "$rel: nginx -t accepts it inside http {}"
    elif printf '%s' "$out" | grep -Eq 'host not found in upstream|cannot load certificate'; then
      skip "$rel: nginx -t only failed on the compose upstream or the certificate paths, which exist only in the deployed container"
    else
      fail "$rel: nginx -t rejected the file: $out"
    fi
  done
  rm -f "$wrapper"
else
  skip "nginx not on PATH: the nginx -t check did not run, the checks above are structural"
fi

echo "nginx-configs: checked failed=$fails"
if [ "$fails" -gt 0 ]; then
  exit 1
fi
