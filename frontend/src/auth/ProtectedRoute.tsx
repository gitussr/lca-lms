import type { JSX } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoadingScreen } from '../components/LoadingScreen.js';
import { useAuth } from './useAuth.js';
import { homePathForRole, type UserRole } from './types.js';

export interface ProtectedRouteProps {
  /** If set, the authenticated user's role must be in this list. */
  allow?: UserRole[];
}

/**
 * Route guard for authenticated areas.
 *
 * - session still resolving  -> full-screen loader
 * - not authenticated        -> redirect to /login, remembering where we came from
 * - wrong role               -> redirect to that role's own home (no loop)
 * - allowed                  -> render the nested routes
 *
 * This is a UX convenience only. Every backend endpoint enforces its own
 * authentication and authorization (core invariant 7); a user who bypasses
 * this guard still gets 401/403 from the API.
 */
export function ProtectedRoute({ allow }: ProtectedRouteProps): JSX.Element {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <LoadingScreen message="Checking your session…" />;

  if (status === 'unauthenticated' || user === null) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allow && !allow.includes(user.role)) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }

  return <Outlet />;
}
