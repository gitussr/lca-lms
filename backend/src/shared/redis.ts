/**
 * Shared Redis client (F-103). One client per process, like `db/pool.ts`:
 * modules import `getRedis()` rather than constructing their own.
 *
 * Redis holds the D2 server-side sessions and the login throttle counters.
 * The client connects lazily (on its first command), so building the app —
 * e.g. in a test that never touches auth — opens no socket.
 *
 * Fail closed and fast: if Redis is unreachable a command errors after one
 * retry instead of queueing indefinitely, so a login fails with a 500 rather
 * than hanging or skipping the session/throttle step.
 */
import { Redis } from 'ioredis';

import { config } from './config.js';

let client: Redis | undefined;

export function createRedisClient(url: string = config.redisUrl): Redis {
  const created = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
  });
  // Without a listener, a connection error is an unhandled 'error' event and
  // crashes the process. Commands still reject, which is what callers see.
  created.on('error', () => {});
  return created;
}

export function getRedis(): Redis {
  client ??= createRedisClient();
  return client;
}

/** Closes the client and clears the singleton. Safe to call when never created. */
export async function closeRedis(): Promise<void> {
  if (client) {
    const current = client;
    client = undefined;
    // `quit` on a never-connected lazy client would connect just to say goodbye.
    if (current.status === 'wait') current.disconnect();
    else await current.quit().catch(() => current.disconnect());
  }
}
