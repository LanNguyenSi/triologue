#!/bin/sh
set -e

echo "Waiting for database..."
sleep 5

echo "Generating Prisma Client..."
npx prisma generate

echo "Running migrations..."
npx prisma migrate deploy

echo "Running seed..."
npx ts-node prisma/seed.ts || echo "Seed skipped (ts-node not available in prod build)"

echo "Starting server..."
exec npm start
