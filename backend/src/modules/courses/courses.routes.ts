import type { FastifyPluginAsync } from 'fastify';

/**
 * Course CRUD (F-301), teacher assignment (F-302), publish/unpublish (F-303).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const coursesRoutes: FastifyPluginAsync = async () => {};
