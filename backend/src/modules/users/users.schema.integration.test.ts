import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyPassword } from '../auth/password.js';
import { createTestDatabase, isServerReachable, maintenanceUrl, redactUrl } from '../../test/db.js';
import { FAKE_PASSWORD_HASH, seedUser } from '../../test/seed.js';

/**
 * F-101: the `users` / `student_profiles` / `teacher_profiles` schema enforces
 * its own integrity rules. Each case asserts the specific Postgres error code
 * (and constraint where useful), so a test can't pass because some *other*
 * constraint happened to reject the row.
 */

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FK_VIOLATION = '23503';
const NOT_NULL_VIOLATION = '23502';

interface PgError {
  code?: string;
  constraint?: string;
}

function pgError(code: string, constraint?: string) {
  return (err: PgError): boolean => {
    assert.equal(err.code, code, `expected SQLSTATE ${code}, got ${String(err.code)}`);
    if (constraint) assert.equal(err.constraint, constraint);
    return true;
  };
}

const reachable = await isServerReachable();

test(
  'users & profiles schema (F-101)',
  { skip: reachable ? false : `no Postgres reachable at ${redactUrl(maintenanceUrl())}` },
  async (t) => {
    const db = await createTestDatabase();
    t.after(() => db.drop());
    const q = (sql: string, params: unknown[] = []) => db.pool.query(sql, params);

    t.beforeEach(() => db.reset());

    await t.test('seedUser creates an active student with a linked profile', async () => {
      const { user, profileId } = await seedUser(db.pool);
      assert.equal(user.role, 'student');
      assert.equal(user.status, 'active');
      assert.ok(profileId);

      const profile = await q('SELECT user_id FROM student_profiles WHERE id = $1', [profileId]);
      assert.equal(profile.rows[0]?.user_id, user.id);
    });

    await t.test('new users default to pending and get uuid + timestamps', async () => {
      const { rows } = await q(
        `INSERT INTO users (email, full_name, role) VALUES ('p@example.test', 'P', 'admin')
         RETURNING id, status, created_at, updated_at, deleted_at`,
      );
      const row = rows[0];
      assert.match(row.id, /^[0-9a-f-]{36}$/);
      assert.equal(row.status, 'pending');
      assert.ok(row.created_at instanceof Date);
      assert.equal(row.deleted_at, null);
    });

    await t.test('email is unique case-insensitively', async () => {
      await seedUser(db.pool, { email: 'dup@example.test' });
      await assert.rejects(
        seedUser(db.pool, { email: 'DUP@Example.TEST' }),
        pgError(UNIQUE_VIOLATION, 'users_email_lower_key'),
      );
    });

    await t.test('email stays taken after the owner is soft-deleted', async () => {
      await seedUser(db.pool, { email: 'gone@example.test', deletedAt: new Date() });
      await assert.rejects(
        seedUser(db.pool, { email: 'gone@example.test' }),
        pgError(UNIQUE_VIOLATION, 'users_email_lower_key'),
      );
    });

    await t.test('malformed or padded emails are rejected', async () => {
      for (const email of ['no-at-sign', '@example.test', ' pad@example.test', '']) {
        await assert.rejects(
          seedUser(db.pool, { email }),
          pgError(CHECK_VIOLATION, 'users_email_format_check'),
          `expected ${JSON.stringify(email)} to be rejected`,
        );
      }
    });

    await t.test('a user cannot exist without a role', async () => {
      await assert.rejects(
        q(`INSERT INTO users (email, full_name) VALUES ('r@example.test', 'R')`),
        pgError(NOT_NULL_VIOLATION),
      );
    });

    await t.test('role and status only accept known values', async () => {
      await assert.rejects(
        q(
          `INSERT INTO users (email, full_name, role) VALUES ('x@example.test', 'X', 'superadmin')`,
        ),
        pgError(CHECK_VIOLATION, 'users_role_check'),
      );
      await assert.rejects(
        q(
          `INSERT INTO users (email, full_name, role, status)
           VALUES ('y@example.test', 'Y', 'student', 'banned')`,
        ),
        pgError(CHECK_VIOLATION, 'users_status_check'),
      );
    });

    await t.test('an active user must have a password hash; a pending one may not', async () => {
      await assert.rejects(
        seedUser(db.pool, { status: 'active', passwordHash: null }),
        pgError(CHECK_VIOLATION, 'users_active_requires_password_check'),
      );
      const { user } = await seedUser(db.pool, { status: 'pending' });
      assert.equal(user.password_hash, null);

      await assert.rejects(
        q(`UPDATE users SET status = 'active' WHERE id = $1`, [user.id]),
        pgError(CHECK_VIOLATION, 'users_active_requires_password_check'),
      );
    });

    await t.test('a student profile cannot link to a teacher (and vice versa)', async () => {
      const { user: teacher } = await seedUser(db.pool, { role: 'teacher' });
      const { user: student } = await seedUser(db.pool, { role: 'student' });
      const { user: admin } = await seedUser(db.pool, { role: 'admin' });

      await assert.rejects(
        q('INSERT INTO student_profiles (user_id) VALUES ($1)', [teacher.id]),
        pgError(FK_VIOLATION, 'student_profiles_user_fkey'),
      );
      await assert.rejects(
        q('INSERT INTO teacher_profiles (user_id) VALUES ($1)', [student.id]),
        pgError(FK_VIOLATION, 'teacher_profiles_user_fkey'),
      );
      await assert.rejects(
        q('INSERT INTO teacher_profiles (user_id) VALUES ($1)', [admin.id]),
        pgError(FK_VIOLATION, 'teacher_profiles_user_fkey'),
      );
      // The profile's role column can't be pointed elsewhere either.
      await assert.rejects(
        q(`INSERT INTO student_profiles (user_id, role) VALUES ($1, 'teacher')`, [teacher.id]),
        pgError(CHECK_VIOLATION),
      );
    });

    await t.test('profiles are 1:1 with their user', async () => {
      const { user } = await seedUser(db.pool, { role: 'student' });
      await assert.rejects(
        q('INSERT INTO student_profiles (user_id) VALUES ($1)', [user.id]),
        pgError(UNIQUE_VIOLATION, 'student_profiles_user_id_key'),
      );
    });

    await t.test('a profile cannot reference a user that does not exist', async () => {
      await assert.rejects(
        q('INSERT INTO student_profiles (user_id) VALUES (gen_random_uuid())'),
        pgError(FK_VIOLATION, 'student_profiles_user_fkey'),
      );
    });

    await t.test("a user's role cannot change while a role profile exists", async () => {
      const { user } = await seedUser(db.pool, { role: 'student' });
      await assert.rejects(
        q(`UPDATE users SET role = 'admin' WHERE id = $1`, [user.id]),
        pgError(FK_VIOLATION, 'student_profiles_user_fkey'),
      );
    });

    await t.test('a user with a profile cannot be hard-deleted', async () => {
      const { user } = await seedUser(db.pool, { role: 'teacher' });
      await assert.rejects(
        q('DELETE FROM users WHERE id = $1', [user.id]),
        pgError(FK_VIOLATION, 'teacher_profiles_user_fkey'),
      );
    });

    await t.test('updated_at is maintained by the trigger', async () => {
      const { user } = await seedUser(db.pool, { role: 'admin' });
      await q(`UPDATE users SET updated_at = '2000-01-01' WHERE id = $1`, [user.id]);
      const { rows } = await q('SELECT updated_at FROM users WHERE id = $1', [user.id]);
      assert.ok(rows[0].updated_at > new Date('2020-01-01'), 'trigger overwrites updated_at');
    });

    await t.test('seedUser rolls back the user when the profile insert fails', async () => {
      await assert.rejects(seedUser(db.pool, { role: 'student', phone: 'x'.repeat(40) }));
      const { rows } = await q('SELECT count(*)::int AS n FROM users');
      assert.equal(rows[0].n, 0, 'no orphan user left behind');
    });

    await t.test('seedUser({ password }) stores a real, verifiable argon2id hash', async () => {
      const { user } = await seedUser(db.pool, { password: 'fixture passphrase 1' });
      assert.match(user.password_hash ?? '', /^\$argon2id\$/);
      assert.equal(await verifyPassword(user.password_hash, 'fixture passphrase 1'), true);
    });

    await t.test('password_hash cannot be an empty string', async () => {
      await assert.rejects(
        seedUser(db.pool, { passwordHash: '' }),
        pgError(CHECK_VIOLATION, 'users_password_hash_nonempty_check'),
      );
      assert.ok(FAKE_PASSWORD_HASH.length > 0);
    });

    await t.test('migration rolls back cleanly and re-applies', async () => {
      await db.migrateDown();
      const { rows } = await q(
        `SELECT count(*)::int AS n FROM pg_tables
         WHERE schemaname = 'public'
           AND tablename IN ('users', 'student_profiles', 'teacher_profiles')`,
      );
      assert.equal(rows[0].n, 0);
      await db.migrateUp();
    });
  },
);
