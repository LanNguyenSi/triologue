#!/bin/sh
set -e

echo "🔄 Running database migrations..."
npx prisma migrate deploy

echo "🚀 Starting Triologue API server..."
exec npm start
