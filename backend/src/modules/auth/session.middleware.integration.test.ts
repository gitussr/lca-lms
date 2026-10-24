import assert from 'node:assert/strict';
import test from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import { loggerOptions } from '../../shared/logger.js';
import { createTestDatabase, isServerReachable, maintenanceUrl, redactUrl } from '../../test/db.js';
import { MemoryCounterStore, MemorySessionStore } from '../../test/memory-stores.js';
import { seedUser } from '../../test/seed.js';
import { LoginThrottle } from './login-throttle.js';
import { requireAuth } from './session.middleware.js';
import {
  SESSION_ABSOLUTE_LIFETIME_SECONDS,
  SESSION_IDLE_TIMEOUT_SECONDS,
  SESSION_TOUCH_INTERVAL_SECONDS,
  sessionKey,
  type SessionStore,
} from './session.store.js';

/**
 * F-105: the session cookie → `request.user` resolution and the `requireAuth`
 * guard, end to end: real login, real Postgres users, an in-memory session
 * store on a fake clock so idle and absolute expiry can be stepped through.
 */

const PASSWORD = 'correct horse battery staple';
const COOKIE = '__Host-lca_sid';
const PROTECTED = '/api/v1/__test/protected';

const reachable = await isServerReachable();

interface Harness {
  app: FastifyInstance;
  sessions: MemorySessionStore;
  advance: (seconds: number) => void;
  logs: () => Record<string, unknown>[];
}

test(
  'session middleware (F-105)',
  { skip: reachable ? false : `no Postgres reachable at ${redactUrl(maintenanceUrl())}` },
  async (t) => {
    const db = await createTestDatabase();
    t.after(() => db.drop());

    async function makeApp(overrides: { sessions?: SessionStore } = {}): Promise<Harness> {
      let now = Date.parse('2026-10-24T08:00:00.000Z');
      const clock = () => new Date(now);
      const sessions = new MemorySessionStore(clock);
      const raw: string[] = [];
      const app = await buildApp({
        logger: { ...loggerOptions, stream: { write: (line: string) => raw.push(line) } },
        services: {
          pool: db.pool,
          sessions: overrides.sessions ?? sessions,
          loginThrottle: new LoginThrottle(new MemoryCounterStore()),
          clock,
        },
      });
      app.get(PROTECTED, { preHandler: requireAuth }, (request) => ({ user: request.user }));
      return {
        app,
        sessions,
        advance: (seconds) => {
          now += seconds * 1000;
        },
        logs: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>),
      };
    }

    let current: Harness | undefined;
    t.beforeEach(async () => {
      await db.reset();
      current = await makeApp();
    });
    t.afterEach(async () => {
      await current?.app.close();
    });
    const h = (): Harness => {
      if (!current) throw new Error('harness not initialised');
      return current;
    };

    /** Seeds a user, logs in through the real endpoint, returns the session ID. */
    async function loginAs(options: Parameters<typeof seedUser>[1] = {}) {
      const { user } = await seedUser(db.pool, { ...options, password: PASSWORD });
      const res = await h().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: user.email, password: PASSWORD },
      });
      assert.equal(res.statusCode, 200);
      const sid = res.cookies.find((c) => c.name === COOKIE)?.value;
      assert.ok(sid);
      return { user, sid };
    }

    const get = (url: string, sid?: string, app: FastifyInstance = h().app) =>
      app.inject({
        method: 'GET',
        url,
        headers: sid ? { cookie: `${COOKIE}=${sid}` } : {},
      });

    const isCleared = (res: Awaited<ReturnType<typeof get>>) => {
      const cookie = res.cookies.find((c) => c.name === COOKIE);
      return cookie !== undefined && cookie.value === '' && cookie.path === '/';
    };

    await t.test('no cookie: 401, no cookie work', async () => {
      const res = await get(PROTECTED);
      assert.equal(res.statusCode, 401);
      assert.equal(res.json().error.code, 'UNAUTHORIZED');
      assert.equal(res.headers['set-cookie'], undefined);
    });

    await t.test('a valid session resolves the user from the database', async () => {
      const { user, sid } = await loginAs({ role: 'teacher' });
      const res = await get(PROTECTED, sid);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json().user, { id: user.id, role: 'teacher', status: 'active' });

      const line = h()
        .logs()
        .findLast((l) => l.msg === 'request completed');
      assert.equal(line?.userId, user.id);
    });

    await t.test('an unknown cookie is 401 and cleared; public routes still answer', async () => {
      const res = await get(PROTECTED, 'forged-or-stale-session-id');
      assert.equal(res.statusCode, 401);
      assert.ok(isCleared(res));

      const health = await get('/api/v1/health', 'forged-or-stale-session-id');
      assert.equal(health.statusCode, 200);
      assert.ok(isCleared(health));
    });

    await t.test('idle timeout: 12h without a request ends the session', async () => {
      const { sid } = await loginAs();
      h().advance(SESSION_IDLE_TIMEOUT_SECONDS - 1);
      assert.equal((await get(PROTECTED, sid)).statusCode, 200);

      h().advance(SESSION_IDLE_TIMEOUT_SECONDS + 1);
      const res = await get(PROTECTED, sid);
      assert.equal(res.statusCode, 401);
      assert.ok(isCleared(res));
    });

    await t.test('activity slides the idle timeout, written at most once a minute', async () => {
      const { sid } = await loginAs();
      const lastSeen = () => h().sessions.entries.get(sessionKey(sid))?.data.lastSeenAt;
      const loggedInAt = lastSeen();

      h().advance(SESSION_TOUCH_INTERVAL_SECONDS - 1);
      assert.equal((await get(PROTECTED, sid)).statusCode, 200);
      assert.equal(lastSeen(), loggedInAt, 'no write inside the touch interval');

      h().advance(1);
      assert.equal((await get(PROTECTED, sid)).statusCode, 200);
      assert.notEqual(lastSeen(), loggedInAt);

      // 11h steps: each would have expired a non-sliding 12h session by the second.
      for (let i = 0; i < 3; i += 1) {
        h().advance(11 * 60 * 60);
        assert.equal((await get(PROTECTED, sid)).statusCode, 200, `step ${i}`);
      }
    });

    await t.test('absolute lifetime: 7 days ends even a constantly active session', async () => {
      const { sid } = await loginAs();
      let elapsed = 0;
      let last = 200;
      while (elapsed < SESSION_ABSOLUTE_LIFETIME_SECONDS + 11 * 60 * 60) {
        h().advance(11 * 60 * 60);
        elapsed += 11 * 60 * 60;
        last = (await get(PROTECTED, sid)).statusCode;
        if (elapsed < SESSION_ABSOLUTE_LIFETIME_SECONDS) assert.equal(last, 200, `at ${elapsed}s`);
      }
      assert.equal(last, 401);
    });

    await t.test(
      'absolute expiry is enforced even if the store still holds the session',
      async () => {
        const { user, sid } = await loginAs();
        // As if Redis had kept it (e.g. a TTL set before a config change).
        const entry = h().sessions.entries.get(sessionKey(sid));
        assert.ok(entry);
        entry.data = { ...entry.data, absoluteExpiresAt: new Date(0).toISOString() };

        const res = await get(PROTECTED, sid);
        assert.equal(res.statusCode, 401);
        assert.ok(isCleared(res));
        assert.equal(h().sessions.entries.has(sessionKey(sid)), false, 'session destroyed');
        const rejected = h()
          .logs()
          .find((l) => l.event === 'auth.session.rejected');
        assert.equal(rejected?.reason, 'absolute_expiry');
        assert.equal(rejected?.userId, user.id);
      },
    );

    await t.test('a user deactivated mid-session loses access on the next request', async () => {
      const { user, sid } = await loginAs();
      assert.equal((await get(PROTECTED, sid)).statusCode, 200);

      await db.pool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [user.id]);
      const res = await get(PROTECTED, sid);
      assert.equal(res.statusCode, 401);
      assert.equal(h().sessions.entries.size, 0, 'session destroyed');

      // Reactivating the account does not resurrect the old session.
      await db.pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [user.id]);
      assert.equal((await get(PROTECTED, sid)).statusCode, 401);
    });

    await t.test('a user soft-deleted mid-session loses access', async () => {
      const { user, sid } = await loginAs();
      await db.pool.query('UPDATE users SET deleted_at = now() WHERE id = $1', [user.id]);
      assert.equal((await get(PROTECTED, sid)).statusCode, 401);
    });

    await t.test('role comes from the database, not the session snapshot', async () => {
      const { user, sid } = await loginAs({ role: 'admin' });
      await db.pool.query(`UPDATE users SET role = 'teacher' WHERE id = $1`, [user.id]);
      const res = await get(PROTECTED, sid);
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().user.role, 'teacher');
    });

    await t.test('a failing session store fails closed (500), never open', async (st) => {
      const broken: SessionStore = {
        create: () => Promise.reject(new Error('store down')),
        get: () => Promise.reject(new Error('store down')),
        touch: () => Promise.reject(new Error('store down')),
        destroy: () => Promise.reject(new Error('store down')),
      };
      const other = await makeApp({ sessions: broken });
      st.after(() => other.app.close());

      const res = await get(PROTECTED, 'any-session-id', other.app);
      assert.equal(res.statusCode, 500);
      assert.equal(res.json().error.code, 'INTERNAL');
    });
  },
);
