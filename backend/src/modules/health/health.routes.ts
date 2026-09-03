import type { FastifyPluginAsync } from 'fastify';
import { APP_NAME, APP_VERSION } from '../../shared/pkg.js';

const startedAt = Date.now();

/**
 * Liveness/readiness endpoint. Public — no authentication.
 * F-005 / F-032 may extend this with dependency checks (DB, Redis).
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    status: 'ok',
    service: APP_NAME,
    version: APP_VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  }));
};
