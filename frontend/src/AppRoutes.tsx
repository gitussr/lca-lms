import type { JSX } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './auth/ProtectedRoute.js';
import { StudentLayout } from './layouts/StudentLayout.js';
import { TeacherLayout } from './layouts/TeacherLayout.js';
import { AdminLayout } from './layouts/AdminLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { PlaceholderDashboard } from './pages/PlaceholderDashboard.js';

/**
 * Route table for the whole app.
 *
 * - `/login` is the only public route.
 * - Each role area sits behind <ProtectedRoute> with an explicit `allow`
 *   list, then its layout shell, then the area's pages.
 */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute allow={['student']} />}>
        <Route path="/" element={<StudentLayout />}>
          <Route index element={<PlaceholderDashboard area="Student" />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute allow={['teacher']} />}>
        <Route path="/teacher" element={<TeacherLayout />}>
          <Route index element={<PlaceholderDashboard area="Teacher" />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute allow={['admin']} />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<PlaceholderDashboard area="Admin" />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
