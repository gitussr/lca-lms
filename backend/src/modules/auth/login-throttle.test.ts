import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCounterStore } from '../../test/memory-stores.js';
import {
  LOGIN_MAX_FAILURES_PER_ACCOUNT,
  LOGIN_MAX_FAILURES_PER_IP,
  LOGIN_THROTTLE_WINDOW_SECONDS,
  LoginThrottle,
  type CounterStore,
} from './login-throttle.js';

/** F-103: per-account and per-IP login throttling, against an in-memory counter store. */

function setup() {
  let now = 1_000_000;
  const counters = new MemoryCounterStore(() => now);
  return {
    throttle: new LoginThrottle(counters),
    advance: (seconds: number) => {
      now += seconds * 1000;
    },
  };
}

async function consumeTimes(
  throttle: LoginThrottle,
  times: number,
  ip: (i: number) => string,
  email: (i: number) => string,
) {
  const results = [];
  for (let i = 0; i < times; i += 1) results.push(await throttle.consume(ip(i), email(i)));
  return results;
}

test('allows the per-account failure budget, then blocks with a Retry-After', async () => {
  const { throttle } = setup();
  const results = await consumeTimes(
    throttle,
    LOGIN_MAX_FAILURES_PER_ACCOUNT + 1,
    (i) => `10.0.0.${i}`,
    () => 'a@example.test',
  );
  assert.ok(results.slice(0, -1).every((r) => r.allowed));
  const last = results.at(-1);
  assert.equal(last?.allowed, false);
  assert.ok(last && !last.allowed && last.retryAfterSeconds > 0);
  assert.ok(last && !last.allowed && last.retryAfterSeconds <= LOGIN_THROTTLE_WINDOW_SECONDS);
});

test('the account limit is independent of IP, the IP limit independent of account', async () => {
  const { throttle } = setup();
  await consumeTimes(
    throttle,
    LOGIN_MAX_FAILURES_PER_ACCOUNT,
    () => '10.0.0.1',
    () => 'a@x.test',
  );
  assert.equal((await throttle.consume('10.0.0.1', 'b@x.test')).allowed, true);

  const ipResults = await consumeTimes(
    throttle,
    LOGIN_MAX_FAILURES_PER_IP,
    () => '10.0.0.2',
    (i) => `user${i}@x.test`,
  );
  assert.ok(ipResults.every((r) => r.allowed));
  assert.equal((await throttle.consume('10.0.0.2', 'fresh@x.test')).allowed, false);
});

test('a successful login forgives the account and refunds the IP attempt', async () => {
  const { throttle } = setup();
  await consumeTimes(
    throttle,
    LOGIN_MAX_FAILURES_PER_ACCOUNT - 1,
    () => '10.0.0.1',
    () => 'a@x.test',
  );
  await throttle.consume('10.0.0.1', 'a@x.test');
  await throttle.recordSuccess('10.0.0.1', 'a@x.test');

  const after = await consumeTimes(
    throttle,
    LOGIN_MAX_FAILURES_PER_ACCOUNT,
    () => '10.0.0.1',
    () => 'a@x.test',
  );
  assert.ok(after.every((r) => r.allowed));
});

test('successful logins from one IP never use up its budget (classroom NAT)', async () => {
  const { throttle } = setup();
  for (let i = 0; i < LOGIN_MAX_FAILURES_PER_IP * 2; i += 1) {
    const email = `student${i}@x.test`;
    assert.equal((await throttle.consume('203.0.113.7', email)).allowed, true);
    await throttle.recordSuccess('203.0.113.7', email);
  }
});

test('the window expires', async () => {
  const { throttle, advance } = setup();
  await consumeTimes(
    throttle,
    LOGIN_MAX_FAILURES_PER_ACCOUNT + 1,
    () => '10.0.0.1',
    () => 'a@x.test',
  );
  assert.equal((await throttle.consume('10.0.0.1', 'a@x.test')).allowed, false);
  advance(LOGIN_THROTTLE_WINDOW_SECONDS);
  assert.equal((await throttle.consume('10.0.0.1', 'a@x.test')).allowed, true);
});

test('counter keys never contain the email address', async () => {
  const keys: string[] = [];
  const recording: CounterStore = {
    increment: async (key) => {
      keys.push(key);
      return { count: 1, ttlSeconds: 60 };
    },
    decrement: async (key) => {
      keys.push(key);
    },
    delete: async (key) => {
      keys.push(key);
    },
  };
  const throttle = new LoginThrottle(recording);
  await throttle.consume('10.0.0.1', 'secret.person@x.test');
  await throttle.recordSuccess('10.0.0.1', 'secret.person@x.test');
  assert.ok(keys.length > 0);
  assert.ok(keys.every((key) => !key.includes('secret.person')));
});
