import assert from 'node:assert/strict';
import test from 'node:test';

import argon2 from 'argon2';

import {
  hashPassword,
  needsRehash,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePasswordPolicy,
  verifyPassword,
} from './password.js';
import { PASSWORD_HASH_FLOOR } from '../../shared/config.js';

// Deliberately cheap parameters so the suite stays fast; one test below
// exercises the real configured defaults.
const FAST = { memoryCost: 1024, timeCost: 1, parallelism: 1 };
const PASSWORD = 'correct horse battery staple';

test('hashPassword produces an argon2id PHC string with the given parameters', async () => {
  const hash = await hashPassword(PASSWORD, FAST);
  assert.match(hash, /^\$argon2id\$v=19\$/);
  assert.match(hash, /m=1024/);
  assert.match(hash, /t=1/);
  assert.match(hash, /p=1/);
  assert.ok(!hash.includes(PASSWORD));
});

test('hashPassword uses the configured (OWASP floor) parameters by default', async () => {
  const hash = await hashPassword(PASSWORD);
  assert.match(hash, new RegExp(`m=${PASSWORD_HASH_FLOOR.memoryCost}`));
  assert.equal(needsRehash(hash), false);
  assert.equal(await verifyPassword(hash, PASSWORD), true);
});

test('hashing the same password twice yields different hashes (random salt)', async () => {
  const [a, b] = await Promise.all([hashPassword(PASSWORD, FAST), hashPassword(PASSWORD, FAST)]);
  assert.notEqual(a, b);
});

test('verifyPassword accepts the right password and rejects wrong ones', async () => {
  const hash = await hashPassword(PASSWORD, FAST);
  assert.equal(await verifyPassword(hash, PASSWORD), true);
  assert.equal(await verifyPassword(hash, 'correct horse battery stapl'), false);
  assert.equal(await verifyPassword(hash, 'Correct horse battery staple'), false);
  assert.equal(await verifyPassword(hash, ''), false);
});

test('verifyPassword rejects a tampered hash instead of throwing', async () => {
  const hash = await hashPassword(PASSWORD, FAST);
  const parts = hash.split('$'); // ['', 'argon2id', 'v=19', params, salt, digest]
  const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);

  const tamperedDigest = [...parts.slice(0, 5), flip(parts[5] ?? '')].join('$');
  const tamperedSalt = [...parts.slice(0, 4), flip(parts[4] ?? ''), parts[5]].join('$');
  const truncated = hash.slice(0, -10);

  for (const bad of [tamperedDigest, tamperedSalt, truncated]) {
    assert.equal(await verifyPassword(bad, PASSWORD), false);
  }
});

test('verifyPassword refuses hashes that are not argon2id', async () => {
  const argon2i = await argon2.hash(PASSWORD, { type: argon2.argon2i, ...FAST });
  assert.equal(await verifyPassword(argon2i, PASSWORD), false);

  const bcryptLike = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO5nZ0V6Y5gB8i0H/7B3bO8Z2Bf6v7pXq';
  assert.equal(await verifyPassword(bcryptLike, PASSWORD), false);
});

test('verifyPassword refuses a stored hash demanding absurd cost (DoS guard)', async () => {
  const hash = await hashPassword(PASSWORD, FAST);
  const greedy = hash.replace('m=1024', 'm=99999999');
  const started = Date.now();
  assert.equal(await verifyPassword(greedy, PASSWORD), false);
  assert.ok(Date.now() - started < 500, 'rejected without attempting the hash');
});

test('verifyPassword fails closed on missing hashes and garbage', async () => {
  for (const hash of [
    null,
    undefined,
    '',
    'plaintext',
    '$argon2id$',
    '$argon2id$v=19$m=1,t=1$x$y',
  ]) {
    assert.equal(await verifyPassword(hash, PASSWORD), false);
  }
});

test('verifyPassword rejects oversized input without hashing it', async () => {
  const hash = await hashPassword(PASSWORD, FAST);
  assert.equal(await verifyPassword(hash, 'x'.repeat(10_000)), false);
});

test('passwords are Unicode-normalized (NFKC) before hashing', async () => {
  const composed = 'café au lait, s’il vous plaît';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed);

  const hash = await hashPassword(composed, FAST);
  assert.equal(await verifyPassword(hash, decomposed), true);
});

test('needsRehash detects hashes made with different parameters', async () => {
  const hash = await hashPassword(PASSWORD, FAST);
  assert.equal(needsRehash(hash, FAST), false);
  assert.equal(needsRehash(hash, { ...FAST, memoryCost: 2048 }), true);
  assert.equal(needsRehash(hash, { ...FAST, timeCost: 2 }), true);
  assert.equal(needsRehash('not-a-hash', FAST), true);
});

// ── Policy ────────────────────────────────────────────────────────────────────

test('policy accepts a long passphrase', () => {
  assert.deepEqual(validatePasswordPolicy(PASSWORD), []);
  assert.deepEqual(validatePasswordPolicy('x7!Qm#2pLr9@'), []);
});

test('policy enforces the length bounds, counting characters not bytes', () => {
  assert.deepEqual(validatePasswordPolicy('a1b2c3d4e5f'), [
    `password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  ]);
  assert.deepEqual(validatePasswordPolicy('x7!Q'.repeat(33)), [
    `password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  ]);
  // 12 emoji = 12 characters (24 UTF-16 units) — accepted.
  assert.deepEqual(validatePasswordPolicy('🔒🌟🚀🎯🧩🦉🍀🎲🛰️🪁🧭🎻'.normalize('NFKC')), []);
});

test('policy imposes no composition rules (NIST 800-63B)', () => {
  assert.deepEqual(validatePasswordPolicy('all lowercase words here'), []);
});

test('policy rejects common and repeated-character passwords', () => {
  assert.deepEqual(validatePasswordPolicy('Password1234'), ['password is too common']);
  assert.deepEqual(validatePasswordPolicy('aaaaaaaaaaaaaaaa'), [
    'password must not be a single repeated character',
  ]);
});

test('policy rejects whitespace-only and control characters', () => {
  assert.ok(
    validatePasswordPolicy(' '.repeat(16)).includes('password must not be only whitespace'),
  );
  assert.ok(
    validatePasswordPolicy('good length pass\u0000').includes(
      'password must not contain control characters',
    ),
  );
});

test('policy rejects passwords containing the email local part or name', () => {
  const context = { email: 'Asha.V@example.com', fullName: 'Asha Verma' };
  const issue = 'password must not contain your email address or name';
  assert.ok(validatePasswordPolicy('my asha.v secret phrase', context).includes(issue));
  assert.ok(validatePasswordPolicy('VERMA-is-my-family-name', context).includes(issue));
  assert.deepEqual(validatePasswordPolicy(PASSWORD, context), []);
});

test('policy issues never contain the password', () => {
  const secret = 'Sup3rSecret';
  const issues = validatePasswordPolicy(secret, { email: 'sup3rsecret@example.com' });
  assert.ok(issues.length > 0);
  for (const issue of issues) assert.ok(!issue.toLowerCase().includes('sup3r'));
});
