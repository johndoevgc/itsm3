import type { FastifyPluginAsync } from 'fastify';

/**
 * Health check routes.
 * SLO: This endpoint must return 200 within 200ms.
 * Used by Azure Container Apps health probes.
 */
export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (_request, reply) => {
    return reply.status(200).send({
      status: 'ok',
      version: process.env.npm_package_version ?? '0.0.1',
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get('/ready', async (_request, reply) => {
    // TODO: Check Cosmos DB connectivity
    return reply.status(200).send({ status: 'ready' });
  });
};
