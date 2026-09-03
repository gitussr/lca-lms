import type { FastifyPluginAsync } from 'fastify';

/**
 * Batch CRUD and batch-driven enrollment (F-401, F-402 — Milestone 2).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const batchesRoutes: FastifyPluginAsync = async () => {};
