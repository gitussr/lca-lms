/**
 * The authenticated caller attached to every request as `request.user`.
 *
 * F-002 only declares the shape and defaults it to `null`. Feature F-105
 * (session middleware) populates it from the session store, and F-106 adds the
 * role guards that read it.
 */

export type UserRole = 'admin' | 'teacher' | 'student';
export type UserStatus = 'active' | 'inactive' | 'pending';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  status: UserStatus;
}
