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
} as const;

export type AppConfig = typeof config;
