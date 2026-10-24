import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Pool } from 'pg';

import { getPool } from './db/pool.js';
import { LoginThrottle, RedisCounterStore } from './modules/auth/login-throttle.js';
import { RedisSessionStore, type SessionStore } from './modules/auth/session.store.js';
import { config } from './shared/config.js';
import { getRedis } from './shared/redis.js';
import { registerErrorHandler } from './shared/error-handler.js';
import { loggerOptions } from './shared/logger.js';

import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { studentsRoutes } from './modules/students/students.routes.js';
import { teachersRoutes } from './modules/teachers/teachers.routes.js';
import { coursesRoutes } from './modules/courses/courses.routes.js';
import { batchesRoutes } from './modules/batches/batches.routes.js';
import { enrollmentRoutes } from './modules/enrollment/enrollment.routes.js';
import { syllabusRoutes } from './modules/syllabus/syllabus.routes.js';
import { lessonsRoutes } from './modules/lessons/lessons.routes.js';
import { videosRoutes } from './modules/videos/videos.routes.js';
import { liveClassesRoutes } from './modules/live-classes/live-classes.routes.js';
import { progressRoutes } from './modules/progress/progress.routes.js';

const API_PREFIX = '/api/v1';

/** Maximum request body size. Large media uploads (F-702) use their own route config. */
const BODY_LIMIT_BYTES = 1_048_576; // 1 MiB

/**
 * Every domain module exposes a route-registration plugin. Each is mounted at
 * the shared `/api/v1` prefix and owns its own sub-paths (e.g. `/admin/...`,
 * `/me/...`, `/teacher/...` per architecture decision D9). Modules with no
 * endpoints yet register nothing.
 */
const moduleRoutes = [
  healthRoutes,
  authRoutes,
  usersRoutes,
  studentsRoutes,
  teachersRoutes,
  coursesRoutes,
  batchesRoutes,
  enrollmentRoutes,
  syllabusRoutes,
  lessonsRoutes,
  videosRoutes,
  liveClassesRoutes,
  progressRoutes,
];

/**
 * Process-wide dependencies route handlers reach through `app.services`.
 * Production uses the shared Postgres pool and Redis; tests pass their own
 * (a disposable database, in-memory stores) via `buildApp({ services })`.
 */
export interface AppServices {
  pool: Pool;
  sessions: SessionStore;
  loginThrottle: LoginThrottle;
}

function defaultServices(): AppServices {
  return {
    pool: getPool(),
    sessions: new RedisSessionStore(getRedis()),
    loginThrottle: new LoginThrottle(new RedisCounterStore(getRedis())),
  };
}

export interface BuildAppOptions {
  /**
   * Overrides the Fastify logger. Defaults to disabled in tests and the
   * redacting structured logger (`shared/logger.ts`) otherwise. Tests that
   * need to inspect log output pass their own `{ ...loggerOptions, stream }`
   * here rather than relying on the default.
   */
  logger?: FastifyServerOptions['logger'];
  /** Overrides any of the default services (see `AppServices`). */
  services?: Partial<AppServices>;
}

function trustHops(hops: number): (address: string, hop: number) => boolean {
  return (_address, hop) => hop < hops;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? (config.isTest ? false : loggerOptions),
    // We log one structured line per request ourselves (see the onResponse
    // hook below) instead of Fastify's default two-line request/response log.
    disableRequestLogging: true,
    bodyLimit: BODY_LIMIT_BYTES,
    // Which X-Forwarded-For hops to believe for request.ip (config TRUST_PROXY).
    // A hop count becomes the equivalent trust function (proxy-addr semantics),
    // which Fastify's typings accept where a bare number isn't.
    trustProxy:
      typeof config.trustProxy === 'number' ? trustHops(config.trustProxy) : config.trustProxy,
    requestIdHeader: 'x-request-id',
    genReqId: (req) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && header.length > 0 ? header : randomUUID();
    },
  });

  // Overrides are taken as given; defaults are only built for what's missing,
  // so a test injecting everything never touches the real pool or Redis.
  const overrides = options.services ?? {};
  const services: AppServices =
    overrides.pool && overrides.sessions && overrides.loginThrottle
      ? (overrides as AppServices)
      : { ...defaultServices(), ...overrides };
  app.decorate('services', services);

  // Request-scoped context. F-105 replaces the null with the resolved session user.
  app.decorateRequest('user', null);

  // Echo the correlation id on every response (success and error).
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // One structured line per request: method, path, status, duration, and the
  // authenticated user (once F-105 populates request.user). `request.log` is
  // Fastify's per-request child logger, so `reqId` is already bound onto
  // every line it emits — no need to add it again here. The query string is
  // stripped from `path`: it can carry sensitive values (e.g. a reset token)
  // that don't belong in a log line.
  app.addHook('onResponse', async (request, reply) => {
    const statusCode = reply.statusCode;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    request.log[level](
      {
        method: request.method,
        path: request.url.split('?')[0],
        statusCode,
        durationMs: Math.round(reply.elapsedTime),
        userId: request.user?.id ?? null,
      },
      'request completed',
    );
  });

  await app.register(helmet);
  await app.register(cookie);
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  registerErrorHandler(app);

  for (const routes of moduleRoutes) {
    await app.register(routes, { prefix: API_PREFIX });
  }

  return app;
}
