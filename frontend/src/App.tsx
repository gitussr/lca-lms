import type { JSX } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { AppRoutes } from './AppRoutes.js';

/** Application root: error boundary → router → auth context → routes. */
export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
