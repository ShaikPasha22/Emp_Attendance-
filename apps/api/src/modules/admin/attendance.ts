import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import {
  attendanceListQuerySchema,
  attendanceOverrideSchema,
  dateSchema,
  PERMISSIONS,
  reviewDecisionSchema,
} from '@app/shared';
import { z } from 'zod';
import { loadContext } from '../../engine/context';
import { audit } from '../../lib/audit';
import { fullName, notify } from '../../lib/employees';
import { AppError, notFound } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { employeeScopeWhere } from '../../lib/scope';
import { getCompanySettings } from '../../lib/settings';
import { atLocalTime, dateKeyToDb, diffDays, eachDate, localTimeOf, minutesOfDay } from '../../lib/time';
import { param, parse } from '../../lib/validate';
import { requirePermission } from '../../middleware/auth';
import { placesOf, recomputeDay, toAttendanceDay, toPunchDto } from '../attendance/service';

const { ATTENDANCE_VIEW, ATTENDANCE_OVERRIDE, SETTINGS_MANAGE } = PERMISSIONS;

export const adminAttendanceRouter = Router();

const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  department: { select: { name: true } },
  location: { select: { name: true, timezone: true } },
} satisfies Prisma.UserSelect;

adminAttendanceRouter.get('/', requirePermission(ATTENDANCE_VIEW), async (req, res) => {
  const q = parse(attendanceListQuerySchema, req.query);
  if (diffDays(q.from, q.to) > 92) throw new AppError(422, 'RANGE_TOO_LONG', 'Choose a range of at most 3 months');
  const where: Prisma.AttendanceRecordWhereInput = {
    date: { gte: dateKeyToDb(q.from), lte: dateKeyToDb(q.to) },
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.flagged === 'true' ? { reviewStatus: 'PENDING' } : {}),
    user: {
      AND: [
        employeeScopeWhere(req.user!),
        q.departmentId ? { departmentId: q.departmentId } : {},
        q.locationId ? { locationId: q.locationId } : {},
        q.q
          ? {
              OR: [
                { firstName: { contains: q.q, mode: 'insensitive' } },
                { lastName: { contains: q.q, mode: 'insensitive' } },
                { employeeCode: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    },
  };
  const { timezone: companyTz } = await getCompanySettings();
  const [rows, total] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where,
      include: {
        user: { select: userSelect },
        punches: { orderBy: { at: 'asc' }, select: { type: true, latitude: true, longitude: true, address: true, distanceMeters: true } },
      },
      orderBy: [{ date: 'desc' }, { clockIn: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.attendanceRecord.count({ where }),
  ]);
  res.json({
    items: rows.map(({ punches, ...r }) => ({
      ...toAttendanceDay(r, true),
      ...placesOf(punches),
      user: { id: r.user.id, name: fullName(r.user), employeeCode: r.user.employeeCode, department: r.user.department?.name ?? null, location: r.user.location?.name ?? null },
      timezone: r.user.location?.timezone ?? companyTz,
      statusOverride: r.statusOverride,
      overrideReason: r.overrideReason,
      reviewComment: r.reviewComment,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  });
});

async function recordInScope(req: Parameters<typeof employeeScopeWhere>[0], id: string) {
  const r = await prisma.attendanceRecord.findFirst({ where: { id, user: employeeScopeWhere(req) }, include: { user: { select: userSelect } } });
  if (!r) throw notFound('Attendance record');
  return r;
}

/** One record with its full punch log (map + timeline in the HR review dialog). */
adminAttendanceRouter.get('/:id', requirePermission(ATTENDANCE_VIEW), async (req, res) => {
  const r = await prisma.attendanceRecord.findFirst({
    where: { id: param(req), user: employeeScopeWhere(req.user!) },
    include: { punches: { orderBy: { at: 'asc' } }, user: { select: userSelect } },
  });
  if (!r) throw notFound('Attendance record');
  const ctx = await loadContext(r.userId);
  res.json({
    date: r.date.toISOString().slice(0, 10),
    timezone: ctx.tz,
    office: ctx.office ? { name: ctx.office.name, latitude: ctx.office.latitude, longitude: ctx.office.longitude, radiusMeters: ctx.office.radiusMeters } : null,
    record: { ...toAttendanceDay(r, true), ...placesOf(r.punches) },
    punches: r.punches.map(toPunchDto),
  });
});

adminAttendanceRouter.post('/:id/review', requirePermission(ATTENDANCE_OVERRIDE), async (req, res) => {
  const { decision, comment } = parse(reviewDecisionSchema, req.body);
  const record = await recordInScope(req.user!, param(req, 'id'));
  if (record.reviewStatus !== 'PENDING') throw new AppError(409, 'NOT_PENDING', 'This entry is not waiting for review');
  const reviewStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await prisma.attendanceRecord.update({
    where: { id: record.id },
    data: { reviewStatus, reviewedById: req.user!.id, reviewedAt: new Date(), reviewComment: comment ?? null },
  });
  const date = record.date.toISOString().slice(0, 10);
  const updated = await recomputeDay(record.userId, date);
  await notify(
    prisma,
    [record.userId],
    decision === 'APPROVE' ? 'Attendance entry accepted' : 'Attendance entry rejected',
    `HR ${decision === 'APPROVE' ? 'accepted' : 'rejected'} your flagged attendance for ${date}${comment ? `: ${comment}` : '.'}`,
    '/attendance',
  );
  await audit(req, { action: `attendance.review_${reviewStatus.toLowerCase()}`, entityType: 'AttendanceRecord', entityId: record.id, summary: `${reviewStatus} flagged entry of ${fullName(record.user)} on ${date}`, after: { comment } });
  res.json(toAttendanceDay(updated!));
});

/** HR override for one employee-day (creates the record if needed). Times are HH:mm in the employee's timezone. */
adminAttendanceRouter.put('/:userId/:date', requirePermission(ATTENDANCE_OVERRIDE), async (req, res) => {
  const date = parse(dateSchema, param(req, 'date'));
  const input = parse(attendanceOverrideSchema, req.body);
  const user = await prisma.user.findFirst({ where: { id: param(req, 'userId'), ...employeeScopeWhere(req.user!) }, select: userSelect });
  if (!user) throw notFound('Employee');
  const ctx = await loadContext(user.id);
  const before = await prisma.attendanceRecord.findUnique({ where: { userId_date: { userId: user.id, date: dateKeyToDb(date) } } });

  const toInstant = (hhmm: string | null | undefined, isOut: boolean) => {
    if (hhmm === undefined) return undefined;
    if (hhmm === null) return null;
    const inTime = input.clockIn ?? (before?.clockIn ? localTimeOf(before.clockIn, ctx.tz) : null);
    const overnight = isOut && inTime ? minutesOfDay(hhmm) <= minutesOfDay(inTime) : false;
    return atLocalTime(date, hhmm, ctx.tz, overnight ? 1 : 0);
  };
  const clockIn = toInstant(input.clockIn, false);
  const clockOut = toInstant(input.clockOut, true);
  const effectiveIn = clockIn !== undefined ? clockIn : before?.clockIn ?? null;
  const effectiveOut = clockOut !== undefined ? clockOut : before?.clockOut ?? null;
  if (effectiveOut && !effectiveIn) throw new AppError(422, 'INVALID_TIMES', 'Set a clock-in time before a clock-out time');
  if (effectiveIn && effectiveOut && effectiveOut <= effectiveIn) throw new AppError(422, 'INVALID_TIMES', 'Clock-out must be after clock-in');

  const data = {
    ...(clockIn !== undefined ? { clockIn } : {}),
    ...(clockOut !== undefined ? { clockOut } : {}),
    ...(input.statusOverride !== undefined ? { statusOverride: input.statusOverride } : {}),
    overrideReason: input.reason,
    overriddenById: req.user!.id,
    source: 'HR_OVERRIDE' as const,
    // An HR override resolves any pending review.
    ...(before?.reviewStatus === 'PENDING' ? { reviewStatus: 'APPROVED' as const, reviewedById: req.user!.id, reviewedAt: new Date() } : {}),
  };
  if (before) await prisma.attendanceRecord.update({ where: { id: before.id }, data });
  else
    await prisma.attendanceRecord.create({
      data: { userId: user.id, date: dateKeyToDb(date), ...data, shiftSnapshot: (ctx.shift as unknown as Prisma.InputJsonValue) ?? undefined },
    });
  const updated = await recomputeDay(user.id, date, { ctx, createIfMissing: true });
  await notify(prisma, [user.id], 'Attendance updated by HR', `HR updated your attendance for ${date}: ${input.reason}`, '/attendance');
  await audit(req, {
    action: 'attendance.override',
    entityType: 'AttendanceRecord',
    entityId: updated?.id,
    summary: `Override for ${fullName(user)} on ${date}: ${input.reason}`,
    before: before ? { clockIn: before.clockIn, clockOut: before.clockOut, status: before.status, statusOverride: before.statusOverride } : null,
    after: { clockIn: updated?.clockIn, clockOut: updated?.clockOut, status: updated?.status, statusOverride: updated?.statusOverride },
  });
  res.json(updated ? toAttendanceDay(updated) : null);
});

/** Recompute a date range (e.g. after changing a shift or policy). */
adminAttendanceRouter.post('/recompute', requirePermission(SETTINGS_MANAGE), async (req, res) => {
  const input = parse(z.object({ from: dateSchema, to: dateSchema, userId: z.string().optional() }), req.body);
  if (diffDays(input.from, input.to) > 62) throw new AppError(422, 'RANGE_TOO_LONG', 'Recompute at most 2 months at a time');
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE', ...(input.userId ? { id: input.userId } : {}), ...employeeScopeWhere(req.user!) },
    select: { id: true },
  });
  let count = 0;
  for (const u of users) {
    const ctx = await loadContext(u.id);
    for (const date of eachDate(input.from, input.to)) {
      if (await recomputeDay(u.id, date, { ctx, createIfMissing: true })) count++;
    }
  }
  await audit(req, { action: 'attendance.recompute', entityType: 'AttendanceRecord', summary: `Recomputed ${count} day(s) ${input.from} → ${input.to}` });
  res.json({ recomputed: count });
});
