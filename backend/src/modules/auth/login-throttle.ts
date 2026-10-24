/**
 * Login throttling per account and per IP (F-103).
 *
 * Fixed-window counters. Every attempt is counted *before* the password is
 * checked (`consume`), so a burst of parallel guesses can't race past a
 * check-then-increment gap; a successful login then refunds its IP count and
 * clears the account's count (`recordSuccess`). In effect both limits count
 * failures, and a classroom of students logging in from one NAT address only
 * ever spends the IP budget on its typos.
 *
 * Unknown emails are counted exactly like real ones, so a 429 says nothing
 * about whether an account exists. Throttled attempts get 429 + Retry-After;
 * nothing is locked permanently, which would hand an attacker a way to lock
 * real users out.
 */
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

export const LOGIN_THROTTLE_WINDOW_SECONDS = 15 * 60;
/** Failed attempts allowed per account per window. */
export const LOGIN_MAX_FAILURES_PER_ACCOUNT = 5;
/** Failed attempts allowed per client IP per window (generous: shared NATs). */
export const LOGIN_MAX_FAILURES_PER_IP = 50;

const KEY_PREFIX = 'login-throttle:';

export interface CounterValue {
  count: number;
  /** Seconds until the window resets. */
  ttlSeconds: number;
}

/** Minimal counter backend so the throttle logic is testable without Redis. */
export interface CounterStore {
  /** Increments `key`, starting a `windowSeconds` window on the first hit. */
  increment(key: string, windowSeconds: number): Promise<CounterValue>;
  decrement(key: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export type ThrottleResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

function accountKey(normalizedEmail: string): string {
  // Hashed so the counter store never holds email addresses.
  return `${KEY_PREFIX}account:${createHash('sha256').update(normalizedEmail).digest('hex')}`;
}

function ipKey(ip: string): string {
  return `${KEY_PREFIX}ip:${ip}`;
}

export class LoginThrottle {
  constructor(private readonly counters: CounterStore) {}

  /** Counts one attempt; `allowed: false` once either limit is exceeded. */
  async consume(ip: string, normalizedEmail: string): Promise<ThrottleResult> {
    const [account, address] = await Promise.all([
      this.counters.increment(accountKey(normalizedEmail), LOGIN_THROTTLE_WINDOW_SECONDS),
      this.counters.increment(ipKey(ip), LOGIN_THROTTLE_WINDOW_SECONDS),
    ]);
    const blocked = [
      account.count > LOGIN_MAX_FAILURES_PER_ACCOUNT ? account.ttlSeconds : 0,
      address.count > LOGIN_MAX_FAILURES_PER_IP ? address.ttlSeconds : 0,
    ];
    const retryAfterSeconds = Math.max(...blocked);
    return retryAfterSeconds > 0 ? { allowed: false, retryAfterSeconds } : { allowed: true };
  }

  /** A correct login: refund the attempt for the IP, forgive the account's failures. */
  async recordSuccess(ip: string, normalizedEmail: string): Promise<void> {
    await Promise.all([
      this.counters.delete(accountKey(normalizedEmail)),
      this.counters.decrement(ipKey(ip)),
    ]);
  }
}

/**
 * INCR, set the window on the first hit, return [count, ttl]. One script so
 * the counter can't be left without an expiry if the process dies mid-way.
 */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}
`;

/** Decrement without going below zero or creating a key that has expired. */
const DECREMENT_SCRIPT = `
if redis.call('GET', KEYS[1]) and tonumber(redis.call('GET', KEYS[1])) > 0 then
  redis.call('DECR', KEYS[1])
end
return 0
`;

export class RedisCounterStore implements CounterStore {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, windowSeconds: number): Promise<CounterValue> {
    const [count, ttl] = (await this.redis.eval(INCREMENT_SCRIPT, 1, key, windowSeconds)) as [
      number,
      number,
    ];
    return { count, ttlSeconds: ttl > 0 ? ttl : windowSeconds };
  }

  async decrement(key: string): Promise<void> {
    await this.redis.eval(DECREMENT_SCRIPT, 1, key);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
