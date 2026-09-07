import { useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { ErrorState } from '../components/ErrorState.js';
import { Spinner } from '../components/Spinner.js';
import { useAuth } from '../auth/useAuth.js';
import { homePathForRole } from '../auth/types.js';

interface LocationState {
  from?: { pathname?: string };
}

/**
 * Public sign-in screen.
 *
 * The form posts to `POST /api/v1/auth/login` through the shared API client.
 * That endpoint arrives in F-103; until then a submit surfaces the backend's
 * error via the shared <ErrorState>, which is exactly the behaviour we want to
 * exercise here. Already-authenticated visitors are redirected to their home.
 */
export function LoginPage(): JSX.Element {
  const { status, user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (status === 'authenticated' && user) {
    const target =
      (location.state as LocationState | null)?.from?.pathname ?? homePathForRole(user.role);
    return <Navigate to={target} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/login', { email, password });
      await refresh();
      navigate(homePathForRole(user?.role ?? 'student'), { replace: true });
    } catch (err) {
      // Wrong credentials come back as a 401 ApiError; anything else is shown as-is.
      setError(
        err instanceof ApiError && err.isUnauthorized
          ? new ApiError(401, err.code, 'Incorrect email or password.', {
              requestId: err.requestId,
            })
          : err,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lca-centered-screen">
      <div className="lca-card lca-login">
        <h1 className="lca-login__title">Sign in to LCA LMS</h1>
        <p className="lca-muted">Accounts are created by an administrator.</p>

        <form className="lca-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <label className="lca-field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="lca-field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error ? <ErrorState error={error} title="Could not sign in" /> : null}

          <button type="submit" className="lca-button" disabled={submitting}>
            {submitting ? <Spinner label="Signing in" size={16} /> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
