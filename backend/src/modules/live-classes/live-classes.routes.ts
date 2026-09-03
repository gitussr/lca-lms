import type { FastifyPluginAsync } from 'fastify';

/**
 * Live class scheduling (F-801), edit/cancel (F-802), student view/join (F-803 — Milestone 2).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const liveClassesRoutes: FastifyPluginAsync = async () => {};
