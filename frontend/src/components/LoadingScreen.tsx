import type { JSX } from 'react';
import { Spinner } from './Spinner.js';

export interface LoadingScreenProps {
  message?: string;
}

/** Full-viewport loading state — used while the session resolves and for route-level suspense. */
export function LoadingScreen({ message = 'Loading…' }: LoadingScreenProps): JSX.Element {
  return (
    <div className="lca-centered-screen">
      <Spinner size={32} />
      <p className="lca-muted" aria-hidden="true">
        {message}
      </p>
    </div>
  );
}
