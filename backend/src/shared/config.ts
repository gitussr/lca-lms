/**
 * Central, schema-validated environment configuration (F-004).
 *
 * `buildConfig()` is the pure, unit-testable core: it validates `process.env`
 * (or any env-shaped object) against a schema and either returns a typed
 * `AppConfig` or throws a `ConfigError` listing every problem found — never
 * just the first one, and never the raw value of a variable (so a bad secret
 * can't end up in a thrown error message or a log line, Master Prompt §19 Q10).
 *
 * The module's default export, `config`, is what the rest of the app imports.
 * It calls `buildConfig(process.env)` and, on failure, prints the aggregated
 * error and exits — "the app refuses to start with missing/invalid required
 * config" has to be a real, unrecoverable boot failure, not a thrown
 * exception some caller could catch and ignore.
 */
import { z } from 'zod';

const NODE_ENVS = ['development', 'test', 'staging', 'production'] as const;
export type NodeEnvName = (typeof NODE_ENVS)[number];

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  nodeEnv: NodeEnvName;
  isDevelopment: boolean;
  isTest: boolean;
  isStaging: boolean;
  isProduction: boolean;
  host: string;
  port: number;
  logLevel: LogLevel;
  corsOrigin: string[];
  databaseUrl: string;
}

export class ConfigError extends Error {
  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Loosely-typed shape + defaults for the variables every profile shares.
 * Cross-field and per-profile rules (below) decide what's actually required.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1).optional(),
});

// Local placeholder credentials — not secrets, documented in `.env.example`.
// F-008's Docker Compose setup provisions a database matching these.
const DEV_DATABASE_URL = 'postgresql://lca_lms:lca_lms_dev@localhost:5432/lca_lms_dev';
const TEST_DATABASE_URL = 'postgresql://lca_lms:lca_lms_dev@localhost:5432/lca_lms_test';

function validateDatabaseUrl(value: string, issues: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    issues.push('DATABASE_URL: not a valid URL');
    return;
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    issues.push(
      `DATABASE_URL: unsupported protocol "${parsed.protocol}" (expected postgres:// or postgresql://)`,
    );
  }
}

/**
 * Validates `env` against the schema and applies the profile-specific rules
 * that make development/test/staging/production genuinely distinct (§33):
 * staging and production get no database or CORS defaults — both must be
 * supplied explicitly, and the well-known local placeholder DB is rejected
 * even if a real value happens to match it.
 */
export function buildConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const { NODE_ENV: nodeEnv, HOST: host, PORT: port, LOG_LEVEL: logLevel } = parsed.data;

  const isDevelopment = nodeEnv === 'development';
  const isTest = nodeEnv === 'test';
  const isStaging = nodeEnv === 'staging';
  const isProduction = nodeEnv === 'production';
  const strict = isStaging || isProduction;

  const issues: string[] = [];

  let databaseUrl = parsed.data.DATABASE_URL?.trim();
  if (!databaseUrl) {
    if (strict) {
      issues.push(`DATABASE_URL: required in ${nodeEnv}`);
    } else {
      databaseUrl = isTest ? TEST_DATABASE_URL : DEV_DATABASE_URL;
    }
  } else {
    validateDatabaseUrl(databaseUrl, issues);
    if (strict && (databaseUrl === DEV_DATABASE_URL || databaseUrl === TEST_DATABASE_URL)) {
      issues.push(`DATABASE_URL: the local development placeholder must not be used in ${nodeEnv}`);
    }
  }

  if (strict && !env.CORS_ORIGIN?.trim()) {
    issues.push(
      `CORS_ORIGIN: required in ${nodeEnv} (no localhost default outside development/test)`,
    );
  }
  const corsOrigin = parsed.data.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (corsOrigin.length === 0) {
    issues.push('CORS_ORIGIN: must list at least one allowed origin');
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  return {
    nodeEnv,
    isDevelopment,
    isTest,
    isStaging,
    isProduction,
    host,
    port,
    logLevel,
    corsOrigin,
    // Non-null: every path above either sets it or throws.
    databaseUrl: databaseUrl as string,
  };
}

function loadConfigOrExit(): AppConfig {
  try {
    return buildConfig(process.env);
  } catch (err) {
    const message =
      err instanceof ConfigError ? err.message : `Failed to load configuration: ${String(err)}`;
    console.error(message);
    process.exit(1);
  }
}

export const config = loadConfigOrExit();
