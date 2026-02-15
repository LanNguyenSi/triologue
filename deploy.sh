#!/bin/bash

# Triologue Deployment Script
# Usage: ./deploy.sh [production|development]

set -e

MODE=${1:-development}

echo "🧊🌋👨‍💻 Triologue Deployment Script"
echo "Mode: $MODE"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check for docker compose (v2) or $DOCKER_COMPOSE (v1)
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
elif command -v $DOCKER_COMPOSE &> /dev/null; then
    DOCKER_COMPOSE="$DOCKER_COMPOSE"
else
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    
    # Generate secure JWT secret
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s|your-super-secret-jwt-key-change-in-production-make-it-long-and-random|$JWT_SECRET|" .env
    
    # Generate secure database password
    DB_PASSWORD=$(openssl rand -hex 16)
    sed -i "s|triologue_secure_password_change_me|$DB_PASSWORD|g" .env
    
    echo "🔐 Generated secure secrets. Please review .env file and update configuration."
    echo "⚠️  Don't forget to set CLAWDBOT_SESSION_KEY and other AI integration settings!"
fi

# Create necessary directories
mkdir -p server/uploads
mkdir -p database
mkdir -p nginx/ssl

# Set permissions
chmod +x server/src/scripts/*.sh 2>/dev/null || true

echo "📦 Building and starting services..."

if [ "$MODE" = "production" ]; then
    # Production deployment with nginx
    echo "🚀 Starting production deployment..."
    $DOCKER_COMPOSE --profile production up -d --build
    
    echo "🔒 Setting up SSL certificates..."
    # You can add certbot/letsencrypt setup here
    
elif [ "$MODE" = "ai-integration" ]; then
    # Development with AI bridge
    echo "🤖 Starting with AI integration services..."
    $DOCKER_COMPOSE --profile ai-integration up -d --build
    
else
    # Development mode
    echo "🛠️  Starting development deployment..."
    $DOCKER_COMPOSE up -d --build
fi

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Run database migrations
echo "🗄️  Running database migrations..."
$DOCKER_COMPOSE exec api npm run db:migrate

# Create default users
echo "👥 Creating default users..."
$DOCKER_COMPOSE exec api node dist/scripts/createDefaultUsers.js

# Health check
echo "🏥 Checking service health..."
for i in {1..30}; do
    if curl -f http://localhost:4001/api/health >/dev/null 2>&1; then
        echo "✅ API server is healthy"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ API server health check failed"
        exit 1
    fi
    sleep 2
done

if curl -f http://localhost:4000 >/dev/null 2>&1; then
    echo "✅ Frontend is accessible"
else
    echo "⚠️  Frontend might still be starting up"
fi

echo ""
echo "🎉 Triologue deployment complete!"
echo ""
echo "🌐 Frontend: http://localhost:4000"
echo "🔧 API: http://localhost:4001"
echo "📊 API Health: http://localhost:4001/api/health"
echo ""
echo "📋 Default Users:"
echo "   👨‍💻 Lan (Human): lan / check .env for password"
echo "   🌋 Lava (AI): lava / token-based auth"
echo "   🧊 Ice (AI): ice / token-based auth"
echo ""
echo "⚙️  Configuration:"
echo "   📝 Edit .env for environment variables"
echo "   🔐 Set CLAWDBOT_SESSION_KEY for Lava integration"
echo "   🧊 Set ICE_WEBHOOK_URL for Ice integration"
echo ""
echo "🛠️  Management Commands:"
echo "   📊 View logs: $DOCKER_COMPOSE logs -f [service]"
echo "   🔄 Restart: $DOCKER_COMPOSE restart [service]"
echo "   ⏹️  Stop: $DOCKER_COMPOSE down"
echo "   🗑️  Clean: $DOCKER_COMPOSE down -v (removes data!)"
echo ""

if [ "$MODE" = "production" ]; then
    echo "🔒 Production Notes:"
    echo "   - Update your domain in .env"
    echo "   - Configure SSL certificates"
    echo "   - Set up firewall rules"
    echo "   - Configure backup strategy"
    echo ""
fi