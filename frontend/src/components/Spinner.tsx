import type { JSX } from 'react';

export interface SpinnerProps {
  /** Accessible label announced to screen readers. */
  label?: string;
  size?: number;
}

/** Indeterminate loading indicator. */
export function Spinner({ label = 'Loading', size = 24 }: SpinnerProps): JSX.Element {
  return (
    <span
      className="lca-spinner"
      role="status"
      aria-live="polite"
      style={{ width: size, height: size }}
    >
      <span className="lca-spinner__ring" aria-hidden="true" />
      <span className="lca-visually-hidden">{label}</span>
    </span>
  );
}
