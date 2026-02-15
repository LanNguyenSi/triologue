# Triologue Backend Dockerfile
FROM node:18-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y curl openssl && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create uploads directory
RUN mkdir -p /app/uploads

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

# Start server
CMD ["npm", "start"]