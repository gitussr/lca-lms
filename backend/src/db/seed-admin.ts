/**
 * Seed the first administrator account (F-008).
 *
 *   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=… npm run db:seed:admin
 *   # or
 *   npm run db:seed:admin -- --email admin@example.com --password '…'
 *
 * Credentials come only from the environment or CLI flags — never hardcoded,
 * never written to a log line (Master Prompt §33, §19 Q10). The password value
 * is not echoed even in error messages.
 *
 * D1: there is no public self-registration — every account, including the very
 * first admin, is provisioned out of band. This script is that mechanism.
 *
 * ── Current status ──────────────────────────────────────────────────────────
 * The `users` table exists since F-101; password hashing lands with F-102.
 * Everything up to the final INSERT is implemented and tested here now; the
 * insert itself is a documented TODO that lands with F-102 (see `writeAdmin`).
 * Run today, the script validates the credentials, connects, and reports
 * clearly which prerequisite is missing (`pending-schema` if migrations haven't
 * run, `pending-hashing` until F-102).
 */
import { pathToFileURL } from 'node:url';

import { Client } from 'pg';

import { describeError, redactUrl } from './cli.js';
import { config } from '../shared/config.js';

/** F-102 owns the real password policy; this is a conservative floor for seeding. */
export const MIN_PASSWORD_LENGTH = 12;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SeedError extends Error {
  constructor(issues: string[]) {
    super(
      issues.length === 1
        ? `Cannot seed admin: ${issues[0]}`
        : `Cannot seed admin:\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
    this.name = 'SeedError';
  }
}

export interface RawSeedCredentials {
  email?: string;
  password?: string;
}

export interface SeedCredentials {
  email: string;
  password: string;
}

/**
 * Merge credentials from `--email` / `--password` flags (highest precedence)
 * and `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` env vars. `argv` is the
 * arguments after the script name (i.e. `process.argv.slice(2)`).
 */
export function resolveSeedCredentials(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): RawSeedCredentials {
  const fromEnv: RawSeedCredentials = {
    email: env.SEED_ADMIN_EMAIL?.trim() || undefined,
    password: env.SEED_ADMIN_PASSWORD || undefined,
  };

  const fromFlags: RawSeedCredentials = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (): string | undefined => {
      const inline = arg?.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[++i];
      return inline;
    };
    if (arg === '--email' || arg?.startsWith('--email=')) fromFlags.email = takeValue()?.trim();
    else if (arg === '--password' || arg?.startsWith('--password='))
      fromFlags.password = takeValue();
  }

  return {
    email: fromFlags.email || fromEnv.email,
    password: fromFlags.password ?? fromEnv.password,
  };
}

/** Validate presence + shape. Never includes the password value in an issue. */
export function validateSeedCredentials(raw: RawSeedCredentials): SeedCredentials {
  const issues: string[] = [];

  const email = raw.email?.trim() ?? '';
  if (!email) {
    issues.push('email is required (SEED_ADMIN_EMAIL or --email)');
  } else if (!EMAIL_RE.test(email)) {
    issues.push(`email "${email}" is not a valid address`);
  }

  const password = raw.password ?? '';
  if (!password) {
    issues.push('password is required (SEED_ADMIN_PASSWORD or --password)');
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    issues.push(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  if (issues.length > 0) throw new SeedError(issues);
  return { email: email.toLowerCase(), password };
}

export type SeedOutcome =
  | { status: 'pending-schema' }
  | { status: 'pending-hashing' }
  | { status: 'created'; email: string }
  | { status: 'exists'; email: string };

/** True once the `users` table exists (F-101). */
async function usersTableExists(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ reg: string | null }>(
    `SELECT to_regclass('public.users') AS reg`,
  );
  return rows[0]?.reg != null;
}

/**
 * Insert (or no-op if already present) the admin row.
 *
 * TODO(F-102): hash `creds.password` with the shared password hasher and
 *   INSERT INTO users (email, full_name, password_hash, role, status)
 *   VALUES ($1, $2, $3, 'admin', 'active')
 *   ON CONFLICT (lower(email)) DO NOTHING
 * returning whether a row was created. The conflict target must be the
 * `lower(email)` expression — uniqueness is enforced by the
 * `users_email_lower_key` expression index, not a plain column constraint.
 * `full_name` is NOT NULL: take it from a new SEED_ADMIN_NAME / --name input
 * (default "Administrator"). Until F-102 there is no hasher, so this is
 * unreachable — `seedAdmin` returns `pending-hashing` before calling it.
 */
async function writeAdmin(_client: Client, _creds: SeedCredentials): Promise<SeedOutcome> {
  throw new Error('writeAdmin is not implemented until F-102 (password hashing)');
}

/** Set to true (and remove) by F-102, together with implementing `writeAdmin`. */
const PASSWORD_HASHING_AVAILABLE = false as boolean;

export interface SeedAdminDeps {
  env?: NodeJS.ProcessEnv;
  argv?: readonly string[];
  /** Override the connection for tests. */
  createClient?: () => Client;
}

export async function seedAdmin(deps: SeedAdminDeps = {}): Promise<SeedOutcome> {
  const env = deps.env ?? process.env;
  const argv = deps.argv ?? process.argv.slice(2);

  const creds = validateSeedCredentials(resolveSeedCredentials(env, argv));

  const client = deps.createClient
    ? deps.createClient()
    : new Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });

  try {
    await client.connect();
  } catch (err) {
    throw new SeedError([
      `could not connect to the database at ${redactUrl(config.databaseUrl)} — is it running? (npm run services:up)`,
      describeError(err),
    ]);
  }

  try {
    if (!(await usersTableExists(client))) {
      return { status: 'pending-schema' };
    }
    if (!PASSWORD_HASHING_AVAILABLE) {
      return { status: 'pending-hashing' };
    }
    return await writeAdmin(client, creds);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main(): Promise<void> {
  try {
    const outcome = await seedAdmin();
    switch (outcome.status) {
      case 'created':
        console.log(`Created admin ${outcome.email}.`);
        break;
      case 'exists':
        console.log(`Admin ${outcome.email} already exists — nothing to do.`);
        break;
      case 'pending-schema':
        console.log(
          'Credentials look good and the database is reachable, but the `users` table does not\n' +
            'exist yet. Run `npm run db:migrate` first.',
        );
        process.exitCode = 1;
        break;
      case 'pending-hashing':
        console.log(
          'Credentials look good and the `users` table exists, but admin seeding becomes\n' +
            'available once F-102 (password hashing) lands. No account was created.',
        );
        process.exitCode = 1;
        break;
    }
  } catch (err) {
    console.error(err instanceof SeedError ? err.message : `Unexpected error: ${String(err)}`);
    process.exitCode = 1;
  }
}

// Run only when invoked directly (not when imported by a test).
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  void main();
}
