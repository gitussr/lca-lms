import type { FastifyPluginAsync } from 'fastify';

/**
 * Admin student management (F-201); student self-profile (F-203).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const studentsRoutes: FastifyPluginAsync = async () => {};
