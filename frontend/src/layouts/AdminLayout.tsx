import type { JSX } from 'react';
import { AppShell } from './AppShell.js';

/** Layout shell for the admin area. Nav is intentionally empty until features land. */
export function AdminLayout(): JSX.Element {
  return <AppShell area="Admin" nav={[]} />;
}
