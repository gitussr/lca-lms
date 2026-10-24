/**
 * In-memory stand-ins for the Redis-backed auth stores (F-103), so route
 * tests run without a Redis server. They implement the same interfaces as the
 * production classes and reuse their ID/key/data helpers; the Redis versions
 * have their own integration test (`modules/auth/redis-stores.integration.test.ts`).
 */
import type { CounterStore, CounterValue } from '../modules/auth/login-throttle.js';
import {
  newSessionData,
  newSessionId,
  SESSION_IDLE_TIMEOUT_SECONDS,
  sessionKey,
  sessionTtlSeconds,
  type CreatedSession,
  type SessionData,
  type SessionStore,
} from '../modules/auth/session.store.js';
import type { UserRole } from '../shared/auth-context.js';

export class MemorySessionStore implements SessionStore {
  /** Keyed like Redis: by the session ID's hash, never the raw ID. */
  readonly entries = new Map<string, { data: SessionData; expiresAt: number }>();

  /** `now` should be the same clock the app uses, so idle expiry can be simulated. */
  constructor(private readonly now: () => Date = () => new Date()) {}

  private live(id: string): { data: SessionData; expiresAt: number } | undefined {
    const key = sessionKey(id);
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.now().getTime()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  async create(
    user: { userId: string; role: UserRole },
    now: Date = this.now(),
  ): Promise<CreatedSession> {
    const id = newSessionId();
    const data = newSessionData(user, now);
    this.entries.set(sessionKey(id), {
      data,
      expiresAt: now.getTime() + SESSION_IDLE_TIMEOUT_SECONDS * 1000,
    });
    return { id, data };
  }

  async get(id: string): Promise<SessionData | null> {
    return this.live(id)?.data ?? null;
  }

  async touch(id: string, data: SessionData, now: Date = this.now()): Promise<void> {
    if (!this.live(id)) return;
    const ttl = sessionTtlSeconds(data, now);
    if (ttl <= 0) {
      await this.destroy(id);
      return;
    }
    this.entries.set(sessionKey(id), {
      data: { ...data, lastSeenAt: now.toISOString() },
      expiresAt: now.getTime() + ttl * 1000,
    });
  }

  async destroy(id: string): Promise<void> {
    this.entries.delete(sessionKey(id));
  }
}

export class MemoryCounterStore implements CounterStore {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  private live(key: string): { count: number; expiresAt: number } | undefined {
    const entry = this.counters.get(key);
    if (entry && entry.expiresAt <= this.now()) {
      this.counters.delete(key);
      return undefined;
    }
    return entry;
  }

  async increment(key: string, windowSeconds: number): Promise<CounterValue> {
    const entry = this.live(key) ?? { count: 0, expiresAt: this.now() + windowSeconds * 1000 };
    entry.count += 1;
    this.counters.set(key, entry);
    return { count: entry.count, ttlSeconds: Math.ceil((entry.expiresAt - this.now()) / 1000) };
  }

  async decrement(key: string): Promise<void> {
    const entry = this.live(key);
    if (entry && entry.count > 0) entry.count -= 1;
  }

  async delete(key: string): Promise<void> {
    this.counters.delete(key);
  }
}
