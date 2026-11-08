#!/usr/bin/env bash
# Structural checks for every nginx config that proxies /api/
# (client/nginx.conf, client/nginx.default.conf, nginx/traefik.conf,
# nginx/dev.conf). The checks run in scripts/nginx-config-lint.py, which
# tokenises each file close to how nginx reads it (comments stripped outside
# quotes, quoted strings kept whole, directives split at ; and blocks at
# { and }), so a spelling nginx treats as the same directive cannot dodge a
# check the way it could dodge a line scan: two directives on one line, a
# log_format string spread over lines, ${var} braces, a respaced location
# header, a commented-out directive. Inside the two /api/ blocks only an
# allow-list of directives is accepted (proxying, timeouts, the body limit,
# access_log, absolute_redirect, the nested files location); rewrite and
# error_page are refused anywhere in the file, and a "${" word that is not
# ${name} is refused as unparsable. What it asserts, per config:
#   - location ^~ /api/ sets one client_max_body_size, finite and at least
#     the server's upload limit (0 is nginx's "unlimited"), and carries a
#     comment naming where that limit lives (MAX_FILE_SIZE in
#     server/src/routes/upload.ts), so the two stay in step,
#   - both /api/ locations use the ^~ prefix modifier (a regex location such
#     as location ~ \.html$ beats a plain prefix, so /api/files/x.html?token=
#     would be served as the SPA page and logged with the token); any other
#     /api/ location header fails, and a missing block fails, never skips,
#   - the files route has its own location ^~ /api/files/ with exactly one
#     access_log directive (nginx writes to every access_log that applies),
#     naming a log_format defined at the top level of the same file (these
#     files are included inside http {}); that format uses exactly the
#     variables of nginx's default "main" format minus the query-carrying
#     part of $request ("$request" becomes "$request_method $uri
#     $server_protocol", $http_x_forwarded_for kept). It is an allow-list
#     because $request_uri and $arg_<name> also carry the query; $name and
#     ${name} are both read and any $ the reader cannot consume fails,
#   - the files location sets absolute_redirect off, so a redirect built from
#     the request line cannot spell the ?token= out in an absolute URL,
#   - the files location proxies to the same upstream as location ^~ /api/,
#     with a path that matches its location and nothing that rewrites $args,
#   - every proxy_set_header and proxy_*_timeout of location ^~ /api/ also
#     appears in location ^~ /api/files/ (Upgrade and Connection excepted),
#   - the access log is never switched off anywhere in the file.
# Accepted residual: a non-canonical spelling that does not hit the files
# location, such as a token written into the path (%3Ftoken=, ;token=) or
# /api/Files/, is logged by the default format.
# Needs python3 for the structural checks. If nginx is on PATH the test also
# runs nginx -t against a wrapper that includes each file inside http {}; the
# wrapper lives in its own mktemp -d directory, removed by an EXIT trap. The
# compose upstream hostnames and the TLS template's certificate paths only
# exist inside the deployed container, so an nginx -t that fails only for one
# of those is reported as a skip.
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

for rel in "${CONFIGS[@]}"; do
  f="$ROOT/$rel"
  if [ ! -f "$f" ]; then
    fail "$rel: not found"
    continue
  fi
  rc=0
  out="$(python3 "$ROOT/scripts/nginx-config-lint.py" "$f" "$rel" "$MIN_UPLOAD_MB")" || rc=$?
  [ -z "$out" ] || printf '%s\n' "$out"
  nfail="$(printf '%s\n' "$out" | grep -c '^FAIL:' || true)"
  fails=$((fails + nfail))
  # A non-zero exit with no FAIL line is a crashed or misused linter, never a pass.
  if [ "$rc" -ne 0 ] && [ "$nfail" -eq 0 ]; then
    fail "$rel: nginx-config-lint.py exited $rc without a verdict"
  fi
done

# ── Known bypasses must be refused ─────────────────────────────────────────
# Each fixture is a copy of nginx/traefik.conf that nginx accepts but that
# leaks the token into the access log or loses the body limit for some
# requests (access_log only inside an if or a nested location, an include in
# the files block, a nested location with a smaller body limit, a "${" word
# that hides directives from a naive tokenizer, a rewrite, try_files or
# error_page that moves the request to another location). The lint must FAIL
# each one.
# A refusal counts only when the lint exits 1 and prints a FAIL line (a
# crash is not a refusal), and the fixture set must not be empty.
EXPECTED_REJECT_FIXTURES=12
seen=0
for fx in "$ROOT"/scripts/fixtures/nginx-lint-reject/*.conf; do
  [ -f "$fx" ] || continue
  seen=$((seen + 1))
  name="$(basename "$fx" .conf)"
  rc=0
  out="$(python3 "$ROOT/scripts/nginx-config-lint.py" "$fx" "$name" "$MIN_UPLOAD_MB" 2>&1)" || rc=$?
  if [ "$rc" -eq 1 ] && printf '%s\n' "$out" | grep -q '^FAIL:'; then
    pass "fixture $name: refused"
  else
    fail "fixture $name: the lint did not refuse a config known to leak the token or lose the body limit (exit $rc)"
  fi
done
if [ "$seen" -ne "$EXPECTED_REJECT_FIXTURES" ]; then
  fail "expected $EXPECTED_REJECT_FIXTURES reject fixtures in scripts/fixtures/nginx-lint-reject, found $seen"
fi

# Valid nginx the lint must still accept: ")" right after a closing quote
# (if ($x = "a")) outside the /api/ blocks, and a latin-1 byte in a comment.
for fx in "$ROOT"/scripts/fixtures/nginx-lint-accept/*.conf; do
  [ -f "$fx" ] || { fail "no accept fixture found"; continue; }
  name="$(basename "$fx" .conf)"
  if python3 "$ROOT/scripts/nginx-config-lint.py" "$fx" "$name" "$MIN_UPLOAD_MB" >/dev/null 2>&1; then
    pass "accept fixture $name: passes"
  else
    fail "accept fixture $name: the lint refused valid nginx"
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
