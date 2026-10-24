import assert from 'node:assert/strict';
import test from 'node:test';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../app.js';
import { loggerOptions } from '../../shared/logger.js';
import { createTestDatabase, isServerReachable, maintenanceUrl, redactUrl } from '../../test/db.js';
import { MemoryCounterStore, MemorySessionStore } from '../../test/memory-stores.js';
import { seedUser } from '../../test/seed.js';
import {
  LOGIN_MAX_FAILURES_PER_ACCOUNT,
  LOGIN_MAX_FAILURES_PER_IP,
  LoginThrottle,
} from './login-throttle.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import { sessionKey } from './session.store.js';

/**
 * F-103: `POST /api/v1/auth/login` end to end — real Postgres users, real
 * argon2id hashes; in-memory session and throttle stores (their Redis
 * versions are covered by `redis-stores.integration.test.ts`).
 */

const PASSWORD = 'correct horse battery staple';
const COOKIE = '__Host-lca_sid'; // Secure is on by default, test profile included

const reachable = await isServerReachable();

interface Harness {
  app: FastifyInstance;
  sessions: MemorySessionStore;
  logs: () => Record<string, unknown>[];
  rawLogs: () => string;
}

test(
  'POST /api/v1/auth/login (F-103)',
  { skip: reachable ? false : `no Postgres reachable at ${redactUrl(maintenanceUrl())}` },
  async (t) => {
    const db = await createTestDatabase();
    t.after(() => db.drop());

    let current: Harness | undefined;

    // Fresh app, stores and log capture per test, so throttle counts don't leak.
    t.beforeEach(async () => {
      await db.reset();
      const raw: string[] = [];
      const sessions = new MemorySessionStore();
      const app = await buildApp({
        logger: { ...loggerOptions, stream: { write: (line: string) => raw.push(line) } },
        services: {
          pool: db.pool,
          sessions,
          loginThrottle: new LoginThrottle(new MemoryCounterStore()),
        },
      });
      current = {
        app,
        sessions,
        logs: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>),
        rawLogs: () => raw.join(''),
      };
    });
    t.afterEach(async () => {
      await current?.app.close();
    });

    const h = (): Harness => {
      if (!current) throw new Error('harness not initialised');
      return current;
    };

    const login = (
      body: Record<string, unknown>,
      options: { ip?: string; headers?: Record<string, string> } = {},
    ) =>
      h().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: body,
        remoteAddress: options.ip ?? '198.51.100.1',
        headers: options.headers,
      });

    await t.test('valid credentials: 200, safe profile, hardened session cookie', async () => {
      const { user } = await seedUser(db.pool, {
        role: 'teacher',
        fullName: 'Asha Rao',
        password: PASSWORD,
      });

      const res = await login({ email: user.email, password: PASSWORD });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), {
        user: { id: user.id, fullName: 'Asha Rao', role: 'teacher' },
      });
      assert.equal(res.headers['cache-control'], 'no-store');

      const cookie = res.cookies.find((c) => c.name === COOKIE);
      assert.ok(cookie, 'expected the session cookie');
      assert.equal(cookie.httpOnly, true);
      assert.equal(cookie.secure, true);
      assert.equal(cookie.sameSite, 'Lax');
      assert.equal(cookie.path, '/');
      assert.equal(cookie.domain, undefined);

      const session = await h().sessions.get(cookie.value);
      assert.equal(session?.userId, user.id);
      assert.equal(session?.role, 'teacher');
      // Stored by hash only.
      assert.ok(h().sessions.entries.has(sessionKey(cookie.value)));
      assert.ok(![...h().sessions.entries.keys()].includes(cookie.value));

      // The body never carries the hash, and the request line names the user.
      assert.ok(!res.body.includes('argon2'));
      const line = h()
        .logs()
        .find((l) => l.msg === 'request completed');
      assert.equal(line?.userId, user.id);
    });

    await t.test('email matching ignores case and surrounding whitespace', async () => {
      await seedUser(db.pool, { email: 'mixed.case@example.test', password: PASSWORD });
      const res = await login({ email: '  Mixed.Case@EXAMPLE.test ', password: PASSWORD });
      assert.equal(res.statusCode, 200);
    });

    await t.test('a role in the request body is ignored', async () => {
      const { user } = await seedUser(db.pool, { role: 'student', password: PASSWORD });
      const res = await login({ email: user.email, password: PASSWORD, role: 'admin' });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().user.role, 'student');
      const cookie = res.cookies.find((c) => c.name === COOKIE);
      assert.equal((await h().sessions.get(cookie?.value ?? ''))?.role, 'student');
    });

    await t.test('every failure is the same generic 401, with no cookie or session', async () => {
      const active = await seedUser(db.pool, { password: PASSWORD });
      const inactive = await seedUser(db.pool, { status: 'inactive', password: PASSWORD });
      const pending = await seedUser(db.pool, { status: 'pending' });
      const deleted = await seedUser(db.pool, { password: PASSWORD, deletedAt: new Date() });

      const attempts = [
        { case: 'wrong password', email: active.user.email, password: 'not the password!' },
        { case: 'unknown email', email: 'nobody@example.test', password: PASSWORD },
        { case: 'inactive', email: inactive.user.email, password: PASSWORD },
        { case: 'pending', email: pending.user.email, password: PASSWORD },
        { case: 'soft-deleted', email: deleted.user.email, password: PASSWORD },
      ];

      for (const attempt of attempts) {
        const res = await login(
          { email: attempt.email, password: attempt.password },
          // Separate IPs/accounts: this test is about the response, not throttling.
          { ip: `198.51.100.${attempts.indexOf(attempt) + 10}` },
        );
        assert.equal(res.statusCode, 401, attempt.case);
        const body = res.json();
        assert.deepEqual(
          body.error,
          { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
          attempt.case,
        );
        assert.equal(res.headers['set-cookie'], undefined, attempt.case);
      }
      assert.equal(h().sessions.entries.size, 0);
    });

    await t.test('failed attempts are logged with a reason, never the password', async () => {
      const { user } = await seedUser(db.pool, { password: PASSWORD });
      await login({ email: user.email, password: 'hunter2-wrong-guess' });
      await login({ email: 'ghost@example.test', password: 'hunter2-wrong-guess' });

      const failures = h()
        .logs()
        .filter((l) => l.event === 'auth.login.failed');
      assert.deepEqual(
        failures.map((l) => [l.reason, l.userId]),
        [
          ['wrong_password', user.id],
          ['unknown_email', null],
        ],
      );
      assert.ok(!h().rawLogs().includes('hunter2-wrong-guess'));
      assert.ok(!h().rawLogs().includes('ghost@example.test'));
    });

    await t.test('malformed bodies are rejected before any lookup (400)', async () => {
      for (const body of [
        { email: 'a@example.test' },
        { password: PASSWORD },
        // Not `email: 42`: Fastify's Ajv coerces scalars, so that becomes "42".
        { email: { $ne: null }, password: PASSWORD },
        { email: '', password: PASSWORD },
        { email: 'a@example.test', password: 'x'.repeat(1025) },
      ]) {
        const res = await login(body);
        assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 60));
        assert.equal(res.json().error.code, 'VALIDATION_ERROR');
      }
    });

    await t.test(
      'per-account throttle: blocks after the budget, even the right password',
      async () => {
        const { user } = await seedUser(db.pool, { password: PASSWORD });
        for (let i = 0; i < LOGIN_MAX_FAILURES_PER_ACCOUNT; i += 1) {
          const res = await login(
            { email: user.email, password: 'wrong password!!' },
            { ip: `198.51.100.${20 + i}` },
          );
          assert.equal(res.statusCode, 401);
        }
        const res = await login({ email: user.email, password: PASSWORD }, { ip: '198.51.100.99' });
        assert.equal(res.statusCode, 429);
        assert.equal(res.json().error.code, 'TOO_MANY_REQUESTS');
        assert.ok(Number(res.headers['retry-after']) > 0);
        assert.equal(res.headers['set-cookie'], undefined);
      },
    );

    await t.test('per-account throttle treats unknown emails identically', async () => {
      for (let i = 0; i < LOGIN_MAX_FAILURES_PER_ACCOUNT; i += 1) {
        await login({ email: 'ghost@example.test', password: PASSWORD }, { ip: `198.51.100.${i}` });
      }
      const res = await login({ email: 'ghost@example.test', password: PASSWORD });
      assert.equal(res.statusCode, 429);
    });

    await t.test('success resets the account budget', async () => {
      const { user } = await seedUser(db.pool, { password: PASSWORD });
      for (let i = 0; i < LOGIN_MAX_FAILURES_PER_ACCOUNT - 1; i += 1) {
        await login({ email: user.email, password: 'wrong password!!' });
      }
      assert.equal((await login({ email: user.email, password: PASSWORD })).statusCode, 200);
      for (let i = 0; i < LOGIN_MAX_FAILURES_PER_ACCOUNT; i += 1) {
        const res = await login({ email: user.email, password: 'wrong password!!' });
        assert.equal(res.statusCode, 401);
      }
    });

    await t.test('per-IP throttle, which a spoofed X-Forwarded-For does not evade', async () => {
      for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IP; i += 1) {
        const res = await login(
          { email: `guess${i}@example.test`, password: PASSWORD },
          { ip: '192.0.2.50', headers: { 'x-forwarded-for': `203.0.113.${i}` } },
        );
        assert.equal(res.statusCode, 401);
      }
      const res = await login(
        { email: 'one-more@example.test', password: PASSWORD },
        { ip: '192.0.2.50', headers: { 'x-forwarded-for': '203.0.113.250' } },
      );
      assert.equal(res.statusCode, 429);
      // A different client is unaffected.
      const other = await login(
        { email: 'one-more@example.test', password: PASSWORD },
        { ip: '192.0.2.51' },
      );
      assert.equal(other.statusCode, 401);
    });

    await t.test('a session cookie the browser already had is destroyed (fixation)', async () => {
      const { user } = await seedUser(db.pool, { password: PASSWORD });
      const planted = await h().sessions.create({ userId: user.id, role: user.role });

      const res = await login(
        { email: user.email, password: PASSWORD },
        { headers: { cookie: `${COOKIE}=${planted.id}` } },
      );
      assert.equal(res.statusCode, 200);
      const issued = res.cookies.find((c) => c.name === COOKIE);
      assert.ok(issued && issued.value !== planted.id);
      assert.equal(await h().sessions.get(planted.id), null);
      assert.ok(await h().sessions.get(issued.value));
    });

    await t.test('a hash made with old cost parameters is upgraded on login', async () => {
      const weak = { memoryCost: 4096, timeCost: 1, parallelism: 1 };
      const { user } = await seedUser(db.pool, {
        passwordHash: await hashPassword(PASSWORD, weak),
      });
      assert.ok(needsRehash(user.password_hash ?? ''));

      assert.equal((await login({ email: user.email, password: PASSWORD })).statusCode, 200);

      const { rows } = await db.pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [user.id],
      );
      const upgraded = rows[0]?.password_hash ?? '';
      assert.notEqual(upgraded, user.password_hash);
      assert.equal(needsRehash(upgraded), false);
      assert.equal(await verifyPassword(upgraded, PASSWORD), true);
    });
  },
);
