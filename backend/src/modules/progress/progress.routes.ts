import type { FastifyPluginAsync } from 'fastify';

/**
 * Lesson completion (F-1001), course progress (F-1002), teacher progress views (F-1004 — Milestone 2).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const progressRoutes: FastifyPluginAsync = async () => {};
