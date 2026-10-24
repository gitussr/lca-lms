/**
 * Authenticated session middleware (F-105).
 *
 * `resolveSession` runs on every request (an `onRequest` hook in app.ts) and
 * turns the session cookie into `request.user`, or leaves it `null`:
 *
 *   1. No cookie → unauthenticated (no Redis or database work).
 *   2. Session missing → idle-expired (Redis TTL), logged out, or never issued.
 *   3. Past `absoluteExpiresAt` → destroyed, however active it was (D2: 7d).
 *   4. The user is re-read from Postgres every time; anything but an `active`,
 *      non-deleted row destroys the session (invariant 2: deactivation takes
 *      effect on the very next request). Role and status come from that row,
 *      never from the session.
 *   5. Otherwise the idle timeout slides (at most one write per minute).
 *
 * A cookie that doesn't resolve is cleared from the browser. Public routes
 * still answer normally — rejecting is `requireAuth`'s job, so each protected
 * route states its rule explicitly (F-106 adds role guards on top).
 *
 * Errors (Redis or Postgres down) propagate as a 500: fail closed, never
 * "couldn't check, so let it through".
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { UnauthorizedError } from '../../shared/errors.js';
import type { UserRow } from '../users/users.model.js';
import { sessionCookieName, sessionCookieOptions } from './session.cookie.js';
import { SESSION_TOUCH_INTERVAL_SECONDS } from './session.store.js';

type SessionUserRow = Pick<UserRow, 'id' | 'role' | 'status' | 'deleted_at'>;

type Rejection = 'unknown_session' | 'absolute_expiry' | 'user_missing' | 'user_not_active';

export async function resolveSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookieName = sessionCookieName();
  const sessionId = request.cookies[cookieName];
  if (!sessionId) return;

  const { sessions, pool, clock } = request.server.services;
  const now = clock();

  const reject = async (reason: Rejection, userId: string | null = null): Promise<void> => {
    if (reason !== 'unknown_session') await sessions.destroy(sessionId);
    const { maxAge: _maxAge, ...clearOptions } = sessionCookieOptions();
    void reply.clearCookie(cookieName, clearOptions);
    request.log.info({ event: 'auth.session.rejected', reason, userId }, 'session rejected');
  };

  const session = await sessions.get(sessionId);
  if (!session) return reject('unknown_session');

  if (now.getTime() >= Date.parse(session.absoluteExpiresAt)) {
    return reject('absolute_expiry', session.userId);
  }

  const { rows } = await pool.query<SessionUserRow>(
    'SELECT id, role, status, deleted_at FROM users WHERE id = $1',
    [session.userId],
  );
  const user = rows[0];
  if (!user) return reject('user_missing', session.userId);
  if (user.status !== 'active' || user.deleted_at !== null) {
    return reject('user_not_active', user.id);
  }

  if (now.getTime() - Date.parse(session.lastSeenAt) >= SESSION_TOUCH_INTERVAL_SECONDS * 1000) {
    await sessions.touch(sessionId, session, now);
  }

  request.user = { id: user.id, role: user.role, status: user.status };
}

/**
 * Route guard: 401 unless `resolveSession` produced a user. Add it as a
 * `preHandler` on every route that needs an authenticated caller.
 */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.user) throw new UnauthorizedError();
}
