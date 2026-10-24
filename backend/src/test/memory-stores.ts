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
  sessionKey,
  type CreatedSession,
  type SessionData,
  type SessionStore,
} from '../modules/auth/session.store.js';
import type { UserRole } from '../shared/auth-context.js';

export class MemorySessionStore implements SessionStore {
  /** Keyed like Redis: by the session ID's hash, never the raw ID. */
  readonly entries = new Map<string, SessionData>();

  async create(user: { userId: string; role: UserRole }): Promise<CreatedSession> {
    const id = newSessionId();
    const data = newSessionData(user);
    this.entries.set(sessionKey(id), data);
    return { id, data };
  }

  async get(id: string): Promise<SessionData | null> {
    return this.entries.get(sessionKey(id)) ?? null;
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
