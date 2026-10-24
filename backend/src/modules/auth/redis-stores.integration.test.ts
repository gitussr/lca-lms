import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { connectTestRedis, isRedisReachable, redactUrl, testRedisUrl } from '../../test/redis.js';
import { RedisCounterStore } from './login-throttle.js';
import {
  RedisSessionStore,
  SESSION_ABSOLUTE_LIFETIME_SECONDS,
  SESSION_IDLE_TIMEOUT_SECONDS,
  sessionKey,
} from './session.store.js';

/** F-103: the Redis-backed session store and throttle counters, against a real Redis. */

const reachable = await isRedisReachable();

test(
  'Redis auth stores (F-103)',
  { skip: reachable ? false : `no Redis reachable at ${redactUrl(testRedisUrl())}` },
  async (t) => {
    const redis = await connectTestRedis();
    t.after(() => redis.disconnect());

    await t.test('sessions: create → get → destroy, stored under the hashed ID', async (st) => {
      const store = new RedisSessionStore(redis);
      const { id, data } = await store.create({ userId: 'user-1', role: 'teacher' });
      st.after(() => store.destroy(id));

      assert.deepEqual(await store.get(id), data);
      assert.equal(await redis.exists(id), 0);
      assert.equal(await redis.exists(sessionKey(id)), 1);

      const ttl = await redis.ttl(sessionKey(id));
      assert.ok(ttl > SESSION_IDLE_TIMEOUT_SECONDS - 60 && ttl <= SESSION_IDLE_TIMEOUT_SECONDS);

      await store.destroy(id);
      assert.equal(await store.get(id), null);
    });

    await t.test('sessions: touch slides the TTL, capped, and never revives', async (st) => {
      const store = new RedisSessionStore(redis);
      const created = new Date(Date.now() - (SESSION_ABSOLUTE_LIFETIME_SECONDS - 600) * 1000);
      const { id, data } = await store.create({ userId: 'user-2', role: 'student' }, created);
      st.after(() => store.destroy(id));

      // 10 minutes of absolute lifetime left: the TTL is capped there, not 12h.
      const now = new Date();
      await store.touch(id, data, now);
      const ttl = await redis.ttl(sessionKey(id));
      assert.ok(ttl > 590 && ttl <= 600, `ttl ${ttl}`);
      assert.equal((await store.get(id))?.lastSeenAt, now.toISOString());

      // A destroyed session stays destroyed.
      await store.destroy(id);
      await store.touch(id, data, now);
      assert.equal(await redis.exists(sessionKey(id)), 0);
    });

    await t.test('sessions: unknown and corrupted entries read as no session', async (st) => {
      const store = new RedisSessionStore(redis);
      assert.equal(await store.get('never-issued'), null);

      const id = `corrupt-${randomBytes(8).toString('hex')}`;
      await redis.set(sessionKey(id), '{not json', 'EX', 60);
      st.after(() => redis.del(sessionKey(id)));
      assert.equal(await store.get(id), null);
    });

    await t.test('counters: increment starts a window, decrement floors at zero', async (st) => {
      const counters = new RedisCounterStore(redis);
      const key = `login-throttle:test:${randomBytes(8).toString('hex')}`;
      st.after(() => redis.del(key));

      assert.deepEqual(await counters.increment(key, 900), { count: 1, ttlSeconds: 900 });
      const second = await counters.increment(key, 900);
      assert.equal(second.count, 2);
      assert.ok(second.ttlSeconds > 890 && second.ttlSeconds <= 900);

      await counters.decrement(key);
      await counters.decrement(key);
      await counters.decrement(key);
      assert.equal(await redis.get(key), '0');

      await counters.delete(key);
      assert.equal(await redis.exists(key), 0);
      // Decrementing a missing key must not create one (it would have no TTL).
      await counters.decrement(key);
      assert.equal(await redis.exists(key), 0);
    });
  },
);
