import { Component } from 'react';
import type { ErrorInfo, JSX, ReactNode } from 'react';
import { ErrorState } from './ErrorState.js';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: unknown, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: unknown;
}

/** Catches render-time crashes in the subtree so one bad screen never blanks the whole app. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // F-32xx (frontend observability) will forward this to the backend.
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error !== null) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return (
        <div className="lca-centered-screen">
          <ErrorState error={this.state.error} onRetry={this.reset} />
        </div>
      );
    }
    return this.props.children as JSX.Element;
  }
}
