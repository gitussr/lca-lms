import 'fastify';
import type { AppServices } from '../app.js';
import type { AuthenticatedUser } from '../shared/auth-context.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Shared dependencies (database pool, session store, throttle). See `buildApp`. */
    services: AppServices;
  }

  interface FastifyRequest {
    /**
     * The authenticated caller, or `null` when the request is unauthenticated.
     * Populated by the session middleware in F-105.
     */
    user: AuthenticatedUser | null;
  }
}
