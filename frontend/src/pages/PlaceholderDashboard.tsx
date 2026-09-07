import type { JSX } from 'react';

export interface PlaceholderDashboardProps {
  area: string;
}

/**
 * Stand-in landing page for each role area. Real dashboards arrive in
 * F-1101 / F-1102 / F-1103; this exists so every route in the skeleton
 * renders something and the layout shells are visible.
 */
export function PlaceholderDashboard({ area }: PlaceholderDashboardProps): JSX.Element {
  return (
    <section className="lca-placeholder">
      <h1>{area} dashboard</h1>
      <p className="lca-muted">
        This area is scaffolded but has no features yet. Screens will be added here as the backlog
        progresses.
      </p>
    </section>
  );
}
