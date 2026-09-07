import type { JSX } from 'react';
import { ApiError, NetworkError } from '../api/client.js';

export interface ErrorStateProps {
  /** The caught error, or a ready-made message. */
  error?: unknown;
  title?: string;
  /** When provided, renders a "Try again" button. */
  onRetry?: () => void;
}

/** Turn any thrown value into a short, user-safe sentence. */
export function messageForError(error: unknown): string {
  if (error instanceof NetworkError) {
    return 'We could not reach the server. Check your connection and try again.';
  }
  if (error instanceof ApiError) {
    if (error.isUnauthorized) return 'Your session has expired. Please sign in again.';
    if (error.isForbidden) return 'You do not have access to this.';
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Something went wrong.';
}

/** Inline error panel with an optional retry action and a correlation id for support. */
export function ErrorState({
  error,
  title = 'Something went wrong',
  onRetry,
}: ErrorStateProps): JSX.Element {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div className="lca-error-state" role="alert">
      <h2 className="lca-error-state__title">{title}</h2>
      <p className="lca-error-state__message">{messageForError(error)}</p>
      {requestId ? <p className="lca-error-state__ref">Reference: {requestId}</p> : null}
      {onRetry ? (
        <button type="button" className="lca-button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
