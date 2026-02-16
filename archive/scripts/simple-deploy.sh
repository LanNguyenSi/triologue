#!/bin/bash

# Triologue Simple Deployment - Fix Build Issues
# Quick deployment without complex Docker builds

set -e

echo "🧊🌋👨‍💻 Triologue Simple Deployment"
echo "Fixing build issues and deploying..."

# Stop any existing containers
docker compose down 2>/dev/null || true

# Clean up Docker build cache
docker system prune -f

# Create directories
mkdir -p server/uploads server/logs database nginx/ssl
mkdir -p client/dist

echo "📝 Environment check..."
if [ ! -f .env ]; then
    echo "Creating .env from template..."
    cp .env.example .env
    
    # Generate secrets
    JWT_SECRET=$(openssl rand -hex 32)
    DB_PASSWORD=$(openssl rand -hex 16)
    
    # Update .env
    sed -i "s/your-super-secret-jwt-key-change-in-production-make-it-long-and-random/$JWT_SECRET/" .env
    sed -i "s/triologue_secure_password_change_me/$DB_PASSWORD/g" .env
fi

echo "🐳 Starting core services first..."
# Start only PostgreSQL and Redis first
docker compose up -d postgres redis

echo "⏳ Waiting for database..."
sleep 10

# Check database connection
until docker compose exec postgres pg_isready -U triologue_user -d triologue; do
  echo "Waiting for database..."
  sleep 5
done

echo "✅ Database ready!"

echo "🔨 Building API manually..."
cd server
if [ ! -d node_modules ]; then
    npm install --omit=dev
fi

# Generate Prisma client
npx prisma generate
npx prisma db push

echo "🚀 Starting API server..."
cd ..
docker compose up -d api

echo "⏳ Waiting for API..."
sleep 15

# Health check
for i in {1..30}; do
    if curl -f http://localhost:4001/api/health >/dev/null 2>&1; then
        echo "✅ API server is healthy!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ API server health check timeout"
        docker compose logs api
        exit 1
    fi
    echo "Waiting for API... ($i/30)"
    sleep 2
done

echo "🌐 Building frontend manually..."
cd client
if [ ! -d node_modules ]; then
    npm install
fi

npm run build

echo "🚀 Starting frontend..."
cd ..
docker compose up -d frontend

echo "🏥 Final health check..."
sleep 10

if curl -f http://localhost:4000 >/dev/null 2>&1; then
    echo "✅ Frontend is accessible!"
else
    echo "⚠️ Frontend might still be starting up"
fi

echo ""
echo "🎉 Triologue deployment complete!"
echo ""
echo "🌐 Frontend: http://localhost:4000"
echo "🔧 API: http://localhost:4001"
echo "📊 Health: http://localhost:4001/api/health"
echo ""
echo "🧊🌋👨‍💻 Ready for first triologue conversation!"