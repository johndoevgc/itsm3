# Stage 1: Build frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 npx vite build

# Stage 2: Production runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install build tools for native modules (better-sqlite3), then clean up
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force && apk del python3 make g++

# Copy server files
COPY server.js authMiddleware.js cacheLayer.js graphService.js msalConfig.js \
     notificationEngine.js slaEngine.js workflowEngine.js analyticsEngine.js \
     wsServer.js featureFlags.js piiRedact.js shadowMode.js shadowWorkflow.js \
     incidentIndex.js cluster.js ./

# Copy route handlers
COPY routes/ ./routes/

# Copy server source modules
COPY src/ ./src/

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy config files
COPY VERSION.json kb-enterprise-articles.json ./

# Run as non-root user
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "cluster.js"]
