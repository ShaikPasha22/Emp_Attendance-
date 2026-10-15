import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError } from 'react-router';
import { Button } from './components/ui/Button';
import { PageLoader } from './components/ui/Display';
import { EmployeeLayout } from './layouts/EmployeeLayout';
import { useAuth } from './lib/auth';
import HomePage from './employee/HomePage';

/** Route-level code splitting: each screen downloads only when first opened. */
const page = (load: () => Promise<{ default: ComponentType }>) => {
  const Component = lazy(load);
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
};

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <PageLoader />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function RequireDashboard({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user?.canAccessDashboard) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicOnly() {
  const { status } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}

function RouteError() {
  const error = useRouteError() as Error | undefined;
  // A new deployment replaced old chunks: reload once to fetch the fresh app.
  if (error?.message?.includes('dynamically imported module') || error?.message?.includes('Importing a module script failed')) {
    if (!sessionStorage.getItem('chunk-reload')) {
      sessionStorage.setItem('chunk-reload', '1');
      window.location.reload();
      return <FullScreenLoader />;
    }
  }
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-slate-500">Please reload the page. If this keeps happening, contact HR or IT.</p>
      <Button onClick={() => window.location.assign('/')}>Reload</Button>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <PublicOnly />,
        children: [
          { path: '/login', element: page(() => import('./auth/LoginPage')) },
          { path: '/signup', element: page(() => import('./auth/SignupPage')) },
          { path: '/forgot-password', element: page(() => import('./auth/ForgotPasswordPage')) },
        ],
      },
      { path: '/reset-password', element: page(() => import('./auth/ResetPasswordPage')) },
      { path: '/accept-invite', element: page(() => import('./auth/AcceptInvitePage')) },
      {
        path: '/',
        element: (
          <RequireAuth>
            <EmployeeLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <HomePage /> },
          { path: 'attendance', element: page(() => import('./employee/AttendancePage')) },
          { path: 'requests', element: page(() => import('./employee/RequestsPage')) },
          { path: 'requests/new', element: page(() => import('./employee/RequestsPage')) },
          { path: 'profile', element: page(() => import('./employee/ProfilePage')) },
          { path: 'notifications', element: page(() => import('./employee/NotificationsPage')) },
        ],
      },
      {
        path: '/admin',
        element: (
          <RequireAuth>
            <RequireDashboard>{page(() => import('./layouts/AdminLayout'))}</RequireDashboard>
          </RequireAuth>
        ),
        children: [
          { index: true, element: page(() => import('./admin/OverviewPage')) },
          { path: 'approvals', element: page(() => import('./admin/ApprovalsPage')) },
          { path: 'team', element: page(() => import('./admin/TeamPage')) },
          { path: 'map', element: page(() => import('./admin/LiveMapPage')) },
          { path: 'attendance', element: page(() => import('./admin/AttendanceRecordsPage')) },
          { path: 'employees', element: page(() => import('./admin/EmployeesPage')) },
          { path: 'employees/:id', element: page(() => import('./admin/EmployeeDetailPage')) },
          { path: 'reports', element: page(() => import('./admin/ReportsPage')) },
          { path: 'settings', element: <Navigate to="/admin/settings/organization" replace /> },
          { path: 'settings/organization', element: page(() => import('./admin/settings/OrganizationPage')) },
          { path: 'settings/locations', element: page(() => import('./admin/settings/LocationsPage')) },
          { path: 'settings/shifts', element: page(() => import('./admin/settings/ShiftsPage')) },
          { path: 'settings/policies', element: page(() => import('./admin/settings/PoliciesPage')) },
          { path: 'settings/restrictions', element: page(() => import('./admin/settings/RestrictionsPage')) },
          { path: 'settings/workflows', element: page(() => import('./admin/settings/WorkflowsPage')) },
          { path: 'audit', element: page(() => import('./admin/AuditPage')) },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
