/**
 * Apply or roll back migrations against `config.databaseUrl` (F-008).
 *
 *   npm run db:migrate:up     # apply every pending migration
 *   npm run db:migrate:down   # roll back the most recent migration
 *
 * A thin wrapper over node-pg-migrate's `runner` so migrations resolve the
 * database exactly like the app does (F-004): an explicit `DATABASE_URL`
 * (from the environment or `backend/.env`) wins, otherwise development/test
 * fall back to the local placeholder that `infra/docker-compose.yml`
 * provisions. The bare `node-pg-migrate` CLI has no such fallback and fails
 * with no `DATABASE_URL` set.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runner } from 'node-pg-migrate';

import { describeError, redactUrl } from './cli.js';
import { config } from '../shared/config.js';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);
export const MIGRATIONS_TABLE = 'schema_migrations';

export function parseDirection(arg: string | undefined): 'up' | 'down' {
  if (arg === undefined || arg === 'up') return 'up';
  if (arg === 'down') return 'down';
  throw new Error(`unknown direction "${arg}" (expected "up" or "down")`);
}

async function main(): Promise<void> {
  try {
    const direction = parseDirection(process.argv[2]);
    console.log(`Migrating ${direction} on ${redactUrl(config.databaseUrl)}`);
    const applied = await runner({
      databaseUrl: config.databaseUrl,
      dir: MIGRATIONS_DIR,
      migrationsTable: MIGRATIONS_TABLE,
      direction,
      count: direction === 'up' ? Infinity : 1,
      // Quiet: failures are reported once, below, without a stack dump.
      logger: { info: () => {}, warn: console.warn, error: () => {} },
    });
    console.log(
      applied.length === 0
        ? 'No migrations to run.'
        : applied.map((m) => `  ${direction === 'up' ? '+' : '-'} ${m.name}`).join('\n'),
    );
  } catch (err) {
    console.error(
      `Migration failed: ${describeError(err)}\n` + 'Is Postgres running? (npm run services:up)',
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
