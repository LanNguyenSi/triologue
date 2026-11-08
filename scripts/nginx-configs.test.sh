#!/usr/bin/env bash
# Structural checks for every nginx config that proxies /api/
# (client/nginx.conf, client/nginx.default.conf, nginx/traefik.conf,
# nginx/dev.conf):
#   - location ^~ /api/ raises client_max_body_size to at least the server's
#     upload limit without going unlimited (0 is nginx's "unlimited"), and the
#     block carries a comment naming where that limit lives
#     (MAX_FILE_SIZE in server/src/routes/upload.ts), so the two stay in step,
#   - both /api/ locations use the ^~ prefix modifier: without it a regex
#     location such as location ~ \.html$ beats the plain prefix, so
#     /api/files/x.html?token=<jwt> would be served as the SPA page and
#     logged with the token. Location headers are matched with normalised
#     whitespace, and every config in this list proxies /api/, so a file
#     whose /api/ header is missing or is not in the ^~ form FAILS, it is
#     never skipped,
#   - the files route has its own location ^~ /api/files/ with exactly one
#     access_log directive (nginx writes to every access_log that applies to
#     a request, so a second unformatted line in the block would log the
#     token after all), and that access_log uses a log_format defined at the
#     top level of the same file (these files are included inside http {},
#     so a top-level log_format is http level; the test checks it sits
#     before the first server block), and that
#     format uses exactly the variables of nginx's default "main" format
#     minus the query-carrying part of $request: "$request" becomes
#     "$request_method $uri $server_protocol" and every other main field is
#     kept, "$http_x_forwarded_for" included, so the real client address
#     survives behind a proxy. The check is an allow-list because
#     $request_uri and $arg_<name> also carry the query string and would
#     pass a deny-list of $request/$args/$query_string; variables are
#     extracted in both the $name and the ${name} spelling and every $ of
#     the format must be consumed by the extractor, so a $ spelling the
#     allow-list cannot see fails. Any variable outside the list fails and
#     any listed variable that is missing fails, keeping
#     the ?token=<jwt> file token (client/src/lib/fileUrl.ts, accepted by
#     server/src/routes/files.ts) out of the container log,
#   - the files location sets absolute_redirect off, so a request nginx
#     redirects from that prefix (for example /api/files without the
#     trailing slash) gets a relative Location instead of an absolute
#     http:// URL built from the request line, token included,
#   - the files location proxies to the same upstream as location ^~ /api/
#     with a path that matches its location and nothing that rewrites $args,
#     so the proxied request still carries the query the server needs,
#   - every proxy_set_header and every proxy_*_timeout of location ^~ /api/
#     also appears in location ^~ /api/files/ (except the Upgrade and
#     Connection handshake headers, which the files route never serves), so
#     the two blocks cannot drift apart on forwarded client address or
#     timeouts,
#   - the access log is never switched off anywhere in the file.
# If nginx is on PATH the test also runs nginx -t against a wrapper that
# includes each file inside http {}; the wrapper lives in its own mktemp -d
# directory, removed by an EXIT trap. The compose upstream hostnames and the
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

# The variables the files log_format may use, and must all use: nginx's
# default "main" format minus the query-carrying part of $request, which the
# three request-line variables replace. Nothing else is allowed, because
# $request_uri, $args, $query_string, $is_args and $arg_<name> can all carry
# the file token; nothing of main may be dropped, because operators grep
# these lines for exactly those fields.
# shellcheck disable=SC2016
ALLOWED_FORMAT_VARS='$remote_addr $remote_user $time_local $request_method $uri $server_protocol $status $body_bytes_sent $http_referer $http_user_agent $http_x_forwarded_for'

fails=0
pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
skip() { echo "SKIP: $*"; }

# Print the text of the block opened by a line whose normalised form (no
# leading or trailing whitespace, runs of whitespace collapsed to one space)
# is exactly "location <path> {", that line included, up to the line closing
# it (brace counting). Normalising is what stops a respaced header from
# hiding the block from this extractor. Empty output = no such block.
location_block() {
  awk -v want="location $2 {" '
    { line = $0
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      gsub(/[[:space:]]+/, " ", line) }
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

# Print the proxy_set_header and proxy_*_timeout directives of a block, one
# per line, leading whitespace, trailing ; and runs of whitespace collapsed
# so that the same directive written in two blocks compares equal. The
# Upgrade and Connection handshake headers are left out: the files route
# serves plain downloads and must not claim to upgrade.
proxy_directives() {
  printf '%s\n' "$1" |
    sed -E 's/^[[:space:]]+//; s/[[:space:]]*;[[:space:]]*$//; s/[[:space:]]+/ /g' |
    grep -E '^proxy_(set_header|[a-z_]+_timeout)([[:space:]]|$)' |
    grep -Ev '^proxy_set_header (Upgrade|Connection)([[:space:]]|$)' || true
}

for rel in "${CONFIGS[@]}"; do
  f="$ROOT/$rel"
  if [ ! -f "$f" ]; then
    fail "$rel: not found"
    continue
  fi

  # ── the /api/ locations must exist and must use the ^~ modifier ──────────
  # Every config in CONFIGS proxies /api/, so a missing or non-^~ /api/
  # block is a FAIL, never a skip. Location headers are matched with
  # normalised whitespace, so a respaced header cannot dodge the scan, and
  # any matching header that is not the ^~ form fails.
  headers="$(grep -En '^[[:space:]]*location[[:space:]]+(\^~[[:space:]]+)?/api/(files/)?[[:space:]]*\{' "$f" || true)"
  plain=''
  if [ -n "$headers" ]; then
    plain="$(printf '%s\n' "$headers" | grep -v '\^~' || true)"
  fi
  if [ -n "$plain" ]; then
    while IFS= read -r header; do
      case "$header" in
        *'/api/files/'*) fail "$rel: line ${header%%:*}: location /api/files/ uses the plain prefix form; a regex location (location ~ \\.html\$) would take /api/files/x.html, serve it as the SPA page and log the token, so the block must be written \"location ^~ /api/files/\"" ;;
        *) fail "$rel: line ${header%%:*}: location /api/ uses the plain prefix form; a regex location (location ~ \\.html\$) beats a plain prefix and can take an /api/ path, so the block must be written \"location ^~ /api/\"" ;;
      esac
    done <<< "$plain"
  fi

  api_block="$(location_block "$f" '^~ /api/')"
  if [ -z "$api_block" ]; then
    fail "$rel: no location ^~ /api/ { block found even with normalised whitespace; every config in this list proxies /api/, so the block must exist in the ^~ form (a missing block fails, it does not skip)"
    continue
  fi

  # ── A: body limit inside location ^~ /api/ ───────────────────────────────
  cms="$(first_value "$api_block" client_max_body_size)"
  if [ -z "$cms" ]; then
    fail "$rel: no client_max_body_size inside location ^~ /api/ (nginx's 1 MB default answers 413 for the server's ${MIN_UPLOAD_MB} MB uploads)"
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
      pass "$rel: client_max_body_size $cms inside location ^~ /api/ covers a ${MIN_UPLOAD_MB} MB upload"
    fi
  fi

  if printf '%s\n' "$api_block" | grep -q 'server/src/routes/upload\.ts'; then
    pass "$rel: location ^~ /api/ names where the server-side limit lives"
  else
    fail "$rel: no comment near the body limit naming server/src/routes/upload.ts (MAX_FILE_SIZE)"
  fi

  # ── B: the files route is logged without the query string ────────────────
  files_block="$(location_block "$f" '^~ /api/files/')"
  if [ -z "$files_block" ]; then
    fail "$rel: no location ^~ /api/files/ { block found even with normalised whitespace, the ?token= query would be logged in the clear"
  else
    # Exactly one access_log directive, and it must name a log_format:
    # nginx writes to every access_log that applies to a request, so a
    # second line (bare, off or with another format) would log with it too,
    # and the default format carries the query with the token.
    access_log_lines="$(printf '%s\n' "$files_block" | sed -nE '/^[[:space:]]*access_log([[:space:]]|;)/p')"
    access_log_count="$(printf '%s\n' "$access_log_lines" | grep -c . || true)"
    if [ "$access_log_count" -eq 0 ]; then
      fail "$rel: location ^~ /api/files/ sets no access_log, it keeps the default format with \$request"
    elif [ "$access_log_count" -ne 1 ]; then
      fail "$rel: location ^~ /api/files/ has $access_log_count access_log directives but must have exactly one: nginx logs to every access_log that applies, so the extra line '$(printf '%s\n' "$access_log_lines" | sed -nE '2p' | sed -E 's/^[[:space:]]+//')' would log with it too"
    else
      log_line="$access_log_lines"
      fmt="$(printf '%s\n' "$log_line" | sed -E 's/;[[:space:]]*$//; s/[[:space:]]*$//' | awk '{print $NF}')"
      if [ "$fmt" = "access_log" ] || [ "$fmt" = "off" ]; then
        fail "$rel: location ^~ /api/files/ has '$(printf '%s' "$log_line" | sed -E 's/^[[:space:]]+//')', which names no log_format (bare or off), so the location logs with the default main format and its query-carrying \$request"
      else
        body="$(format_body "$f" "$fmt")"
        # shellcheck disable=SC2016
        if [ -z "$body" ]; then
          fail "$rel: location ^~ /api/files/ logs with format \"$fmt\" which no log_format in $rel defines"
        else
          # nginx expands both $name and ${name}; extract either spelling
          # (braces stripped for the allow-list match) and require that the
          # extractor consumed every $ of the format, so a $ spelling that
          # the allow-list cannot even see cannot slip through.
          used_raw="$(printf '%s' "$body" | grep -oE '[$][{]?[A-Za-z0-9_]+[}]?' || true)"
          used_count="$(printf '%s\n' "$used_raw" | grep -c . || true)"
          dollar_count="$(printf '%s' "$body" | tr -cd '$' | wc -c | tr -d '[:space:]')"
          if [ "$dollar_count" -ne "$used_count" ]; then
            fail "$rel: log_format $fmt has a \$ the extractor did not consume (only \$name and \${name} are checked against the allow-list); nginx still expands it and it could carry the file token"
          else
            used_vars="$(printf '%s\n' "$used_raw" | tr -d '{}' | sort -u)"
            unexpected=''
            for v in $used_vars; do
              case " $ALLOWED_FORMAT_VARS " in
                *" $v "*) ;;
                *) unexpected="$unexpected $v" ;;
              esac
            done
            missing=''
            for v in $ALLOWED_FORMAT_VARS; do
              printf '%s\n' "$used_vars" | grep -Fxq -- "$v" || missing="$missing $v"
            done
            if [ -n "$unexpected" ]; then
              fail "$rel: log_format $fmt uses variable(s)$unexpected, which is outside the allow-list of main-format variables minus the query and can carry the file token"
            elif [ -n "$missing" ]; then
              fail "$rel: log_format $fmt drops variable(s)$missing of nginx's main format; it must mirror main minus only the query"
            else
              pass "$rel: location ^~ /api/files/ logs with format $fmt, exactly the main format minus the query"
            fi
          fi
        fi
        fmt_line="$(grep -nE "^[[:space:]]*log_format[[:space:]]+$fmt([[:space:]]|$)" "$f" | head -n 1 | cut -d: -f1 || true)"
        server_line="$(grep -nE '^[[:space:]]*server[[:space:]]*\{' "$f" | head -n 1 | cut -d: -f1 || true)"
        if [ -n "$fmt_line" ] && [ -n "$server_line" ] && [ "$fmt_line" -lt "$server_line" ]; then
          pass "$rel: log_format $fmt sits at file top level (before the first server block, these files are included inside http {})"
        elif [ -n "$fmt_line" ]; then
          fail "$rel: log_format $fmt is not at http level (line $fmt_line, first server block at line $server_line); in a conf.d file that means inside a server block, which nginx rejects"
        fi
      fi
    fi

    # A request that nginx redirects from this prefix (for example /api/files
    # without the trailing slash) must get a relative Location: an absolute
    # one is built from the request line and would spell the ?token= out into
    # the URL in the clear.
    if printf '%s\n' "$files_block" | grep -Eq '^[[:space:]]*absolute_redirect[[:space:]]+off[[:space:]]*;'; then
      pass "$rel: location ^~ /api/files/ sets absolute_redirect off, a redirect built here stays relative and cannot carry the token in an absolute http:// URL"
    else
      fail "$rel: location ^~ /api/files/ does not set absolute_redirect off; a request nginx redirects here (for example /api/files without the trailing slash) gets an absolute Location built from the request line, token included"
    fi

    # shellcheck disable=SC2016
    if printf '%s\n' "$files_block" | grep -Eq '\$args|\$is_args'; then
      fail "$rel: location ^~ /api/files/ rewrites \$args, the server would lose the query token it needs"
    else
      pass "$rel: location ^~ /api/files/ leaves \$args untouched, the proxied request keeps the query"
    fi

    files_pp="$(first_value "$files_block" proxy_pass)"
    api_pp="$(first_value "$api_block" proxy_pass)"
    files_host="$(printf '%s' "$files_pp" | sed -E 's@^https?://@@; s@/.*$@@; s@;.*$@@')"
    api_host="$(printf '%s' "$api_pp" | sed -E 's@^https?://@@; s@/.*$@@; s@;.*$@@')"
    files_path="$(printf '%s' "$files_pp" | sed -E 's@^https?://[^/]*@@; s@;.*$@@')"
    case "$files_pp" in
      *\?*) fail "$rel: proxy_pass in location ^~ /api/files/ sets the query string itself" ;;
      *) pass "$rel: proxy_pass in location ^~ /api/files/ carries no query rewrite" ;;
    esac
    if [ -n "$api_host" ] && [ "$files_host" = "$api_host" ]; then
      pass "$rel: location ^~ /api/files/ proxies to the same upstream as location ^~ /api/ ($files_host)"
    else
      fail "$rel: location ^~ /api/files/ proxies to \"$files_host\", not the location ^~ /api/ upstream \"$api_host\""
    fi
    if [ -z "$files_path" ] || [ "$files_path" = "/api/files/" ]; then
      pass "$rel: location ^~ /api/files/ proxy_pass path preserves /api/files/ ($files_pp)"
    else
      fail "$rel: location ^~ /api/files/ proxy_pass rewrites the path to \"$files_path\""
    fi

    # ── C: the files block cannot drift from the /api/ block ───────────────
    api_required="$(proxy_directives "$api_block")"
    files_provided="$(proxy_directives "$files_block")"
    parity_missing=0
    while IFS= read -r directive; do
      [ -n "$directive" ] || continue
      if ! printf '%s\n' "$files_provided" | grep -Fxq -- "$directive"; then
        fail "$rel: location ^~ /api/files/ is missing \"$directive\", which location ^~ /api/ sets"
        parity_missing=1
      fi
    done <<< "$api_required"
    if [ "$parity_missing" -eq 0 ]; then
      pass "$rel: location ^~ /api/files/ repeats every proxy_set_header and proxy_*_timeout of location ^~ /api/ (Upgrade and Connection excepted)"
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
  wrapper_dir="$(mktemp -d)"
  trap 'rm -rf "$wrapper_dir"' EXIT
  for rel in "${CONFIGS[@]}"; do
    printf 'events {}\nhttp {\n    include %s;\n}\n' "$ROOT/$rel" > "$wrapper_dir/nginx-t-wrapper.conf"
    if out="$(nginx -t -c "$wrapper_dir/nginx-t-wrapper.conf" 2>&1)"; then
      pass "$rel: nginx -t accepts it inside http {}"
    elif printf '%s' "$out" | grep -Eq 'host not found in upstream|cannot load certificate'; then
      skip "$rel: nginx -t only failed on the compose upstream or the certificate paths, which exist only in the deployed container"
    else
      fail "$rel: nginx -t rejected the file: $out"
    fi
  done
else
  skip "nginx not on PATH: the nginx -t check did not run, the checks above are structural"
fi

echo "nginx-configs: checked failed=$fails"
if [ "$fails" -gt 0 ]; then
  exit 1
fi
