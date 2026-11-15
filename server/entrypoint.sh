#!/bin/sh
set -e

# The api runs as uid 1000. A bind mount or volume left root-owned by an earlier
# image would pass the healthcheck and then fail every upload, so refuse to
# start and say how to fix it (docs/deployment.md, "Existing hosts").
uid="$(id -u)"
fix="chown -R 1000:1000 <host directory or volume behind %s> (server/uploads for /app/uploads, the api_data volume for /app/data), see docs/deployment.md 'Existing hosts: the api runs as uid 1000'"
for dir in /app/uploads /app/data /app/logs; do
  probe="$dir/.write-probe.$$"
  # The redirection sits in a subshell: in dash a failed redirection on the
  # special built-in ":" would end the script before the FATAL line.
  if ! test -w "$dir" || ! ( : > "$probe" ) 2>/dev/null; then
    # shellcheck disable=SC2059
    echo "FATAL: $dir is not writable by uid $uid. Run on the host: $(printf "$fix" "$dir")." >&2
    exit 1
  fi
  rm -f "$probe"
  # A non-recursive chown leaves root-owned files behind (mention-limits.json);
  # -print -quit stops at the first one, so a large uploads dir stays cheap.
  stray="$(find "$dir" ! -user "$uid" -print -quit 2>/dev/null)"
  if [ -n "$stray" ]; then
    # shellcheck disable=SC2059
    echo "FATAL: $stray is not owned by uid $uid. Run on the host: $(printf "$fix" "$dir")." >&2
    exit 1
  fi
done

echo "Waiting for database..."
sleep 5

echo "Generating Prisma Client..."
npx prisma generate

echo "Running migrations..."
npx prisma migrate deploy

echo "Running seed..."
npx ts-node prisma/seed.ts

echo "Starting server..."
exec node dist/index.js
