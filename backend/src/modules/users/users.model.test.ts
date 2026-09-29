import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRole,
  isUserStatus,
  normalizeEmail,
  ROLES,
  toPublicUser,
  USER_STATUSES,
  type UserRow,
} from './users.model.js';

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'student@example.com',
    full_name: 'Test Student',
    password_hash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA',
    role: 'student',
    status: 'active',
    created_at: new Date('2026-09-29T10:00:00.000Z'),
    updated_at: new Date('2026-09-29T11:00:00.000Z'),
    deleted_at: null,
    ...overrides,
  };
}

test('toPublicUser never includes password_hash, in any form', () => {
  const out = toPublicUser(row());
  const json = JSON.stringify(out);

  assert.ok(!('password_hash' in out));
  assert.ok(!('passwordHash' in out));
  assert.doesNotMatch(json, /argon2id/, 'hash value must not appear anywhere in the output');
});

test('toPublicUser is an allow-list: unknown extra columns do not pass through', () => {
  const withExtra = { ...row(), mfa_secret: 'TOPSECRET' } as UserRow;
  assert.doesNotMatch(JSON.stringify(toPublicUser(withExtra)), /TOPSECRET/);
});

test('toPublicUser maps the safe fields to camelCase with ISO timestamps', () => {
  assert.deepEqual(toPublicUser(row()), {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'student@example.com',
    fullName: 'Test Student',
    role: 'student',
    status: 'active',
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T11:00:00.000Z',
  });
});

test('isRole accepts exactly the three MVP roles', () => {
  assert.deepEqual([...ROLES], ['admin', 'teacher', 'student']);
  for (const role of ROLES) assert.ok(isRole(role));
  for (const bad of ['Admin', 'superadmin', '', null, undefined, 1]) assert.ok(!isRole(bad));
});

test('isUserStatus accepts exactly active / inactive / pending', () => {
  assert.deepEqual([...USER_STATUSES], ['active', 'inactive', 'pending']);
  for (const status of USER_STATUSES) assert.ok(isUserStatus(status));
  for (const bad of ['ACTIVE', 'deleted', '', null]) assert.ok(!isUserStatus(bad));
});

test('normalizeEmail trims and lower-cases', () => {
  assert.equal(normalizeEmail('  Mixed.Case@Example.COM '), 'mixed.case@example.com');
});
