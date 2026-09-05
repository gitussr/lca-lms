/**
 * Shared Postgres connection pool. One pool per process; modules import
 * `getPool()` rather than constructing their own `pg.Pool`.
 *
 * TLS is controlled entirely via `DATABASE_URL` (e.g. `?sslmode=require`) —
 * no separate ssl config here until a hosting decision requires one.
 */
import { Pool } from 'pg';

import { config } from '../shared/config.js';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const created = new Pool({
      connectionString: config.databaseUrl,
      max: config.isTest ? 5 : 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // An idle client can emit 'error' after a network blip; without a listener
    // that crashes the process (unhandled 'error' event on an EventEmitter).
    // Structured logging replaces this console call in F-005.
    created.on('error', (err) => {
      console.error('Unexpected error on idle Postgres client', err);
    });
    pool = created;
  }
  return pool;
}

/** Closes the pool and clears the singleton. Safe to call when never created. */
export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}
