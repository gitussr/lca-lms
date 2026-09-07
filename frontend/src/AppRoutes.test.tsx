import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './AppRoutes.js';
import { AuthContext } from './auth/auth-context.js';
import { authedAs, fakeAuth } from './test/renderWithAuth.js';
import type { AuthContextValue } from './auth/auth-context.js';

function renderRoute(path: string, auth: AuthContextValue) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('AppRoutes', () => {
  it('serves /login publicly', () => {
    renderRoute('/login', fakeAuth());
    expect(screen.getByRole('heading', { name: /sign in to lca lms/i })).toBeInTheDocument();
  });

  it('gates the student area behind auth', () => {
    renderRoute('/', fakeAuth({ status: 'unauthenticated' }));
    expect(screen.getByRole('heading', { name: /sign in to lca lms/i })).toBeInTheDocument();
  });

  it('renders the student shell + dashboard for a student', () => {
    renderRoute('/', authedAs({ role: 'student' }));
    expect(screen.getByText('Student', { selector: '.lca-shell__area' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /student dashboard/i })).toBeInTheDocument();
  });

  it('keeps the admin area out of reach for a student', () => {
    renderRoute('/admin', authedAs({ role: 'student' }));
    expect(screen.queryByRole('heading', { name: /admin dashboard/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /student dashboard/i })).toBeInTheDocument();
  });

  it('shows the not-found page for an unknown path', () => {
    renderRoute('/does-not-exist', authedAs({ role: 'admin' }));
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });
});
