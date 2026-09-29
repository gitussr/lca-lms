/**
 * Domain fixture seeders for integration tests (deferred from F-006; each
 * lands with the schema it seeds). F-101 adds `seedUser()`; `seedCourse()` /
 * `seedEnrollment()` follow with their models.
 *
 * Seeders write straight to the tables — they are fixtures, not the
 * production creation path (that's F-201/F-202's admin endpoints).
 */
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

import { hashPassword } from '../modules/auth/password.js';
import type { Role, UserRow, UserStatus } from '../modules/users/users.model.js';

/**
 * Default stored hash when a test doesn't care about the password. Clearly not
 * a valid hash in any scheme, so it can never verify against anything — pass
 * `password` to get a real argon2id hash (slower) when a test needs to log in.
 */
export const FAKE_PASSWORD_HASH = 'test-fixture-not-a-real-hash';

export interface SeedUserOptions {
  role?: Role;
  status?: UserStatus;
  email?: string;
  fullName?: string;
  /** Real password to hash with argon2id; takes precedence over `passwordHash`. */
  password?: string;
  /** Defaults to FAKE_PASSWORD_HASH, or null for a `pending` user. */
  passwordHash?: string | null;
  deletedAt?: Date | null;
  /** Phone for the student/teacher profile. Ignored for admins. */
  phone?: string | null;
}

export interface SeededUser {
  user: UserRow;
  /** The student/teacher profile id, or null for an admin. */
  profileId: string | null;
}

const PROFILE_TABLE: Record<Role, string | null> = {
  admin: null,
  teacher: 'teacher_profiles',
  student: 'student_profiles',
};

/**
 * Inserts a user — plus the matching profile for a student or teacher — in
 * one transaction, mirroring how F-201/F-202 will create accounts atomically.
 * Defaults to an `active` student with a unique email.
 */
export async function seedUser(pool: Pool, options: SeedUserOptions = {}): Promise<SeededUser> {
  const role = options.role ?? 'student';
  const status = options.status ?? 'active';
  const email = options.email ?? `${role}-${randomBytes(4).toString('hex')}@example.test`;
  const fullName = options.fullName ?? `Test ${role}`;
  const passwordHash =
    options.password !== undefined
      ? await hashPassword(options.password)
      : options.passwordHash !== undefined
        ? options.passwordHash
        : status === 'pending'
          ? null
          : FAKE_PASSWORD_HASH;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<UserRow>(
      `INSERT INTO users (email, full_name, password_hash, role, status, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [email, fullName, passwordHash, role, status, options.deletedAt ?? null],
    );
    const user = rows[0];
    if (!user) throw new Error('seedUser: INSERT returned no row');

    let profileId: string | null = null;
    const table = PROFILE_TABLE[role];
    if (table) {
      // `table` comes from the fixed map above, never from input.
      const profile = await client.query<{ id: string }>(
        `INSERT INTO ${table} (user_id, phone) VALUES ($1, $2) RETURNING id`,
        [user.id, options.phone ?? null],
      );
      profileId = profile.rows[0]?.id ?? null;
    }

    await client.query('COMMIT');
    return { user, profileId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
