/**
 * User & role model (F-101).
 *
 * The `users` table (migration `*_users-and-profiles.ts`) is the single source
 * of truth for identity and role. The constants below mirror its CHECK
 * constraints — the database stays the authority; these exist so application
 * code and tests share one vocabulary with it.
 */

export const ROLES = ['admin', 'teacher', 'student'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'inactive', 'pending'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value);
}

/** A `users` row exactly as the database returns it. Never send this to a client. */
export interface UserRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string | null;
  role: Role;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/** The only user shape that may leave the backend. */
export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Serializes a user for an API response.
 *
 * Built field-by-field from an allow-list — never by spreading the row and
 * deleting fields — so a column added to `users` later (or `password_hash`
 * itself) can't reach a client unless someone adds it here on purpose
 * (invariant 6, §19 Q3).
 */
export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Canonical form for storing and looking up an email. Uniqueness is enforced
 * case-insensitively by the database regardless; normalizing on the way in
 * keeps stored values consistent and lets lookups hit `lower(email)` exactly.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
