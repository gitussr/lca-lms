import assert from 'node:assert/strict';
import test from 'node:test';

import { redactSensitive } from './logger.js';

test('redacts sensitive keys at the top level', () => {
  const result = redactSensitive({ email: 'a@example.com', password: 'hunter2' });
  assert.deepEqual(result, { email: 'a@example.com', password: '[REDACTED]' });
});

test('redacts sensitive keys at any nesting depth', () => {
  const result = redactSensitive({
    user: { credentials: { token: 'abc123', refreshToken: 'def456' } },
  });
  assert.deepEqual(result, {
    user: { credentials: { token: '[REDACTED]', refreshToken: '[REDACTED]' } },
  });
});

test('redacts sensitive keys inside arrays', () => {
  const result = redactSensitive({ users: [{ password: 'a' }, { password: 'b' }] });
  assert.deepEqual(result, { users: [{ password: '[REDACTED]' }, { password: '[REDACTED]' }] });
});

test('matches sensitive keys case-insensitively', () => {
  const result = redactSensitive({ Password: 'x', AUTHORIZATION: 'Bearer abc' });
  assert.deepEqual(result, { Password: '[REDACTED]', AUTHORIZATION: '[REDACTED]' });
});

test('leaves non-sensitive keys untouched', () => {
  const value = { id: '123', role: 'student', nested: { count: 2 } };
  assert.deepEqual(redactSensitive(value), value);
});

test('passes primitives through unchanged', () => {
  assert.equal(redactSensitive('hello'), 'hello');
  assert.equal(redactSensitive(42), 42);
  assert.equal(redactSensitive(null), null);
  assert.equal(redactSensitive(undefined), undefined);
});

test('passes Error instances through unredacted so the err serializer still works', () => {
  const err = new Error('boom');
  const result = redactSensitive({ err });
  assert.equal(result.err, err);
  assert.equal(result.err.message, 'boom');
});

test('redacts common header-style keys', () => {
  const result = redactSensitive({ headers: { authorization: 'Bearer x', cookie: 'sid=1' } });
  assert.deepEqual(result, { headers: { authorization: '[REDACTED]', cookie: '[REDACTED]' } });
});
