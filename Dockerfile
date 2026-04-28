# Stage 1: Build frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx vite build

# Stage 2: Production runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy server files
COPY server.js authMiddleware.js cacheLayer.js graphService.js msalConfig.js \
     notificationEngine.js slaEngine.js workflowEngine.js analyticsEngine.js \
     wsServer.js ./

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy optional config files
COPY profiles.json sw_clients.xml VERSION.json* kb-enterprise-articles.json* ./

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "cluster.js"]
