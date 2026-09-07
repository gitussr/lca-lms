import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from './auth-context.js';
import { ProtectedRoute } from './ProtectedRoute.js';
import { authedAs, fakeAuth } from '../test/renderWithAuth.js';
import type { AuthContextValue } from './auth-context.js';

function renderAt(path: string, auth: AuthContextValue) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>Login screen</div>} />
          <Route path="/teacher" element={<div>Teacher home</div>} />
          <Route element={<ProtectedRoute allow={['student']} />}>
            <Route path="/" element={<div>Student area</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('ProtectedRoute', () => {
  it('shows a loader while the session is resolving', () => {
    renderAt('/', fakeAuth({ status: 'loading' }));
    expect(screen.getByText(/checking your session/i)).toBeInTheDocument();
  });

  it('redirects an unauthenticated visitor to /login (authorization failure)', () => {
    renderAt('/', fakeAuth({ status: 'unauthenticated' }));
    expect(screen.getByText('Login screen')).toBeInTheDocument();
    expect(screen.queryByText('Student area')).not.toBeInTheDocument();
  });

  it('redirects a wrong-role user to their own home instead of looping', () => {
    renderAt('/', authedAs({ role: 'teacher' }));
    expect(screen.getByText('Teacher home')).toBeInTheDocument();
    expect(screen.queryByText('Student area')).not.toBeInTheDocument();
  });

  it('renders the nested route for an allowed role', () => {
    renderAt('/', authedAs({ role: 'student' }));
    expect(screen.getByText('Student area')).toBeInTheDocument();
  });
});
