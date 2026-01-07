# DEF CON 34 CMS - Strapi with Litestream
# Multi-stage build for smaller final image

# =============================================================================
# Stage 1: Build Strapi
# =============================================================================
FROM --platform=linux/amd64 node:22-alpine AS builder

# REGION_SHORT is used during build to set Vite base path for admin assets
# This ensures admin assets load from /{region}/admin/ (e.g., /use1/admin/)
ARG REGION_SHORT=use1

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ git

# Copy package files and scripts needed for postinstall
COPY package*.json ./
COPY scripts/ ./scripts/

# Install dependencies - will compile native modules for linux/amd64
# Note: postinstall runs scripts/patch-strapi-compile.js to patch Strapi
RUN npm ci

# Copy source code
COPY . .

# Build Strapi admin panel and compile TypeScript
# REGION_SHORT is read by src/admin/vite.config.ts to set asset base path
# STRAPI_ADMIN_BACKEND_URL tells the admin panel where to make API calls
# This is baked into the JS bundle at build time
ENV NODE_ENV=production
ENV REGION_SHORT=${REGION_SHORT}
ENV STRAPI_ADMIN_BACKEND_URL=https://cms.defcon.run/${REGION_SHORT}
RUN npm run build

# =============================================================================
# Stage 2: Production runtime
# =============================================================================
FROM --platform=linux/amd64 node:22-alpine AS runtime

# Install runtime dependencies
RUN apk add --no-cache \
    curl \
    supervisor \
    bash \
    ca-certificates \
    sqlite

# Install Litestream
ARG LITESTREAM_VERSION=0.3.13
RUN wget -qO- "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.tar.gz" | tar xz -C /usr/local/bin

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy TypeScript compiled output (required for Strapi 5 to start)
COPY --from=builder /app/dist ./dist

# Copy source files (Strapi still needs these)
COPY --from=builder /app/config ./config
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Copy local providers (file: dependencies create symlinks in node_modules)
COPY --from=builder /app/providers ./providers

# Copy supervisord configurations
COPY supervisord.master.conf /etc/supervisor/supervisord.master.conf
COPY supervisord.worker.conf /etc/supervisor/supervisord.worker.conf

# Copy Litestream configurations
RUN mkdir -p /etc/litestream
COPY litestream.master.yml /etc/litestream/litestream.master.yml
COPY litestream.worker.yml /etc/litestream/litestream.worker.yml

# Copy sync script
COPY litestream-sync.sh /app/litestream-sync.sh
RUN chmod +x /app/litestream-sync.sh

# Create data directory for SQLite database
RUN mkdir -p /data && chown -R node:node /data

# Create entrypoint script that selects config based on CMS_MODE
RUN cat > /entrypoint.sh <<'ENTRYPOINT'
#!/bin/bash
set -e

MODE=${CMS_MODE:-master}
echo "Starting CMS in $MODE mode..."

# Link appropriate Litestream config
if [ "$MODE" = "master" ]; then
    ln -sf /etc/litestream/litestream.master.yml /etc/litestream/litestream.yml
    exec /usr/bin/supervisord -c /etc/supervisor/supervisord.master.conf
else
    ln -sf /etc/litestream/litestream.worker.yml /etc/litestream/litestream.yml
    exec /usr/bin/supervisord -c /etc/supervisor/supervisord.worker.conf
fi
ENTRYPOINT
RUN chmod +x /entrypoint.sh

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
    CMD curl -f http://localhost:1337/_health || exit 1

EXPOSE 1337

# Default environment variables
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=1337 \
    CMS_MODE=master \
    DATABASE_FILENAME=/data/strapi.db

# Run as root for supervisord (processes run as appropriate users)
ENTRYPOINT ["/entrypoint.sh"]
