import type { FastifyPluginAsync } from 'fastify';

/**
 * Subjects (F-601) and chapters (F-602); student syllabus tree (F-604).
 *
 * Registered at the /api/v1 prefix by src/app.ts. No endpoints yet — this
 * module owns its own sub-paths (per architecture decision D9) once its
 * features are built.
 */
export const syllabusRoutes: FastifyPluginAsync = async () => {};
