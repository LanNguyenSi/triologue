#!/bin/sh
set -e

echo "🔄 Generating Prisma Client..."
npx prisma generate

echo "🚀 Starting Triologue API server..."
exec npm start