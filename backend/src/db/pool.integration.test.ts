import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestDatabase, isServerReachable, maintenanceUrl, redactUrl } from '../test/db.js';

/**
 * Proves the migration runner works end-to-end against a real, disposable
 * Postgres database: create it, migrate up, assert the shared trigger
 * function and `schema_migrations` record exist, migrate all the way back
 * down, then drop the database.
 *
 * F-003 does not automate a local Postgres *server* (F-008's Docker Compose
 * setup does that) — this suite self-skips, with a logged reason, when no
 * server is reachable at `DATABASE_URL`, so `npm test` stays green on a
 * machine without Postgres running while still exercising the real thing
 * wherever a server is available (a developer's local Postgres, or CI once
 * F-009 provisions one).
 */

const reachable = await isServerReachable();
const redactedUrl = redactUrl(maintenanceUrl());

test(
  'database integration (disposable database + migrations)',
  { skip: reachable ? false : `no Postgres reachable at ${redactedUrl}` },
  async (t) => {
    const db = await createTestDatabase();
    t.after(() => db.drop());

    await t.test(
      'migrate up creates schema_migrations and the shared trigger function',
      async () => {
        const migrations = await db.pool.query('SELECT name FROM schema_migrations');
        assert.ok((migrations.rowCount ?? 0) > 0, 'expected at least one applied migration record');

        const fn = await db.pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'`);
        assert.equal(fn.rowCount, 1, 'expected set_updated_at() to exist after migrate up');
      },
    );

    await t.test('migrate down removes the trigger function', async () => {
      await db.migrateDown();

      const fn = await db.pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'`);
      assert.equal(fn.rowCount, 0, 'expected set_updated_at() to be gone after migrate down');

      const migrations = await db.pool.query('SELECT name FROM schema_migrations');
      assert.equal(
        migrations.rowCount,
        0,
        'expected no applied migration records after full rollback',
      );

      // Restore for anything that runs after this test in the same database.
      await db.migrateUp();
    });
  },
);
