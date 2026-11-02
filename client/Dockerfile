# Triologue Frontend Dockerfile
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --no-audit --no-fund

# Copy source code
COPY . .

# Build arguments for environment variables
ARG VITE_API_URL
ARG VITE_SENTRY_DSN

# Build the app
RUN npm run build

# Production stage with nginx
FROM nginx:alpine

# Copy nginx configuration. This is the plain-HTTP default (no TLS: the image
# ships no certificates); every deployment that terminates TLS elsewhere or in
# its own way mounts its own config over /etc/nginx/conf.d/default.conf.
COPY nginx.default.conf /etc/nginx/conf.d/default.conf

# Copy built app
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose ports: the default config and both compose mounts listen on 80 only,
# TLS is terminated by Traefik (production) or not at all (dev).
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]