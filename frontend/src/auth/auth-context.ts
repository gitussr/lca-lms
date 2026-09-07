import { createContext } from 'react';
import type { CurrentUser } from './types.js';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUser | null;
  /** Re-fetch `/me` — call after a successful login. */
  refresh: () => Promise<void>;
  /** End the session server-side (F-104) and clear local state. */
  logout: () => Promise<void>;
}

/**
 * Exported so tests can wrap components in a `<AuthContext.Provider>` with a
 * fixed value instead of standing up the real provider + fetch mock.
 * Application code should use the `useAuth` hook.
 */
export const AuthContext = createContext<AuthContextValue | null>(null);
