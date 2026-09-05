/**
 * Shared disposable-database test harness (F-006).
 *
 * `createTestDatabase()` creates a uniquely-named database on the configured
 * Postgres server and migrates it up once — a test file calls it in a `before`
 * hook, uses `.reset()` between individual tests (fast — truncates rather
 * than re-migrating), and `.drop()` in `after` to leave nothing behind.
 *
 * Every consumer must self-skip when no server is reachable, the way
 * `db/pool.integration.test.ts` does with `isServerReachable()` — F-006 does
 * not automate a local Postgres *server* (that's F-008's Docker Compose
 * setup), so `npm test` has to stay green on a machine without one running.
 */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runner } from 'node-pg-migrate';
import { Client, Pool } from 'pg';

import { config } from '../shared/config.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

export const MIGRATIONS_TABLE = 'schema_migrations';

function withDatabaseName(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/** `postgres` is the conventional maintenance DB every Postgres server has. */
export function maintenanceUrl(baseUrl: string = config.databaseUrl): string {
  return withDatabaseName(baseUrl, 'postgres');
}

/** Safe to print in a skip reason or log line — never includes credentials. */
export function redactUrl(url: string): string {
  return url.replace(/:[^:@/]*@/, ':***@');
}

export async function isServerReachable(
  maintenanceDatabaseUrl: string = maintenanceUrl(),
): Promise<boolean> {
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

export interface TestDatabase {
  name: string;
  url: string;
  pool: Pool;
  migrateUp(): Promise<void>;
  migrateDown(): Promise<void>;
  /** Truncates every application table (everything but the migrations table). */
  reset(): Promise<void>;
  /** Closes the pool and drops the database. */
  drop(): Promise<void>;
}

/** Creates a uniquely-named, already-migrated database ready for a test file to use. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = randomDatabaseName();
  const url = withDatabaseName(config.databaseUrl, name);

  const admin = new Client({ connectionString: maintenanceUrl() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ connectionString: url, max: 5 });

  const migrateUp = async (): Promise<void> => {
    await runner({
      databaseUrl: url,
      dir: migrationsDir,
      migrationsTable: MIGRATIONS_TABLE,
      direction: 'up',
      logger: silentLogger,
    });
  };

  const migrateDown = async (): Promise<void> => {
    await runner({
      databaseUrl: url,
      dir: migrationsDir,
      migrationsTable: MIGRATIONS_TABLE,
      direction: 'down',
      count: Infinity,
      logger: silentLogger,
    });
  };

  const reset = async (): Promise<void> => {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != $1`,
      [MIGRATIONS_TABLE],
    );
    if (rows.length === 0) return;
    const tableList = rows.map((row) => `"${row.tablename}"`).join(', ');
    await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
  };

  const drop = async (): Promise<void> => {
    await pool.end();
    const cleanup = new Client({ connectionString: maintenanceUrl() });
    await cleanup.connect();
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  };

  await migrateUp();

  return { name, url, pool, migrateUp, migrateDown, reset, drop };
}
