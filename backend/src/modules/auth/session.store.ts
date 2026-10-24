/**
 * Server-side sessions (architecture decision D2; created by F-103 login,
 * resolved and renewed by F-105, destroyed by F-104 logout).
 *
 * The session ID is 32 random bytes (base64url) handed to the browser in an
 * httpOnly cookie and never stored anywhere as-is: Redis keys hold only its
 * SHA-256. A Redis dump or `KEYS` listing therefore yields nothing a client
 * could present as a cookie.
 *
 * Lifetimes (D2): idle timeout 12h — the Redis TTL, which F-105 slides on
 * activity — and an absolute lifetime of 7d, recorded on the session as
 * `absoluteExpiresAt` and enforced by F-105 no matter how active the session is.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

import type { UserRole } from '../../shared/auth-context.js';

export const SESSION_IDLE_TIMEOUT_SECONDS = 12 * 60 * 60;
export const SESSION_ABSOLUTE_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
/**
 * Sliding renewal is written at most this often per session, so an active
 * user costs one Redis write a minute rather than one per request. The idle
 * timeout is therefore accurate to within this interval.
 */
export const SESSION_TOUCH_INTERVAL_SECONDS = 60;

const KEY_PREFIX = 'session:';

/**
 * What a session remembers. Role is a snapshot for observability only — F-105
 * re-reads the user (role and status) on every request, so a session never
 * grants anything the `users` row no longer does (invariant 2).
 */
export interface SessionData {
  userId: string;
  role: UserRole;
  /** ISO timestamps. */
  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
}

export interface CreatedSession {
  /** The opaque value for the cookie. Only ever sent to the client. */
  id: string;
  data: SessionData;
}

export interface SessionStore {
  create(user: { userId: string; role: UserRole }, now?: Date): Promise<CreatedSession>;
  get(id: string): Promise<SessionData | null>;
  /**
   * Sliding renewal: records `lastSeenAt` and restarts the idle timeout,
   * capped at the absolute expiry. Never re-creates a session that has
   * already expired or been destroyed.
   */
  touch(id: string, data: SessionData, now?: Date): Promise<void>;
  destroy(id: string): Promise<void>;
}

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** The Redis key for a session ID: a hash, so stored keys are not usable tokens. */
export function sessionKey(id: string): string {
  return KEY_PREFIX + createHash('sha256').update(id).digest('hex');
}

export function newSessionData(
  user: { userId: string; role: UserRole },
  now: Date = new Date(),
): SessionData {
  return {
    userId: user.userId,
    role: user.role,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    absoluteExpiresAt: new Date(
      now.getTime() + SESSION_ABSOLUTE_LIFETIME_SECONDS * 1000,
    ).toISOString(),
  };
}

/**
 * Seconds a session should live from `now`: the idle timeout, but never past
 * the absolute expiry. 0 means it is already over.
 */
export function sessionTtlSeconds(data: SessionData, now: Date = new Date()): number {
  const absoluteRemaining = Math.floor((Date.parse(data.absoluteExpiresAt) - now.getTime()) / 1000);
  return Math.max(0, Math.min(SESSION_IDLE_TIMEOUT_SECONDS, absoluteRemaining));
}

function parseSessionData(raw: string): SessionData | null {
  try {
    const value = JSON.parse(raw) as Partial<SessionData>;
    if (
      typeof value.userId === 'string' &&
      typeof value.role === 'string' &&
      typeof value.createdAt === 'string' &&
      typeof value.lastSeenAt === 'string' &&
      typeof value.absoluteExpiresAt === 'string'
    ) {
      return value as SessionData;
    }
  } catch {
    // fall through: an unreadable session is no session
  }
  return null;
}

export class RedisSessionStore implements SessionStore {
  constructor(private readonly redis: Redis) {}

  async create(
    user: { userId: string; role: UserRole },
    now: Date = new Date(),
  ): Promise<CreatedSession> {
    const id = newSessionId();
    const data = newSessionData(user, now);
    // NX: a 256-bit collision is not a real concern, but never overwrite.
    const result = await this.redis.set(
      sessionKey(id),
      JSON.stringify(data),
      'EX',
      SESSION_IDLE_TIMEOUT_SECONDS,
      'NX',
    );
    if (result !== 'OK') throw new Error('session store: could not create session');
    return { id, data };
  }

  async get(id: string): Promise<SessionData | null> {
    const raw = await this.redis.get(sessionKey(id));
    return raw === null ? null : parseSessionData(raw);
  }

  async touch(id: string, data: SessionData, now: Date = new Date()): Promise<void> {
    const ttl = sessionTtlSeconds(data, now);
    if (ttl <= 0) {
      await this.destroy(id);
      return;
    }
    const renewed: SessionData = { ...data, lastSeenAt: now.toISOString() };
    // XX: only if it still exists — a session destroyed by a concurrent
    // logout must stay destroyed.
    await this.redis.set(sessionKey(id), JSON.stringify(renewed), 'EX', ttl, 'XX');
  }

  async destroy(id: string): Promise<void> {
    await this.redis.del(sessionKey(id));
  }
}
