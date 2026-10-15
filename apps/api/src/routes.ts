import { Router } from 'express';
import { authenticate, requireDashboard } from './middleware/auth';
import { adminAttendanceRouter } from './modules/admin/attendance';
import { auditRouter } from './modules/admin/audit';
import { dashboardRouter } from './modules/admin/dashboard';
import { employeesRouter } from './modules/admin/employees';
import { liveMapRouter } from './modules/admin/liveMap';
import { settingsRouter } from './modules/admin/settings';
import { setupRouter } from './modules/admin/setup';
import { attendanceRouter } from './modules/attendance/routes';
import { authRouter } from './modules/auth/routes';
import { jobsRouter } from './modules/jobs/routes';
import { meRouter } from './modules/me/routes';
import { reportsRouter } from './modules/reports/routes';
import { requestsRouter } from './modules/requests/routes';
import { teamRouter } from './modules/team/routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/internal/jobs', jobsRouter);

// Everything below requires a signed-in, active user.
apiRouter.use(authenticate);
apiRouter.use('/me', meRouter);
apiRouter.use('/attendance', attendanceRouter);
apiRouter.use('/requests', requestsRouter);

// Dashboard (managers + HR), guarded by the optional dashboard IP allowlist.
apiRouter.use('/team', requireDashboard, teamRouter);
apiRouter.use('/admin', requireDashboard);
apiRouter.use('/admin/dashboard', dashboardRouter);
apiRouter.use('/admin/live-map', liveMapRouter);
apiRouter.use('/admin/employees', employeesRouter);
apiRouter.use('/admin/attendance', adminAttendanceRouter);
apiRouter.use('/admin/settings', settingsRouter);
apiRouter.use('/admin/setup', setupRouter);
apiRouter.use('/admin/audit', auditRouter);
apiRouter.use('/reports', requireDashboard, reportsRouter);
