import type { FastifyPluginAsync } from 'fastify';

/**
 * Enroll/unenroll (F-501, F-502), list (F-503), enrollment authorization service (F-504).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const enrollmentRoutes: FastifyPluginAsync = async () => {};
