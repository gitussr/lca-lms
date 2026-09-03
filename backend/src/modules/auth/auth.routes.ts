import type { FastifyPluginAsync } from 'fastify';

/**
 * Authentication: login, logout, session, GET /me, change/set password (F-103–F-109).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const authRoutes: FastifyPluginAsync = async () => {};
