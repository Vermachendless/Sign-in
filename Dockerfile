# ==============================================================================
# Multi-stage Production Dockerfile
# Service: Employee Attendance & Office Access Management System
# Runtime: Node.js 22 LTS on Debian Bookworm Slim
# Target:  Google Cloud Run + Cloud SQL PostgreSQL (europe-west2)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Stage
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy dependency specifications (manifests and lockfiles)
COPY package.json package-lock.json* bun.lock* ./

# Install all dependencies (including build tools: vite, esbuild, typescript, @tailwindcss/vite)
# Uses npm ci when package-lock.json is present, falling back to npm install cleanly
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy configuration files and source code
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY server.ts ./

# Build both frontend SPA bundle (dist/) and production backend bundle (dist/server.cjs)
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Runtime Stage
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Configure production environment defaults
ENV NODE_ENV=production \
    PORT=3000

# Copy dependency specifications for runtime dependency resolution
COPY package.json package-lock.json* bun.lock* ./

# Install only production dependencies (external packages required by dist/server.cjs)
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

# Copy pre-built frontend and backend artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Set file ownership to non-root node user
RUN chown -R node:node /app

# Run as non-root user (UID 1000) for security compliance
USER node

# Expose default HTTP port (Cloud Run injects PORT environment variable at runtime)
EXPOSE 3000

# Start server via production entry point
CMD ["node", "dist/server.cjs"]
