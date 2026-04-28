/**
 * Azure Functions entry point.
 * Uses Fastify as HTTP adapter for trigger-based execution.
 * This allows the same code to run as Container App or Azure Functions.
 *
 * SRE: Health probe at /health for Container Apps.
 */
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { escalateP1Handler } from './orchestrators/escalate-p1.js';
import { autoResolveHandler } from './orchestrators/auto-resolve.js';

const app = Fastify({ logger: { level: process.env['LOG_LEVEL'] ?? 'info' } });
await app.register(sensible);

// P1 Escalation orchestrator trigger
app.post('/api/escalate-p1', escalateP1Handler);

// Auto-resolve orchestrator trigger (for batch/scheduled retry)
app.post('/api/auto-resolve', autoResolveHandler);

// Health probe
app.get('/health', async (_req, reply) => {
  return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
});

const port = parseInt(process.env['FUNCTIONS_PORT'] ?? '3002', 10);
await app.listen({ port, host: '0.0.0.0' });
app.log.info(`Functions service listening on :${port}`);
