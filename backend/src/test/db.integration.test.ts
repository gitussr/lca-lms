import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestDatabase, isServerReachable, maintenanceUrl, redactUrl } from './db.js';

/**
 * Proves `.reset()` — the fast, between-tests cleanup path — actually
 * truncates data. No domain tables exist yet (the first lands with F-101),
 * so this exercises the mechanism generically against a table it creates
 * itself; once real tables exist, `.reset()` needs no changes to cover them
 * too (it truncates everything in `public` except `schema_migrations`).
 */

const reachable = await isServerReachable();
const redactedUrl = redactUrl(maintenanceUrl());

test(
  'TestDatabase.reset() truncates application tables between tests',
  { skip: reachable ? false : `no Postgres reachable at ${redactedUrl}` },
  async (t) => {
    const db = await createTestDatabase();
    t.after(() => db.drop());

    await db.pool.query('CREATE TABLE widgets (id serial primary key, name text not null)');
    t.after(() => db.pool.query('DROP TABLE IF EXISTS widgets'));

    await db.pool.query("INSERT INTO widgets (name) VALUES ('a'), ('b')");
    const before = await db.pool.query('SELECT count(*)::int AS count FROM widgets');
    assert.equal(before.rows[0]?.count, 2);

    await db.reset();

    const after = await db.pool.query('SELECT count(*)::int AS count FROM widgets');
    assert.equal(after.rows[0]?.count, 0, 'expected widgets to be empty after reset()');

    const migrations = await db.pool.query('SELECT count(*)::int AS count FROM schema_migrations');
    assert.ok(
      (migrations.rows[0]?.count ?? 0) > 0,
      'reset() must not touch the migrations tracking table itself',
    );
  },
);
