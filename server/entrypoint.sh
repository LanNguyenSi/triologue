#!/bin/sh
set -e

echo "⏳ Waiting for database to be ready..."

# Simple retry loop - let Prisma handle the connection test
max_attempts=30
attempt=0

until npx prisma db execute --stdin <<EOF 2>/dev/null || [ $attempt -eq $max_attempts ]; do
SELECT 1;
EOF
  attempt=$((attempt + 1))
  if [ $attempt -lt $max_attempts ]; then
    echo "  Database not ready yet (attempt $attempt/$max_attempts)..."
    sleep 2
  fi
done

if [ $attempt -eq $max_attempts ]; then
  echo "❌ Database connection timeout after $max_attempts attempts"
  echo "   DATABASE_URL: $DATABASE_URL"
  exit 1
fi

echo "✅ Database is ready and accessible!"

echo "🔄 Generating Prisma Client..."
npx prisma generate

echo "🔄 Running database migrations..."
npx prisma migrate deploy

echo "✅ Migrations complete!"
echo "🚀 Starting Triologue API server..."
exec npm start
