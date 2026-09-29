import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ADMIN_NAME,
  resolveSeedCredentials,
  SeedError,
  seedAdmin,
  validateSeedCredentials,
} from './seed-admin.js';
import { PASSWORD_MIN_LENGTH, verifyPassword } from '../modules/auth/password.js';
import { createTestDatabase, isServerReachable, maintenanceUrl, redactUrl } from '../test/db.js';
import { seedUser } from '../test/seed.js';

// Test-only fixture value, not a real credential.
const GOOD_PASSWORD = 'plum orbit lantern 42';

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

test('resolveSeedCredentials reads the name from env or --name', () => {
  const env = { SEED_ADMIN_NAME: ' Env Name ' } as NodeJS.ProcessEnv;
  assert.equal(resolveSeedCredentials(env, []).name, 'Env Name');
  assert.equal(resolveSeedCredentials(env, ['--name', 'Flag Name']).name, 'Flag Name');
  assert.equal(resolveSeedCredentials({} as NodeJS.ProcessEnv, []).name, undefined);
});

test('validateSeedCredentials normalizes the email, defaults the name, passes a good password', () => {
  const creds = validateSeedCredentials({ email: 'Admin@Example.com', password: GOOD_PASSWORD });
  assert.deepEqual(creds, {
    email: 'admin@example.com',
    password: GOOD_PASSWORD,
    name: DEFAULT_ADMIN_NAME,
  });
});

test('validateSeedCredentials applies the F-102 password policy with email/name context', () => {
  assert.throws(
    () => validateSeedCredentials({ email: 'a@example.com', password: 'password1234' }),
    /password is too common/,
  );
  assert.throws(
    () =>
      validateSeedCredentials({
        email: 'priya@example.com',
        password: 'priya-has-a-long-password',
      }),
    /must not contain your email address or name/,
  );
});

test('validateSeedCredentials aggregates every problem', () => {
  try {
    validateSeedCredentials({ email: 'not-an-email', password: 'short' });
    assert.fail('expected a SeedError');
  } catch (err) {
    assert.ok(err instanceof SeedError);
    assert.match(err.message, /not a valid address/);
    assert.match(err.message, new RegExp(`at least ${PASSWORD_MIN_LENGTH} characters`));
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

// --- Integration: seeding against a real Postgres ------------------------------

const reachable = await isServerReachable();

test(
  'seedAdmin against a real database',
  { skip: reachable ? false : `no Postgres reachable at ${redactUrl(maintenanceUrl())}` },
  async (t) => {
    const db = await createTestDatabase();
    t.after(() => db.drop());

    const { Client } = await import('pg');
    const run = (email = 'admin@example.com', password = GOOD_PASSWORD) =>
      seedAdmin({
        env: { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password } as NodeJS.ProcessEnv,
        argv: ['--name', 'First Admin'],
        createClient: () => new Client({ connectionString: db.url }),
      });

    await t.test('creates an active admin whose stored hash verifies', async () => {
      const outcome = await run();
      assert.equal(outcome.status, 'created');

      const { rows } = await db.pool.query(
        'SELECT email, full_name, role, status, password_hash FROM users',
      );
      assert.equal(rows.length, 1);
      const [admin] = rows;
      assert.equal(admin.email, 'admin@example.com');
      assert.equal(admin.full_name, 'First Admin');
      assert.equal(admin.role, 'admin');
      assert.equal(admin.status, 'active');
      assert.match(admin.password_hash, /^\$argon2id\$/);
      assert.ok(!admin.password_hash.includes(GOOD_PASSWORD));
      assert.equal(await verifyPassword(admin.password_hash, GOOD_PASSWORD), true);
    });

    await t.test('is idempotent: a second run (any email case) changes nothing', async () => {
      const before = await db.pool.query('SELECT password_hash, updated_at FROM users');

      assert.deepEqual(await run('ADMIN@Example.com', 'a different long passphrase'), {
        status: 'exists',
        email: 'admin@example.com',
        role: 'admin',
      });

      const after = await db.pool.query('SELECT password_hash, updated_at FROM users');
      assert.deepEqual(after.rows, before.rows, 'existing admin untouched');
    });

    await t.test('never promotes or alters an existing non-admin account', async () => {
      const { user } = await seedUser(db.pool, { role: 'student', email: 'taken@example.com' });

      const outcome = await run('taken@example.com');
      assert.deepEqual(outcome, { status: 'exists', email: 'taken@example.com', role: 'student' });

      const { rows } = await db.pool.query('SELECT role, password_hash FROM users WHERE id = $1', [
        user.id,
      ]);
      assert.equal(rows[0].role, 'student');
      assert.equal(rows[0].password_hash, user.password_hash);
    });

    await t.test('reports pending-schema on an un-migrated database', async () => {
      await db.migrateDown();
      assert.deepEqual(await run('other@example.com'), { status: 'pending-schema' });
    });
  },
);
