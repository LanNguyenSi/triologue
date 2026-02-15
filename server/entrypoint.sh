#!/bin/sh
set -e

echo "⏳ Waiting for database to be ready..."
max_attempts=30
attempt=0
until npx prisma db execute --stdin < /dev/null 2>/dev/null || [ $attempt -eq $max_attempts ]; do
  attempt=$((attempt + 1))
  echo "  Database not ready yet (attempt $attempt/$max_attempts)..."
  sleep 2
done

if [ $attempt -eq $max_attempts ]; then
  echo "❌ Database connection timeout after $max_attempts attempts"
  exit 1
fi

echo "✅ Database is ready!"

echo "🔄 Generating Prisma Client..."
npx prisma generate

echo "🔄 Running database migrations..."
npx prisma migrate deploy

echo "🚀 Starting Triologue API server..."
exec npm start
