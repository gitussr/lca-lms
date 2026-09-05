import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runner } from 'node-pg-migrate';
import { Client, Pool } from 'pg';

import { config } from '../shared/config.js';

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

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

function withDatabaseName(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** `postgres` is the conventional maintenance DB every Postgres server has. */
function maintenanceUrl(baseUrl: string): string {
  return withDatabaseName(baseUrl, 'postgres');
}

async function isServerReachable(maintenanceDatabaseUrl: string): Promise<boolean> {
  const client = new Client({
    connectionString: maintenanceDatabaseUrl,
    connectionTimeoutMillis: 1000,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Not attacker-controlled: built entirely from local randomness, safe to inline into DDL. */
function randomDatabaseName(): string {
  return `lca_lms_test_${randomBytes(6).toString('hex')}`;
}

async function createDatabase(maintenanceDatabaseUrl: string, name: string): Promise<void> {
  const client = new Client({ connectionString: maintenanceDatabaseUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(maintenanceDatabaseUrl: string, name: string): Promise<void> {
  const client = new Client({ connectionString: maintenanceDatabaseUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

const maintenanceDatabaseUrl = maintenanceUrl(config.databaseUrl);
const reachable = await isServerReachable(maintenanceDatabaseUrl);
const redactedUrl = maintenanceDatabaseUrl.replace(/:[^:@/]*@/, ':***@');

test(
  'database integration (disposable database + migrations)',
  { skip: reachable ? false : `no Postgres reachable at ${redactedUrl}` },
  async (t) => {
    const databaseName = randomDatabaseName();
    const databaseUrl = withDatabaseName(config.databaseUrl, databaseName);

    await createDatabase(maintenanceDatabaseUrl, databaseName);
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });

    t.after(async () => {
      await pool.end();
      await dropDatabase(maintenanceDatabaseUrl, databaseName);
    });

    await t.test(
      'migrate up creates schema_migrations and the shared trigger function',
      async () => {
        await runner({
          databaseUrl,
          dir: migrationsDir,
          migrationsTable: 'schema_migrations',
          direction: 'up',
          logger: silentLogger,
        });

        const migrations = await pool.query('SELECT name FROM schema_migrations');
        assert.ok((migrations.rowCount ?? 0) > 0, 'expected at least one applied migration record');

        const fn = await pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'`);
        assert.equal(fn.rowCount, 1, 'expected set_updated_at() to exist after migrate up');
      },
    );

    await t.test('migrate down removes the trigger function', async () => {
      await runner({
        databaseUrl,
        dir: migrationsDir,
        migrationsTable: 'schema_migrations',
        direction: 'down',
        count: Infinity,
        logger: silentLogger,
      });

      const fn = await pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'`);
      assert.equal(fn.rowCount, 0, 'expected set_updated_at() to be gone after migrate down');

      const migrations = await pool.query('SELECT name FROM schema_migrations');
      assert.equal(
        migrations.rowCount,
        0,
        'expected no applied migration records after full rollback',
      );
    });
  },
);
