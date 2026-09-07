import type { JSX } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';

export interface NavItem {
  to: string;
  label: string;
  /** `end` matches the path exactly (used for index routes). */
  end?: boolean;
}

export interface AppShellProps {
  /** Role name shown in the header, e.g. "Student". */
  area: string;
  /** Primary navigation. Empty for now — features add their own links. */
  nav?: NavItem[];
}

/**
 * Common frame for every authenticated area: a header with the area name and
 * the signed-in user, a (currently empty) primary nav, and an <Outlet> for the
 * page. Individual features (dashboards, course lists, …) plug into `nav`.
 */
export function AppShell({ area, nav = [] }: AppShellProps): JSX.Element {
  const { user, logout } = useAuth();

  return (
    <div className="lca-shell">
      <header className="lca-shell__header">
        <div className="lca-shell__brand">
          <strong>LCA LMS</strong>
          <span className="lca-shell__area">{area}</span>
        </div>
        <div className="lca-shell__account">
          {user ? (
            <>
              <span className="lca-muted">{user.displayName ?? user.email ?? user.id}</span>
              <button
                type="button"
                className="lca-button lca-button--ghost"
                onClick={() => void logout()}
              >
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </header>

      {nav.length > 0 ? (
        <nav className="lca-shell__nav" aria-label={`${area} navigation`}>
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="lca-shell__navlink">
              {item.label}
            </NavLink>
          ))}
        </nav>
      ) : null}

      <main className="lca-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
