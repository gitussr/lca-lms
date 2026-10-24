import type { FastifyPluginAsync } from 'fastify';

import { login, warmDummyHash } from './login.service.js';
import { sessionCookieName, sessionCookieOptions } from './session.cookie.js';

/**
 * Authentication: login, logout, session, GET /me, change/set password (F-103–F-109).
 *
 * Registered at the /api/v1 prefix by src/app.ts; owns `/auth/*` (D9).
 */

interface LoginBody {
  email: string;
  password: string;
}

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    // Anything else (e.g. a `role`) is stripped by Fastify's default
    // `removeAdditional` before the handler sees it — role comes only from
    // the users row.
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 1, maxLength: 254 },
      // Generous ceiling; verifyPassword refuses >1024 without hashing.
      password: { type: 'string', minLength: 1, maxLength: 1024 },
    },
  },
  response: {
    // Serialized through this allow-list, so nothing else on the object can leak.
    200: {
      type: 'object',
      required: ['user'],
      additionalProperties: false,
      properties: {
        user: {
          type: 'object',
          required: ['id', 'fullName', 'role'],
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            fullName: { type: 'string' },
            role: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

export const authRoutes: FastifyPluginAsync = async (app) => {
  warmDummyHash();

  app.post<{ Body: LoginBody }>('/auth/login', { schema: loginSchema }, async (request, reply) => {
    const { pool, sessions, loginThrottle } = app.services;
    const cookieName = sessionCookieName();

    const result = await login(
      { pool, sessions, throttle: loginThrottle, log: request.log },
      { email: request.body.email, password: request.body.password, ip: request.ip },
    );

    // Session fixation: whatever session this browser carried before is
    // dropped; the new one always has a fresh, server-generated ID.
    const previous = request.cookies[cookieName];
    if (previous) await sessions.destroy(previous);

    // So the request log line attributes the login to the user (F-005).
    request.user = { id: result.user.id, role: result.user.role, status: 'active' };

    void reply
      .header('cache-control', 'no-store')
      .setCookie(cookieName, result.session.id, sessionCookieOptions());
    return { user: result.user };
  });
};
