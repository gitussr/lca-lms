import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { api, ApiError } from '../api/client.js';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context.js';
import type { CurrentUser } from './types.js';

/** Response shape of `GET /api/v1/me` (F-107). */
interface MeResponse {
  user: CurrentUser;
}

/**
 * Resolves the current session once on mount by calling `/me`, and exposes
 * `refresh()` / `logout()` for the login and logout flows.
 *
 * Until F-107 ships, `/me` returns 404 and every visitor is treated as
 * unauthenticated — which is the correct default for a security-first app.
 * A 401 (no session) is likewise a normal, quiet "unauthenticated" result;
 * only unexpected failures are surfaced to the console.
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const mounted = useRef(true);

  const loadSession = useCallback(async () => {
    try {
      const { user: current } = await api.get<MeResponse>('/me');
      if (!mounted.current) return;
      setUser(current);
      setStatus('authenticated');
    } catch (error) {
      if (!mounted.current) return;
      setUser(null);
      setStatus('unauthenticated');
      const expected = error instanceof ApiError && (error.status === 401 || error.status === 404);
      if (!expected) {
        // Network failure or 5xx — the app still works logged-out, but this
        // is worth seeing in development.
        console.warn('Could not resolve session:', error);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadSession();
    return () => {
      mounted.current = false;
    };
  }, [loadSession]);

  const refresh = useCallback(async () => {
    setStatus('loading');
    await loadSession();
  }, [loadSession]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      // A failed logout call still clears client state; the session cookie is
      // cleared server-side on the next request that presents it, and F-104
      // will make this endpoint reliable.
      if (!(error instanceof ApiError)) console.warn('Logout request failed:', error);
    }
    if (!mounted.current) return;
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, refresh, logout }),
    [status, user, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
