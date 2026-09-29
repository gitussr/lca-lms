/**
 * Seed the first administrator account (F-008).
 *
 *   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=… npm run db:seed:admin
 *   # or
 *   npm run db:seed:admin -- --email admin@example.com --password '…' [--name 'Jane Admin']
 *
 * Credentials come only from the environment or CLI flags — never hardcoded,
 * never written to a log line (Master Prompt §33, §19 Q10). The password value
 * is not echoed even in error messages.
 *
 * D1: there is no public self-registration — every account, including the very
 * first admin, is provisioned out of band. This script is that mechanism.
 *
 * The password must pass the F-102 policy and is stored only as an argon2id
 * hash. Idempotent: if any account already uses the email, nothing is changed
 * — the script never resets an existing password or promotes an existing user.
 */
import { pathToFileURL } from 'node:url';

import { Client } from 'pg';

import { describeError, redactUrl } from './cli.js';
import { hashPassword, validatePasswordPolicy } from '../modules/auth/password.js';
import { normalizeEmail } from '../modules/users/users.model.js';
import { config } from '../shared/config.js';

export const DEFAULT_ADMIN_NAME = 'Administrator';

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
  name?: string;
}

export interface SeedCredentials {
  email: string;
  password: string;
  name: string;
}

/**
 * Merge credentials from `--email` / `--password` / `--name` flags (highest
 * precedence) and `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME`
 * env vars. `argv` is the
 * arguments after the script name (i.e. `process.argv.slice(2)`).
 */
export function resolveSeedCredentials(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
): RawSeedCredentials {
  const fromEnv: RawSeedCredentials = {
    email: env.SEED_ADMIN_EMAIL?.trim() || undefined,
    password: env.SEED_ADMIN_PASSWORD || undefined,
    name: env.SEED_ADMIN_NAME?.trim() || undefined,
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
    else if (arg === '--name' || arg?.startsWith('--name=')) fromFlags.name = takeValue()?.trim();
  }

  return {
    email: fromFlags.email || fromEnv.email,
    password: fromFlags.password ?? fromEnv.password,
    name: fromFlags.name || fromEnv.name,
  };
}

/**
 * Validate presence + shape, and the password against the F-102 policy (with
 * the email and name as context). Never includes the password value in an issue.
 */
export function validateSeedCredentials(raw: RawSeedCredentials): SeedCredentials {
  const issues: string[] = [];

  const email = raw.email?.trim() ?? '';
  if (!email) {
    issues.push('email is required (SEED_ADMIN_EMAIL or --email)');
  } else if (!EMAIL_RE.test(email)) {
    issues.push(`email "${email}" is not a valid address`);
  }

  const name = raw.name?.trim() || DEFAULT_ADMIN_NAME;
  if (name.length > 200) issues.push('name must be at most 200 characters');

  const password = raw.password ?? '';
  if (!password) {
    issues.push('password is required (SEED_ADMIN_PASSWORD or --password)');
  } else {
    issues.push(...validatePasswordPolicy(password, { email, fullName: name }));
  }

  if (issues.length > 0) throw new SeedError(issues);
  return { email: normalizeEmail(email), password, name };
}

export type SeedOutcome =
  | { status: 'pending-schema' }
  | { status: 'created'; email: string; id: string }
  | { status: 'exists'; email: string; role: string };

/** True once the `users` table exists (F-101). */
async function usersTableExists(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ reg: string | null }>(
    `SELECT to_regclass('public.users') AS reg`,
  );
  return rows[0]?.reg != null;
}

/**
 * Insert the admin row, or report the existing account if the email is taken.
 *
 * `ON CONFLICT (lower(email))` targets the `users_email_lower_key` expression
 * index (F-101), so a differently-cased duplicate is caught too. An existing
 * account is never modified.
 */
async function writeAdmin(client: Client, creds: SeedCredentials): Promise<SeedOutcome> {
  const passwordHash = await hashPassword(creds.password);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (email, full_name, password_hash, role, status)
     VALUES ($1, $2, $3, 'admin', 'active')
     ON CONFLICT (lower(email)) DO NOTHING
     RETURNING id`,
    [creds.email, creds.name, passwordHash],
  );
  const created = inserted.rows[0];
  if (created) return { status: 'created', email: creds.email, id: created.id };

  const existing = await client.query<{ role: string }>(
    'SELECT role FROM users WHERE lower(email) = $1',
    [creds.email],
  );
  return { status: 'exists', email: creds.email, role: existing.rows[0]?.role ?? 'unknown' };
}

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
        console.log(
          `An account with email ${outcome.email} already exists (role: ${outcome.role}) — nothing changed.`,
        );
        break;
      case 'pending-schema':
        console.log(
          'Credentials look good and the database is reachable, but the `users` table does not\n' +
            'exist yet. Run `npm run db:migrate` first.',
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
