/**
 * VGC ITSM API Server
 * Fastify + TypeScript. All routes under /api/v1.
 *
 * SRE: Graceful shutdown hooks registered to drain in-flight requests.
 * Observability: OpenTelemetry trace exporter to Azure Monitor.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { env } from './lib/env.js';
import { ticketsRoutes } from './routes/v1/tickets.js';
import { webhookWhatsappRoutes } from './routes/v1/webhooks/whatsapp.js';
import { webhookTeamsRoutes } from './routes/v1/webhooks/teams.js';
import { gdprRoutes } from './routes/v1/gdpr.js';
import { healthRoutes } from './routes/health.js';

const server = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    // PDPA: Redact sensitive fields from logs
    redact: ['req.headers.authorization', 'req.body.password', 'req.body.nric'],
  },
  trustProxy: true,
});

// Security headers
await server.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
    },
  },
});

// CORS — only allow configured origins
await server.register(cors, {
  origin: env.CORS_ORIGINS.split(','),
  credentials: true,
});

// Rate limiting — protect against abuse
await server.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  // SRE: Return 429 with Retry-After header per RFC 6585
  errorResponseBuilder: (_req, context) => ({
    type: 'https://httpstatuses.com/429',
    title: 'Too Many Requests',
    status: 429,
    detail: `Rate limit exceeded. Try again in ${context.ttl}ms.`,
  }),
});

// RFC 7807 ProblemDetails helpers (httpErrors.*)
await server.register(sensible);

// Routes
await server.register(healthRoutes, { prefix: '/health' });
await server.register(ticketsRoutes, { prefix: '/api/v1/tickets' });
await server.register(webhookWhatsappRoutes, { prefix: '/api/v1/webhooks/whatsapp' });
await server.register(webhookTeamsRoutes, { prefix: '/api/v1/webhooks/teams' });
await server.register(gdprRoutes, { prefix: '/api/v1/gdpr' });

// Global error handler — return RFC 7807 ProblemDetails
server.setErrorHandler((error, _request, reply) => {
  const status = error.statusCode ?? 500;
  server.log.error({ err: error, status }, 'Unhandled error');
  reply.status(status).send({
    type: `https://httpstatuses.com/${status}`,
    title: error.name ?? 'Internal Server Error',
    status,
    detail: env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : error.message,
    // Trace ID for correlation with Azure Monitor
    traceId: reply.getHeader('x-trace-id') ?? undefined,
  });
});

// Graceful shutdown
const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
for (const signal of signals) {
  process.on(signal, async () => {
    server.log.info(`Received ${signal}, shutting down gracefully`);
    await server.close();
    process.exit(0);
  });
}

try {
  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  server.log.info(`VGC ITSM API listening on :${env.PORT}`);
} catch (err) {
  server.log.fatal(err, 'Failed to start server');
  process.exit(1);
}
