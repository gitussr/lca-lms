/** Small helpers shared by the database CLI scripts (`migrate.ts`, `seed-admin.ts`). */

/** Strip the password from a connection string before it reaches a log line. */
export function redactUrl(url: string): string {
  return url.replace(/:[^:@/]*@/, ':***@');
}

/**
 * One-line description of an error. `pg` surfaces a refused connection as an
 * `AggregateError` with an empty message, so fall back to its inner errors or
 * its `code`.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.message) return err.message;
  if (err instanceof AggregateError && err.errors.length > 0) {
    return err.errors.map(describeError).join('; ');
  }
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : err.name;
}
