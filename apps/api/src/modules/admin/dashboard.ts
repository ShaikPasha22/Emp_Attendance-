import { Router } from 'express';
import { PERMISSIONS, type AttendanceFlag, type AttendanceStatus, type LiveDashboard } from '@app/shared';
import { getPolicySet, resolveContext } from '../../engine/context';
import { fullName } from '../../lib/employees';
import { prisma } from '../../lib/prisma';
import { employeeScopeWhere } from '../../lib/scope';
import { getCompanySettings } from '../../lib/settings';
import { dateKeyToDb, todayIn, weekdayOf } from '../../lib/time';
import { requirePermission } from '../../middleware/auth';

export const dashboardRouter = Router();

dashboardRouter.get('/live', requirePermission(PERMISSIONS.ATTENDANCE_VIEW), async (req, res) => {
  const company = await getCompanySettings();
  const date = todayIn(company.timezone);
  const d = dateKeyToDb(date);
  const scope = employeeScopeWhere(req.user!);

  const [users, set, records, remote, flagged, pendingApprovals, pendingAccess] = await Promise.all([
    prisma.user.findMany({
      where: { status: 'ACTIVE', ...scope },
      include: { location: true, department: { select: { name: true } } },
    }),
    getPolicySet(),
    prisma.attendanceRecord.findMany({ where: { date: d, user: { status: 'ACTIVE', ...scope } } }),
    prisma.request.findMany({
      where: { status: 'APPROVED', type: { in: ['WFH', 'ON_DUTY'] }, startDate: { lte: d }, endDate: { gte: d }, user: scope },
      select: { userId: true },
    }),
    prisma.attendanceRecord.count({ where: { reviewStatus: 'PENDING', user: scope } }),
    prisma.request.count({ where: { status: 'PENDING', user: scope } }),
    prisma.user.count({ where: { status: 'PENDING', ...scope } }),
  ]);

  const byUser = new Map(records.map((r) => [r.userId, r]));
  const remoteSet = new Set(remote.map((r) => r.userId));
  const dept = new Map<string, { department: string; total: number; present: number; late: number }>();
  let clockedIn = 0;
  let late = 0;
  let weeklyOff = 0;
  let remoteNoPunch = 0;

  for (const u of users) {
    const r = byUser.get(u.id);
    const key = u.department?.name ?? 'Unassigned';
    const row = dept.get(key) ?? { department: key, total: 0, present: 0, late: 0 };
    row.total++;
    if (r?.clockIn) {
      clockedIn++;
      row.present++;
      if (r.flags.includes('LATE')) {
        late++;
        row.late++;
      }
    } else if (remoteSet.has(u.id)) {
      remoteNoPunch++;
    } else {
      const ctx = resolveContext(u, set, company);
      if (ctx.policy.weeklyOffs.includes(weekdayOf(date))) weeklyOff++;
    }
    dept.set(key, row);
  }

  const recent = await prisma.attendanceRecord.findMany({
    where: { date: d, clockIn: { not: null }, user: scope },
    orderBy: { updatedAt: 'desc' },
    take: 15,
    include: { user: { select: { id: true, firstName: true, lastName: true, department: { select: { name: true } } } } },
  });

  const body: LiveDashboard = {
    date,
    totals: {
      active: users.length,
      clockedIn,
      late,
      notIn: Math.max(0, users.length - clockedIn - weeklyOff - remoteNoPunch),
      remote: remoteSet.size,
      weeklyOff,
      flagged,
      pendingApprovals,
      pendingAccess,
    },
    byDepartment: [...dept.values()].sort((a, b) => b.total - a.total),
    recentPunches: recent.map((r) => ({
      userId: r.user.id,
      name: fullName(r.user),
      department: r.user.department?.name ?? null,
      clockIn: r.clockIn?.toISOString() ?? null,
      clockOut: r.clockOut?.toISOString() ?? null,
      status: r.status as AttendanceStatus | null,
      flags: r.flags as AttendanceFlag[],
    })),
  };
  res.json(body);
});
