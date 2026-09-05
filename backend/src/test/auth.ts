/**
 * Test-only "log in as a role" helper (F-006).
 *
 * There is no session store or `users` table yet (those land in F-101/F-105),
 * so this doesn't authenticate against real data — it directly sets
 * `request.user`, the same field F-105's session middleware will populate
 * from a real session lookup. That's enough for role-gated route tests
 * (F-106+) to run today, and nothing here needs to change once F-105 lands:
 * only the *production* path (real session → real user) gets built then.
 */
import type { FastifyInstance } from 'fastify';

import type { AuthenticatedUser, UserRole } from '../shared/auth-context.js';

let nextId = 0;

/**
 * An obviously-fake, syntactically-valid UUID for test fixtures — never a
 * real identifier, and unmistakable as a placeholder if it ever leaked into
 * a log or a bug report.
 */
function fakeUserId(): string {
  nextId += 1;
  return `00000000-0000-4000-a000-${nextId.toString().padStart(12, '0')}`;
}

export function fakeAuthenticatedUser(
  role: UserRole,
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return { id: fakeUserId(), role, status: 'active', ...overrides };
}

/**
 * Makes every request `app` handles behave as if `user` were already
 * authenticated. Call once per `app` instance (not per request) — typically
 * right after `buildApp()`, before `app.inject(...)`. Pass `null` to
 * explicitly simulate an unauthenticated caller.
 */
export function actAs(app: FastifyInstance, user: AuthenticatedUser | null): void {
  app.addHook('onRequest', async (request) => {
    request.user = user;
  });
}
