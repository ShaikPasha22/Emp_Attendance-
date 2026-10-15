import { Router } from 'express';
import { dateSchema, monthSchema } from '@app/shared';
import { z } from 'zod';
import { fullName } from '../../lib/employees';
import { prisma } from '../../lib/prisma';
import { reportIds } from '../../lib/scope';
import { getCompanySettings } from '../../lib/settings';
import { dateKeyToDb, monthRange, todayIn } from '../../lib/time';
import { notFound } from '../../lib/errors';
import { param, parse } from '../../lib/validate';
import { getDayDetail, placesOf, toAttendanceDay } from '../attendance/service';

export const teamRouter = Router();

async function myTeam(managerId: string) {
  const ids = await reportIds(managerId, (frontier) =>
    prisma.user.findMany({ where: { managerId: { in: frontier }, status: 'ACTIVE' }, select: { id: true } }),
  );
  return prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, employeeCode: true, managerId: true, department: { select: { name: true } }, designation: { select: { name: true } } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
}

teamRouter.get('/today', async (req, res) => {
  const team = await myTeam(req.user!.id);
  const { timezone } = await getCompanySettings();
  const date = todayIn(timezone);
  const records = await prisma.attendanceRecord.findMany({
    where: { userId: { in: team.map((t) => t.id) }, date: dateKeyToDb(date) },
    include: { punches: { orderBy: { at: 'asc' }, select: { type: true, latitude: true, longitude: true, address: true, distanceMeters: true } } },
  });
  const byUser = new Map(records.map((r) => [r.userId, r]));
  res.json({
    date,
    members: team.map((t) => {
      const r = byUser.get(t.id);
      return {
        id: t.id,
        name: fullName(t),
        employeeCode: t.employeeCode,
        department: t.department?.name ?? null,
        designation: t.designation?.name ?? null,
        direct: t.managerId === req.user!.id,
        record: r ? { ...toAttendanceDay(r), ...placesOf(r.punches) } : null,
      };
    }),
  });
});

teamRouter.get('/attendance', async (req, res) => {
  const { month } = parse(z.object({ month: monthSchema }), req.query);
  const { from, to } = monthRange(month);
  const team = await myTeam(req.user!.id);
  const records = await prisma.attendanceRecord.findMany({
    where: { userId: { in: team.map((t) => t.id) }, date: { gte: dateKeyToDb(from), lte: dateKeyToDb(to) } },
    orderBy: { date: 'asc' },
  });
  res.json({
    month,
    members: team.map((t) => ({
      id: t.id,
      name: fullName(t),
      employeeCode: t.employeeCode,
      department: t.department?.name ?? null,
      days: records.filter((r) => r.userId === t.id).map((r) => toAttendanceDay(r)),
    })),
  });
});

/** A team member's day with every clock-in / clock-out and where it happened (only for the manager's reports). */
teamRouter.get('/members/:userId/day/:date', async (req, res) => {
  const userId = param(req, 'userId');
  const date = parse(dateSchema, param(req, 'date'));
  const team = await myTeam(req.user!.id);
  if (!team.some((t) => t.id === userId)) throw notFound('Team member');
  res.json(await getDayDetail(userId, date));
});
