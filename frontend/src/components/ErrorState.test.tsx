import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorState, messageForError } from './ErrorState.js';
import { ApiError, NetworkError } from '../api/client.js';

describe('messageForError', () => {
  it('gives a friendly line for a network failure', () => {
    expect(messageForError(new NetworkError())).toMatch(/could not reach the server/i);
  });

  it('rewrites 401 as a session-expired message', () => {
    expect(messageForError(new ApiError(401, 'UNAUTHORIZED', 'Authentication required'))).toMatch(
      /session has expired/i,
    );
  });

  it('passes through a plain ApiError message (validation failure)', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed');
    expect(messageForError(err)).toBe('Request validation failed');
  });

  it('falls back to a generic sentence for unknown values', () => {
    expect(messageForError(null)).toBe('Something went wrong.');
  });
});

describe('<ErrorState>', () => {
  it('renders as an alert with the request id and a retry button', () => {
    let retried = 0;
    render(
      <ErrorState
        error={new ApiError(500, 'INTERNAL', 'Internal server error', { requestId: 'req-9' })}
        onRetry={() => {
          retried += 1;
        }}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Internal server error');
    expect(alert).toHaveTextContent('req-9');

    screen.getByRole('button', { name: /try again/i }).click();
    expect(retried).toBe(1);
  });
});
