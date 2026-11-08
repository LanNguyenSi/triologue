#!/bin/sh
# Anchored pg_dump completion check, POSIX sh: scripts/backup.sh (bash) and
# scripts/pre-deploy-backup.sh (busybox ash in the relay container) source
# this file, so it must stay free of bash arrays, [[ ]] and process
# substitution. scripts/restore.sh applies the same rule with its own inline
# copy and its own messages; do not weaken that copy or merge it into this
# file.
#
# dump_is_complete FILE returns:
#   0  the dump is complete at its end,
#   1  no whole line "-- PostgreSQL database dump complete",
#   2  after the last such line something other than a "--" comment line, a
#      blank line or the "\unrestrict <key>" line matching the dump's own
#      "\restrict <key>" opener: the phrase was dumped data (a chat message
#      can quote it) or the file was cut after the marker,
#   3  a "\restrict <key>" opener with no matching "\unrestrict <key>" line
#      among those trailing lines: the file was cut before its end (recent
#      pg_dump writes that pair, the unrestrict line last).
# A bare substring match is not enough: a truncated dump whose table data
# merely contains the phrase would be kept as a good backup.
#
# Not `grep -q` for the completion line search: with pipefail (backup.sh) an
# early grep exit can turn into a SIGPIPE against tail.
dump_is_complete() {
  _dic_file="$1"
  grep -qx -- '-- PostgreSQL database dump complete' "$_dic_file" || return 1
  # `|| true` on the substitution: with a whole-line match guaranteed by the
  # gate above, grep exits 0; the true only keeps a failing pipeline (no
  # whole line, so gate 1 already returned) from ending backup.sh under
  # bash's set -e and pipefail, which would mask a broken -x anchor.
  _dic_line="$(grep -n -x -- '-- PostgreSQL database dump complete' "$_dic_file" | tail -1 | cut -d: -f1 || true)"
  _dic_restrict="$(grep -m1 -- '^[\\]restrict ' "$_dic_file" || true)"
  _dic_unrestrict=""
  if [ -n "$_dic_restrict" ]; then
    _dic_unrestrict="\\unrestrict ${_dic_restrict#\\restrict }"
  fi
  _dic_rc=0
  tail -n "+$((_dic_line + 1))" "$_dic_file" | UNRESTRICT_LINE="$_dic_unrestrict" awk '
    BEGIN { u = ENVIRON["UNRESTRICT_LINE"] }
    $0 == "" || substr($0, 1, 2) == "--" { next }
    u != "" && $0 == u { seen = 1; next }
    { bad = 1; exit }
    END { if (bad) exit 2; if (u != "" && !seen) exit 3 }
  ' || _dic_rc=$?
  return "$_dic_rc"
}
