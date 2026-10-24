/**
 * Email + password login (F-103).
 *
 * Every failure — unknown email, wrong password, an account that is
 * `pending`/`inactive`/soft-deleted, or one with no password yet — ends in the
 * same `InvalidCredentialsError`, after the same work: an argon2 verify runs
 * on every non-throttled attempt (against a dummy hash when there's no real
 * one), so neither the response body nor its timing reveals which accounts
 * exist. Status is checked only *after* the password, for the same reason.
 *
 * The role in the session and the response comes from the `users` row, never
 * from the request.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';

import { InvalidCredentialsError, TooManyRequestsError } from '../../shared/errors.js';
import { normalizeEmail, type Role, type UserRow } from '../users/users.model.js';
import type { LoginThrottle } from './login-throttle.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import type { CreatedSession, SessionStore } from './session.store.js';

export interface LoginDeps {
  pool: Pool;
  sessions: SessionStore;
  throttle: LoginThrottle;
  log: FastifyBaseLogger;
}

export interface LoginInput {
  email: string;
  password: string;
  ip: string;
}

/** The safe profile login returns (Backlog F-103: id, name, role). */
export interface LoginUser {
  id: string;
  fullName: string;
  role: Role;
}

export interface LoginResult {
  user: LoginUser;
  session: CreatedSession;
}

type FailureReason = 'unknown_email' | 'no_password' | 'wrong_password' | 'not_active';

let dummyHash: Promise<string> | undefined;

/**
 * A real argon2id hash of a random secret, made with the current cost
 * parameters, so verifying against it costs exactly what a real verify does.
 */
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHash;
}

/** Computes the dummy hash ahead of the first login, so that one isn't slower. */
export function warmDummyHash(): void {
  getDummyHash().catch(() => {
    dummyHash = undefined;
  });
}

export async function login(deps: LoginDeps, input: LoginInput): Promise<LoginResult> {
  const { pool, sessions, throttle, log } = deps;
  const email = normalizeEmail(input.email);

  const throttled = await throttle.consume(input.ip, email);
  if (!throttled.allowed) {
    log.warn({ event: 'auth.login.throttled', ip: input.ip }, 'login throttled');
    throw new TooManyRequestsError(throttled.retryAfterSeconds);
  }

  // lower(email) is unique across soft-deleted rows too (F-101), so at most one row.
  const { rows } = await pool.query<UserRow>('SELECT * FROM users WHERE lower(email) = $1', [
    email,
  ]);
  const user = rows[0];

  const matches = await verifyPassword(
    user?.password_hash ?? (await getDummyHash()),
    input.password,
  );

  let failure: FailureReason | null = null;
  if (!user) failure = 'unknown_email';
  else if (!user.password_hash) failure = 'no_password';
  else if (!matches) failure = 'wrong_password';
  else if (user.status !== 'active' || user.deleted_at !== null) failure = 'not_active';

  if (failure || !user) {
    // Never the password; the email only as the user id it resolved to, if any.
    log.warn(
      { event: 'auth.login.failed', reason: failure, userId: user?.id ?? null, ip: input.ip },
      'login failed',
    );
    throw new InvalidCredentialsError();
  }

  await throttle.recordSuccess(input.ip, email);
  await upgradeHashIfNeeded(deps, user, input.password);

  const session = await sessions.create({ userId: user.id, role: user.role });
  log.info({ event: 'auth.login.succeeded', userId: user.id }, 'login succeeded');

  return { user: { id: user.id, fullName: user.full_name, role: user.role }, session };
}

/**
 * Re-hash with the current cost parameters (F-102 `needsRehash`). Best-effort:
 * the login has already succeeded, so a failure here is logged, not thrown.
 * The `password_hash = $3` guard leaves a concurrently changed password alone.
 */
async function upgradeHashIfNeeded(
  { pool, log }: LoginDeps,
  user: UserRow,
  password: string,
): Promise<void> {
  if (!user.password_hash || !needsRehash(user.password_hash)) return;
  try {
    const upgraded = await hashPassword(password);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2 AND password_hash = $3', [
      upgraded,
      user.id,
      user.password_hash,
    ]);
    log.info({ event: 'auth.password.rehashed', userId: user.id }, 'password hash upgraded');
  } catch (err) {
    log.error({ err, userId: user.id }, 'password rehash failed');
  }
}
