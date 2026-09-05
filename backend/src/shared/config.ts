/**
 * Minimal environment configuration.
 *
 * This is a deliberate shim. Feature F-004 replaces it with a schema-validated
 * loader that fails fast on missing/invalid variables. Until then, keep this
 * small and side-effect free.
 */

const nodeEnv = process.env.NODE_ENV ?? 'development';

function parsePort(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return n;
}

/**
 * Resolves and validates DATABASE_URL. Exported (not just used inline) so it can
 * be unit-tested without a real database or process.env mutation.
 *
 * - Production requires an explicit value — no default DB credentials in code.
 * - Development/test fall back to the local placeholder credentials documented
 *   in `.env.example` (not secrets; F-008 wires the same values into Docker Compose).
 * - Any provided value must parse as a `postgres(ql)://` URL, so a typo fails at
 *   boot instead of surfacing as a confusing connection error later.
 */
export function parseDatabaseUrl(raw: string | undefined, env: string): string {
  const value = raw?.trim();

  if (!value) {
    if (env === 'production') {
      throw new Error('DATABASE_URL is required in production');
    }
    return env === 'test'
      ? 'postgresql://lca_lms:lca_lms_dev@localhost:5432/lca_lms_test'
      : 'postgresql://lca_lms:lca_lms_dev@localhost:5432/lca_lms_dev';
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid DATABASE_URL: not a valid URL`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`Invalid DATABASE_URL: unsupported protocol "${parsed.protocol}"`);
  }
  return value;
}

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  host: process.env.HOST ?? '0.0.0.0',
  port: parsePort(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
  databaseUrl: parseDatabaseUrl(process.env.DATABASE_URL, nodeEnv),
} as const;

export type AppConfig = typeof config;
