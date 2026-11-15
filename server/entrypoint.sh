#!/bin/sh
set -e

# The api runs as uid 1000. A bind mount or volume left root-owned by an earlier
# image would pass the healthcheck and then fail every upload, so refuse to
# start and say how to fix it (docs/deployment.md, "Existing hosts").
for dir in /app/uploads /app/data /app/logs; do
  probe="$dir/.write-probe.$$"
  if ! test -w "$dir" || ! : > "$probe" 2>/dev/null; then
    echo "FATAL: $dir is not writable by uid $(id -u). Run on the host: chown -R 1000:1000 <host directory or volume behind $dir> (server/uploads for /app/uploads, the api_data volume for /app/data), see docs/deployment.md 'Existing hosts: the api runs as uid 1000'." >&2
    exit 1
  fi
  rm -f "$probe"
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
