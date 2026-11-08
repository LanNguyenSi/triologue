# Triologue Backend Dockerfile
FROM node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

WORKDIR /app

# Install system dependencies (+ extraction tooling for attachments)
RUN apt-get update && apt-get install -y \
  curl \
  openssl \
  poppler-utils \
  tesseract-ocr \
  tesseract-ocr-eng \
  tesseract-ocr-deu \
  && rm -rf /var/lib/apt/lists/*

# Copy package files first (for layer caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --no-audit --no-fund

# Copy Prisma schema
COPY prisma ./prisma/

# Generate Prisma client at build time
RUN npx prisma generate

# Copy source code
COPY src ./src/
COPY tsconfig.json ./
COPY openapi.yaml ./openapi.yaml

# Build TypeScript
RUN npm run build

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create uploads and data directories
RUN mkdir -p /app/uploads /app/data && chmod 777 /app/data

# Expose port
EXPOSE 3001

# Health check (with longer start period for migrations)
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

# Start server with migrations
ENTRYPOINT ["/app/entrypoint.sh"]
