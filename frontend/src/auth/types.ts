/**
 * Client-side mirror of the authenticated caller. Kept in step with the
 * backend's `shared/auth-context.ts`. The frontend treats these as display
 * hints only — never as an authorization decision (core invariant 7).
 */

export type UserRole = 'admin' | 'teacher' | 'student';
export type UserStatus = 'active' | 'inactive' | 'pending';

export interface CurrentUser {
  id: string;
  role: UserRole;
  status: UserStatus;
  /** Optional profile fields the `/me` endpoint (F-107) may include. */
  email?: string;
  displayName?: string;
}

/** Landing route for a freshly authenticated user of each role. */
export function homePathForRole(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'teacher':
      return '/teacher';
    case 'student':
      return '/';
  }
}
