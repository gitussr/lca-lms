import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Baseline migration for F-003 (Database foundation).
 *
 * Creates the shared `set_updated_at()` trigger function. Every table that has
 * an `updated_at` column attaches this trigger instead of relying on
 * application code to keep the timestamp honest — see `backend/src/db/README.md`
 * for the full column/table conventions.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createFunction(
    'set_updated_at',
    [],
    {
      returns: 'trigger',
      language: 'plpgsql',
      replace: true,
    },
    `
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    `,
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropFunction('set_updated_at', []);
}
