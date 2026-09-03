import type { FastifyPluginAsync } from 'fastify';

/**
 * Lesson CRUD (F-603); student lesson access (F-605).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const lessonsRoutes: FastifyPluginAsync = async () => {};
