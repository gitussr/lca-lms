import type { FastifyPluginAsync } from 'fastify';

/**
 * Admin teacher management (F-202); teacher self-profile (F-204).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const teachersRoutes: FastifyPluginAsync = async () => {};
