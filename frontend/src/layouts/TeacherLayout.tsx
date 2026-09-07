import type { JSX } from 'react';
import { AppShell } from './AppShell.js';

/** Layout shell for the teacher area. Nav is intentionally empty until features land. */
export function TeacherLayout(): JSX.Element {
  return <AppShell area="Teacher" nav={[]} />;
}
