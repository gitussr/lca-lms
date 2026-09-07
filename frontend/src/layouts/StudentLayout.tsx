import type { JSX } from 'react';
import { AppShell } from './AppShell.js';

/** Layout shell for the student area. Nav is intentionally empty until features land. */
export function StudentLayout(): JSX.Element {
  return <AppShell area="Student" nav={[]} />;
}
