import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIN_PASSWORD_LENGTH,
  resolveSeedCredentials,
  SeedError,
  seedAdmin,
  validateSeedCredentials,
} from './seed-admin.js';
import { createTestDatabase, isServerReachable, maintenanceUrl, redactUrl } from '../test/db.js';

const GOOD_PASSWORD = 'x'.repeat(MIN_PASSWORD_LENGTH);

test('resolveSeedCredentials reads env vars', () => {
  const raw = resolveSeedCredentials(
    {
      SEED_ADMIN_EMAIL: '  Admin@Example.com ',
      SEED_ADMIN_PASSWORD: GOOD_PASSWORD,
    } as NodeJS.ProcessEnv,
    [],
  );
  assert.equal(raw.email, 'Admin@Example.com');
  assert.equal(raw.password, GOOD_PASSWORD);
});

test('resolveSeedCredentials: flags override env, both --flag value and --flag=value', () => {
  const env = {
    SEED_ADMIN_EMAIL: 'env@example.com',
    SEED_ADMIN_PASSWORD: 'env-password-xxxx',
  } as NodeJS.ProcessEnv;

  const spaced = resolveSeedCredentials(env, [
    '--email',
    'flag@example.com',
    '--password',
    'flag-pw-123456',
  ]);
  assert.equal(spaced.email, 'flag@example.com');
  assert.equal(spaced.password, 'flag-pw-123456');

  const equals = resolveSeedCredentials(env, ['--email=flag2@example.com']);
  assert.equal(equals.email, 'flag2@example.com');
  assert.equal(equals.password, 'env-password-xxxx', 'falls back to env when the flag is absent');
});

test('validateSeedCredentials lower-cases the email and passes a good password', () => {
  const creds = validateSeedCredentials({ email: 'Admin@Example.com', password: GOOD_PASSWORD });
  assert.deepEqual(creds, { email: 'admin@example.com', password: GOOD_PASSWORD });
});

test('validateSeedCredentials aggregates every problem', () => {
  try {
    validateSeedCredentials({ email: 'not-an-email', password: 'short' });
    assert.fail('expected a SeedError');
  } catch (err) {
    assert.ok(err instanceof SeedError);
    assert.match(err.message, /not a valid address/);
    assert.match(err.message, new RegExp(`at least ${MIN_PASSWORD_LENGTH} characters`));
  }
});

test('validateSeedCredentials never puts the password value in the error', () => {
  const secret = 'super-secret-password-value';
  try {
    validateSeedCredentials({ email: '', password: secret.slice(0, 4) });
    assert.fail('expected a SeedError');
  } catch (err) {
    assert.ok(err instanceof SeedError);
    assert.doesNotMatch(err.message, /secr/i);
  }
});

test('validateSeedCredentials requires both fields', () => {
  assert.throws(() => validateSeedCredentials({}), /email is required[\s\S]*password is required/);
});

// --- Integration: the "schema not ready" path against a real Postgres ---------

const reachable = await isServerReachable();

test(
  'seedAdmin reports which prerequisite is missing (schema, then hashing)',
  { skip: reachable ? false : `no Postgres reachable at ${redactUrl(maintenanceUrl())}` },
  async (t) => {
    const db = await createTestDatabase();
    t.after(() => db.drop());

    const { Client } = await import('pg');
    const run = () =>
      seedAdmin({
        env: {
          SEED_ADMIN_EMAIL: 'admin@example.com',
          SEED_ADMIN_PASSWORD: GOOD_PASSWORD,
        } as NodeJS.ProcessEnv,
        argv: [],
        createClient: () => new Client({ connectionString: db.url }),
      });

    // Fully migrated: `users` exists (F-101), hashing doesn't yet (F-102).
    assert.deepEqual(await run(), { status: 'pending-hashing' });
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM users');
    assert.equal(rows[0]?.n, 0, 'no account is created before hashing exists');

    // Un-migrated database: no `users` table at all.
    await db.migrateDown();
    assert.deepEqual(await run(), { status: 'pending-schema' });
  },
);
