import 'fastify';
import type { AuthenticatedUser } from '../shared/auth-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The authenticated caller, or `null` when the request is unauthenticated.
     * Populated by the session middleware in F-105.
     */
    user: AuthenticatedUser | null;
  }
}
