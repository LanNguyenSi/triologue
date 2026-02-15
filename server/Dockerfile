# Triologue Backend Dockerfile
FROM node:18-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y curl openssl && rm -rf /var/lib/apt/lists/*

# Copy package files first (for layer caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy Prisma schema
COPY prisma ./prisma/

# Generate Prisma client at build time
RUN npx prisma generate

# Copy source code
COPY src ./src/
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create uploads directory
RUN mkdir -p /app/uploads

# Expose port
EXPOSE 3001

# Health check (with longer start period for migrations)
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

# Start server with migrations
ENTRYPOINT ["/app/entrypoint.sh"]
