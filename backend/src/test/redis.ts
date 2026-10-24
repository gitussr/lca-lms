/**
 * Redis test harness (F-103). Like `db.ts`'s `isServerReachable()`: Redis
 * integration tests self-skip when no server answers, and
 * `REQUIRE_TEST_REDIS=true` (set in CI) turns that skip into a failure.
 *
 * Tests use their own logical database (`/15`), random identifiers, and delete
 * only the keys they create — never FLUSHDB.
 */
import type { Redis } from 'ioredis';

import { describeError, redactUrl } from '../db/cli.js';
import { config } from '../shared/config.js';
import { createRedisClient } from '../shared/redis.js';

export function testRedisUrl(baseUrl: string = config.redisUrl): string {
  const url = new URL(baseUrl);
  url.pathname = '/15';
  return url.toString();
}

export { redactUrl };

export async function isRedisReachable(
  url: string = testRedisUrl(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const client = createRedisClient(url);
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch (err) {
    if (env.REQUIRE_TEST_REDIS === 'true') {
      throw new Error(
        `REQUIRE_TEST_REDIS=true but no Redis is reachable at ${redactUrl(url)}: ${describeError(err)}`,
      );
    }
    return false;
  } finally {
    client.disconnect();
  }
}

/** A connected client on the test database. Caller disconnects it. */
export async function connectTestRedis(url: string = testRedisUrl()): Promise<Redis> {
  const client = createRedisClient(url);
  await client.connect();
  return client;
}
