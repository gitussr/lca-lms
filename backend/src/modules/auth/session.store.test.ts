import assert from 'node:assert/strict';
import test from 'node:test';

import {
  newSessionData,
  newSessionId,
  SESSION_ABSOLUTE_LIFETIME_SECONDS,
  sessionKey,
} from './session.store.js';

/** F-103: session ID generation and storage keys (D2). */

test('session IDs are 256-bit, URL-safe, and unique', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => newSessionId()));
  assert.equal(ids.size, 1000);
  for (const id of ids) {
    assert.match(id, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(id, 'base64url').length, 32);
  }
});

test('the storage key is a hash, never the session ID itself', () => {
  const id = newSessionId();
  const key = sessionKey(id);
  assert.match(key, /^session:[0-9a-f]{64}$/);
  assert.ok(!key.includes(id));
  assert.equal(sessionKey(id), key);
});

test('new sessions record the D2 absolute lifetime', () => {
  const now = new Date('2026-10-24T00:00:00.000Z');
  const data = newSessionData({ userId: 'u1', role: 'student' }, now);
  assert.equal(data.userId, 'u1');
  assert.equal(data.role, 'student');
  assert.equal(data.createdAt, now.toISOString());
  assert.equal(data.lastSeenAt, now.toISOString());
  assert.equal(
    Date.parse(data.absoluteExpiresAt) - now.getTime(),
    SESSION_ABSOLUTE_LIFETIME_SECONDS * 1000,
  );
});
