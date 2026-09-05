import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../app.js';
import { actAs, fakeAuthenticatedUser } from './auth.js';

test('a fresh app has no authenticated user by default', async (t) => {
  const app = await buildApp();
  app.get('/__whoami', (request) => ({ user: request.user }));
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/__whoami' });
  assert.deepEqual(res.json(), { user: null });
});

test('actAs() makes every request behave as the given user', async (t) => {
  const app = await buildApp();
  app.get('/__whoami', (request) => ({ user: request.user }));
  actAs(app, fakeAuthenticatedUser('teacher'));
  t.after(() => app.close());

  const first = await app.inject({ method: 'GET', url: '/__whoami' });
  const second = await app.inject({ method: 'GET', url: '/__whoami' });

  const firstUser = (first.json() as { user: { role: string; status: string; id: string } }).user;
  const secondUser = (second.json() as { user: { id: string } }).user;
  assert.equal(firstUser.role, 'teacher');
  assert.equal(firstUser.status, 'active');
  assert.equal(secondUser.id, firstUser.id, 'the same fake user is reused across requests');
});

test('actAs(app, null) explicitly simulates an unauthenticated caller', async (t) => {
  const app = await buildApp();
  app.get('/__whoami', (request) => ({ user: request.user }));
  actAs(app, null);
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/__whoami' });
  assert.deepEqual(res.json(), { user: null });
});

test('fakeAuthenticatedUser generates an obviously-fake, unique id per call', () => {
  const a = fakeAuthenticatedUser('student');
  const b = fakeAuthenticatedUser('student');
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^00000000-0000-4000-a000-\d{12}$/);
});

test('fakeAuthenticatedUser accepts overrides', () => {
  const user = fakeAuthenticatedUser('admin', { status: 'inactive' });
  assert.equal(user.role, 'admin');
  assert.equal(user.status, 'inactive');
});
