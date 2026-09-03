import type { FastifyPluginAsync } from 'fastify';

/**
 * Shared user + role concerns; admin account status changes (F-101, F-110).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const usersRoutes: FastifyPluginAsync = async () => {};
