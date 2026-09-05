/**
 * Structured JSON logging (F-005).
 *
 * `loggerOptions` is what `app.ts` passes to Fastify to build its Pino
 * logger: level from config, plus a `logMethod` hook that recursively
 * redacts sensitive field names out of every log line before it's
 * serialized — regardless of how deeply the value is nested.
 *
 * Redaction here is defense-in-depth, not the primary safeguard. Application
 * code must never pass a raw password, token, or session secret to the
 * logger in the first place (Master Prompt §19 Q10, §32). One exception:
 * `Error` instances are passed through unredacted so Pino's `err` serializer
 * (configured by Fastify) can still extract `message`/`stack`/`type` — a
 * custom error subclass must not carry a secret on one of its own fields.
 */
import type { LoggerOptions } from 'pino';

import { config } from './config.js';

const SENSITIVE_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'passwordconfirmation',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'sessionid',
  'secret',
  'apikey',
  'authorization',
  'cookie',
  'setcookie',
]);

const REDACTED = '[REDACTED]';
const MAX_REDACT_DEPTH = 8;

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return value;
  if (depth > MAX_REDACT_DEPTH) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redactValue(val, depth + 1);
  }
  return output;
}

/** Exported so the redaction logic is unit-testable without a real logger. */
export function redactSensitive<T>(value: T): T {
  return redactValue(value, 0) as T;
}

export const loggerOptions: LoggerOptions = {
  level: config.logLevel,
  hooks: {
    logMethod(args, method) {
      const redacted = args.map((arg) =>
        typeof arg === 'object' && arg !== null ? redactSensitive(arg) : arg,
      );
      method.apply(this, redacted as Parameters<typeof method>);
    },
  },
};
