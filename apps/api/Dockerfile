# Build stage
FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy workspace config
COPY pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/graph-client/package.json packages/graph-client/
COPY packages/ai-prompts/package.json packages/ai-prompts/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/graph-client/src packages/graph-client/src
COPY packages/graph-client/tsconfig.json packages/graph-client/
COPY packages/ai-prompts/src packages/ai-prompts/src
COPY packages/ai-prompts/tsconfig.json packages/ai-prompts/
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/

# Build
RUN pnpm --filter @itsm3/graph-client build
RUN pnpm --filter @itsm3/ai-prompts build
RUN pnpm --filter @itsm3/api build

# Production stage
FROM node:20-alpine AS runner

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 fastify

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy only production artifacts
COPY --from=builder --chown=fastify:nodejs /app/packages/graph-client/dist packages/graph-client/dist
COPY --from=builder --chown=fastify:nodejs /app/packages/ai-prompts/dist packages/ai-prompts/dist
COPY --from=builder --chown=fastify:nodejs /app/apps/api/dist apps/api/dist
COPY --from=builder --chown=fastify:nodejs /app/node_modules node_modules
COPY --from=builder --chown=fastify:nodejs /app/apps/api/package.json apps/api/

USER fastify

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "apps/api/dist/server.js"]
