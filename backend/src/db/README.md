# backend/src/db/

Database foundation (F-003): connection pool + migration conventions. No domain
tables yet — the first schema (`users`, profiles) lands with F-101.

## Connecting

`getPool()` (`pool.ts`) returns a process-wide singleton `pg.Pool` built from
`config.databaseUrl` (`shared/config.ts`). Import it wherever a query is needed
rather than constructing a new `Pool`:

```ts
import { getPool } from '../../db/pool.js';

const { rows } = await getPool().query('SELECT 1');
```

`closePool()` ends the pool; called from `server.ts` during graceful shutdown.

`DATABASE_URL` is read from the environment. If unset, development/test fall
back to the local placeholder credentials below (not secrets); production has
no default and refuses to boot without an explicit value.

## Migrations

Tool: [`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/) (peer of
`pg`, already a project dependency). Migration files live in `backend/migrations/`,
written in TypeScript, and are tracked in a `schema_migrations` table (not the
tool's default `pgmigrations`, to keep the table name self-explanatory).

```bash
# from backend/
npm run db:migrate:create <name>   # scaffold a new migration
npm run db:migrate:up              # apply pending migrations
npm run db:migrate:down            # roll back the most recent migration
```

All commands read `DATABASE_URL` from the environment (see `.env.example`).
Local Postgres is not yet automated — F-008 adds `docker compose up` for it.

## Conventions

Every core table follows these rules unless a migration documents why not:

- **Primary key:** `id uuid primary key default gen_random_uuid()`.
  `gen_random_uuid()` is built into Postgres 13+ core — no extension needed.
- **Naming:** snake_case for tables and columns.
- **Timestamps:** `created_at timestamptz not null default now()`,
  `updated_at timestamptz not null default now()`, both kept in sync by a
  `BEFORE UPDATE` trigger calling the shared `set_updated_at()` function
  (created in the baseline migration):

  ```sql
  CREATE TRIGGER <table>_set_updated_at
    BEFORE UPDATE ON <table>
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  ```

- **Soft delete:** `deleted_at timestamptz` (nullable) on every core academic
  entity per architecture decision D7 — rows are archived, not `DELETE`d.
  `audit_events` is the one append-only exception (no `deleted_at`).
- **Integrity in the database:** foreign keys, `UNIQUE`, and `NOT NULL`
  constraints enforce invariants the application must not be trusted to
  enforce alone (Master Prompt §18).

## Test harness

`pool.integration.test.ts` proves the pool + migration runner work end-to-end:
it creates a uniquely-named, disposable database on the target Postgres
*server*, runs the migrations up, asserts `schema_migrations` and
`set_updated_at()` exist, rolls all the way back down, then drops the
database. It self-skips (with a logged reason) when no server is reachable at
`DATABASE_URL`, so `npm test` stays green on a machine without Postgres
running. F-006 builds the full per-test reset harness (truncate-between-tests,
seeded fixtures, authenticated request helpers) on top of this.

`pool.test.ts` covers the `getPool()`/`closePool()` singleton lifecycle
directly — `pg.Pool` doesn't connect until the first query, so this needs no
database at all.

## Production hardening (not yet built)

- **Least-privilege DB user:** the app should connect as a role that can only
  read/write application tables — not run `CREATE`/`DROP DATABASE` or own the
  schema. Migrations should run as a separate, more-privileged role. Deferred
  until a hosting/ops decision exists to configure it against; noted here as
  the target so it isn't forgotten.
