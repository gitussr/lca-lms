import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * F-101 — User & Role data model.
 *
 * `users` is the single source of truth for identity and role (every person
 * has exactly one role). `student_profiles` / `teacher_profiles` hold
 * role-specific data, 1:1 with their user. Admins have no profile table.
 *
 * Integrity rules enforced here rather than trusted to application code
 * (Master Prompt §18):
 *
 * - Email is unique case-insensitively (`lower(email)` index), across all
 *   rows including soft-deleted ones — an archived account's email cannot be
 *   silently reused by a new account that would look like the old person.
 * - `role` and `status` are check-constrained text, not Postgres enums, so
 *   adding a value later is a plain constraint swap inside a transaction.
 * - `password_hash` is nullable because a `pending` user has not set a
 *   password yet (D1: admin provisions → set-password link, F-109), but an
 *   `active` user must have one.
 * - A profile can only point at a user of the matching role: the profile
 *   carries a constant `role` column and a composite FK to `users (id, role)`.
 *   The same FK blocks changing the role of a user who already has a profile.
 * - FKs are `ON DELETE RESTRICT`: users are soft-deleted (D7), never removed
 *   out from under their profile. Profiles follow their user's lifecycle and
 *   have no `deleted_at` of their own.
 */
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE users (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      email         text        NOT NULL,
      full_name     text        NOT NULL,
      password_hash text,
      role          text        NOT NULL,
      status        text        NOT NULL DEFAULT 'pending',
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      deleted_at    timestamptz,

      CONSTRAINT users_role_check
        CHECK (role IN ('admin', 'teacher', 'student')),
      CONSTRAINT users_status_check
        CHECK (status IN ('active', 'inactive', 'pending')),
      CONSTRAINT users_email_format_check
        CHECK (email = btrim(email) AND char_length(email) BETWEEN 3 AND 254
               AND position('@' IN email) > 1),
      CONSTRAINT users_full_name_check
        CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 200),
      CONSTRAINT users_password_hash_nonempty_check
        CHECK (password_hash IS NULL OR char_length(password_hash) > 0),
      CONSTRAINT users_active_requires_password_check
        CHECK (status <> 'active' OR password_hash IS NOT NULL),
      -- Target of the profiles' composite (user_id, role) foreign keys.
      CONSTRAINT users_id_role_key UNIQUE (id, role)
    );

    CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

    CREATE TRIGGER users_set_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();

    CREATE TABLE student_profiles (
      id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    uuid        NOT NULL UNIQUE,
      role       text        NOT NULL DEFAULT 'student' CHECK (role = 'student'),
      phone      text        CHECK (phone IS NULL OR char_length(phone) BETWEEN 1 AND 32),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT student_profiles_user_fkey
        FOREIGN KEY (user_id, role) REFERENCES users (id, role)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    );

    CREATE TRIGGER student_profiles_set_updated_at
      BEFORE UPDATE ON student_profiles
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();

    CREATE TABLE teacher_profiles (
      id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    uuid        NOT NULL UNIQUE,
      role       text        NOT NULL DEFAULT 'teacher' CHECK (role = 'teacher'),
      phone      text        CHECK (phone IS NULL OR char_length(phone) BETWEEN 1 AND 32),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT teacher_profiles_user_fkey
        FOREIGN KEY (user_id, role) REFERENCES users (id, role)
        ON UPDATE RESTRICT ON DELETE RESTRICT
    );

    CREATE TRIGGER teacher_profiles_set_updated_at
      BEFORE UPDATE ON teacher_profiles
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE teacher_profiles;
    DROP TABLE student_profiles;
    DROP TABLE users;
  `);
}
