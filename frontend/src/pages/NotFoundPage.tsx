import type { JSX } from 'react';
import { Link } from 'react-router-dom';

export function NotFoundPage(): JSX.Element {
  return (
    <div className="lca-centered-screen">
      <div className="lca-card">
        <h1>Page not found</h1>
        <p className="lca-muted">The page you were looking for does not exist.</p>
        <Link to="/" className="lca-button">
          Go home
        </Link>
      </div>
    </div>
  );
}
