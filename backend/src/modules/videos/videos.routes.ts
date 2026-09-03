import type { FastifyPluginAsync } from 'fastify';

/**
 * Recorded video: entity/upload/controlled playback/progress (F-701–F-704 — Milestone 2).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const videosRoutes: FastifyPluginAsync = async () => {};
