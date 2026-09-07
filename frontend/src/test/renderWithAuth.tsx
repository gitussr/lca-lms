import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, type AuthContextValue } from '../auth/auth-context.js';
import type { CurrentUser } from '../auth/types.js';

/** Build an auth context value for tests without standing up the real provider. */
export function fakeAuth(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    status: 'unauthenticated',
    user: null,
    refresh: async () => {},
    logout: async () => {},
    ...overrides,
  };
}

export function authedAs(user: Partial<CurrentUser> & Pick<CurrentUser, 'role'>): AuthContextValue {
  return fakeAuth({
    status: 'authenticated',
    user: { id: 'u-test', status: 'active', ...user },
  });
}

interface Options {
  auth?: AuthContextValue;
  route?: string;
}

/** Render `ui` inside a MemoryRouter and a fixed AuthContext. */
export function renderWithAuth(ui: ReactElement, options: Options = {}): RenderResult {
  const auth = options.auth ?? fakeAuth();
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>{children}</MemoryRouter>
    </AuthContext.Provider>
  );
  return render(ui, { wrapper });
}
