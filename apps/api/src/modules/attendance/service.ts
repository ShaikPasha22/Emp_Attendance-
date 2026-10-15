import type { AttendancePunch, AttendanceRecord, Prisma } from '@prisma/client';
import {
  REVIEW_FLAGS,
  type AttendanceDay,
  type AttendanceDayDetail,
  type AttendanceFlag,
  type AttendancePunchDto,
  type PunchPlace,
  type AttendanceStatus,
  type GeoPoint,
  type MonthAttendance,
  type PunchResult,
  type TodayAttendance,
} from '@app/shared';
import type { Request } from 'express';
import { loadContext, type EmployeeContext } from '../../engine/context';
import { evaluatePunch } from '../../engine/restrictions';
import { computeDay } from '../../engine/status';
import { AppError, conflict } from '../../lib/errors';
import { mapUrl, queueGeocode } from '../../lib/geocode';
import { publishPunch } from '../../lib/live';
import { getClientIp } from '../../lib/ip';
import { prisma, type Tx } from '../../lib/prisma';
import { dateKeyToDb, dbDateToKey, localTimeOf, monthRange, todayIn, addDays, weekdayOf } from '../../lib/time';

export function toAttendanceDay(r: AttendanceRecord, includeCoords = false): AttendanceDay {
  return {
    id: r.id,
    date: dbDateToKey(r.date),
    clockIn: r.clockIn?.toISOString() ?? null,
    clockOut: r.clockOut?.toISOString() ?? null,
    workMinutes: r.workMinutes,
    status: r.status as AttendanceStatus | null,
    flags: r.flags as AttendanceFlag[],
    lateMinutes: r.lateMinutes,
    source: r.source,
    reviewStatus: r.reviewStatus,
    inDistanceMeters: r.inDistanceMeters,
    outDistanceMeters: r.outDistanceMeters,
    ...(includeCoords ? { inLat: r.inLat, inLng: r.inLng, outLat: r.outLat, outLng: r.outLng } : {}),
  };
}

/** Approved WFH / On-duty request covering a date, if any. */
export async function approvedRemoteFor(userId: string, date: string, tx: Tx = prisma) {
  const d = dateKeyToDb(date);
  const req = await tx.request.findFirst({
    where: { userId, status: 'APPROVED', type: { in: ['WFH', 'ON_DUTY'] }, startDate: { lte: d }, endDate: { gte: d } },
    orderBy: { createdAt: 'desc' },
    select: { type: true },
  });
  return (req?.type as 'WFH' | 'ON_DUTY' | undefined) ?? null;
}

/** `status <> 'MP'` alone would also drop NULL statuses in SQL. */
const notMissedPunch = { OR: [{ status: null }, { status: { not: 'MP' as const } }] };

const shiftSnapshot = (ctx: EmployeeContext) => (ctx.shift ? (ctx.shift as unknown as Prisma.InputJsonValue) : undefined);

/** Recompute and persist one day for one employee. Creates the row if the day needs a status (e.g. absent). */
export async function recomputeDay(
  userId: string,
  date: string,
  opts: { tx?: Tx; ctx?: EmployeeContext; now?: Date; createIfMissing?: boolean; finalize?: boolean } = {},
) {
  const tx = opts.tx ?? prisma;
  const ctx = opts.ctx ?? (await loadContext(userId));
  const now = opts.now ?? new Date();
  const record = await tx.attendanceRecord.findUnique({ where: { userId_date: { userId, date: dateKeyToDb(date) } } });
  const approvedRequest = await approvedRemoteFor(userId, date, tx);

  const snapshot = (record?.shiftSnapshot as typeof ctx.shift | null) ?? ctx.shift;
  const result = computeDay({
    date,
    tz: ctx.tz,
    now,
    shift: snapshot,
    policy: ctx.policy,
    clockIn: record?.clockIn ?? null,
    clockOut: record?.clockOut ?? null,
    existingFlags: record?.flags ?? [],
    reviewStatus: record?.reviewStatus ?? 'NONE',
    statusOverride: (record?.statusOverride as AttendanceStatus | null) ?? null,
    approvedRequest,
  });

  if (!record) {
    if (!opts.createIfMissing || result.status === null) return null;
    return tx.attendanceRecord.create({
      data: {
        userId,
        date: dateKeyToDb(date),
        status: result.status,
        flags: result.flags,
        source: 'SYSTEM',
        shiftSnapshot: shiftSnapshot(ctx),
        finalized: !!opts.finalize && result.dayClosed,
      },
    });
  }
  return tx.attendanceRecord.update({
    where: { id: record.id },
    data: {
      status: result.status,
      flags: result.flags,
      workMinutes: result.workMinutes,
      lateMinutes: result.lateMinutes,
      ...(opts.finalize && result.dayClosed ? { finalized: true } : {}),
    },
  });
}

export function toPunchDto(p: AttendancePunch): AttendancePunchDto {
  return {
    id: p.id,
    type: p.type,
    at: p.at.toISOString(),
    latitude: p.latitude,
    longitude: p.longitude,
    accuracy: p.accuracy,
    distanceMeters: p.distanceMeters,
    flags: p.flags as AttendanceFlag[],
    address: p.address,
    mapUrl: p.latitude != null && p.longitude != null ? mapUrl(p.latitude, p.longitude) : null,
  };
}

/** First clock-in and last clock-out places of a day, for list views. */
export function placesOf(punches: Pick<AttendancePunch, 'type' | 'latitude' | 'longitude' | 'address' | 'distanceMeters'>[]): {
  inPlace: PunchPlace | null;
  outPlace: PunchPlace | null;
} {
  const toPlace = (p: (typeof punches)[number] | undefined): PunchPlace | null =>
    p && p.latitude != null && p.longitude != null
      ? { address: p.address, mapUrl: mapUrl(p.latitude, p.longitude), distanceMeters: p.distanceMeters }
      : null;
  const ins = punches.filter((p) => p.type === 'IN');
  const outs = punches.filter((p) => p.type === 'OUT');
  return { inPlace: toPlace(ins[0]), outPlace: toPlace(outs[outs.length - 1]) };
}

const officeDto = (ctx: EmployeeContext) =>
  ctx.office ? { name: ctx.office.name, latitude: ctx.office.latitude, longitude: ctx.office.longitude, radiusMeters: ctx.office.radiusMeters } : null;

const punchOrder = { orderBy: { at: 'asc' as const } };

export async function getToday(userId: string): Promise<TodayAttendance> {
  const ctx = await loadContext(userId);
  const now = new Date();
  let date = todayIn(ctx.tz, now);

  // Overnight shifts: an open punch from yesterday is still "today's" attendance until it is closed.
  const open = await prisma.attendanceRecord.findFirst({
    where: { userId, clockIn: { not: null }, clockOut: null, date: dateKeyToDb(addDays(date, -1)), ...notMissedPunch },
  });
  if (open) date = addDays(date, -1);

  const record = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId, date: dateKeyToDb(date) } },
    include: { punches: punchOrder },
  });
  const approvedRemote = await approvedRemoteFor(userId, date);
  return {
    date,
    timezone: ctx.tz,
    serverTime: now.toISOString(),
    shift: ctx.shiftInfo,
    isWeeklyOff: ctx.policy.weeklyOffs.includes(weekdayOf(date)),
    approvedRemote,
    record: record ? { ...toAttendanceDay(record), ...placesOf(record.punches) } : null,
    punches: record?.punches.map(toPunchDto) ?? [],
    restrictions: {
      geoCapture: ctx.restrictions.geoCapture,
      geofenceMode: ctx.restrictions.geofenceMode,
      maxAccuracyMeters: ctx.restrictions.maxAccuracyMeters,
      selfieRequired: ctx.restrictions.selfieRequired,
    },
    office: officeDto(ctx),
  };
}

/** One day with its punch log, for the employee's own day view. */
export async function getDayDetail(userId: string, date: string): Promise<AttendanceDayDetail> {
  const ctx = await loadContext(userId);
  const record = await prisma.attendanceRecord.findUnique({
    where: { userId_date: { userId, date: dateKeyToDb(date) } },
    include: { punches: punchOrder },
  });
  return {
    date,
    timezone: ctx.tz,
    office: officeDto(ctx),
    record: record ? { ...toAttendanceDay(record, true), ...placesOf(record.punches) } : null,
    punches: record?.punches.map(toPunchDto) ?? [],
  };
}

async function runChecks(
  req: Request,
  kind: 'IN' | 'OUT',
  ctx: EmployeeContext,
  date: string,
  point: GeoPoint | undefined,
  firstPunchOfDay: boolean,
) {
  const userId = req.user!.id;
  const now = new Date();
  const deviceId = req.header('x-device-id')?.slice(0, 100) || undefined;
  const [devices, previous, remote] = await Promise.all([
    ctx.restrictions.deviceBinding.enabled
      ? prisma.device.findMany({ where: { userId }, select: { deviceId: true } }).then((rows) => rows.map((d) => d.deviceId))
      : Promise.resolve([] as string[]),
    prisma.attendancePunch.findFirst({
      where: { userId, latitude: { not: null }, longitude: { not: null } },
      orderBy: { at: 'desc' },
      select: { latitude: true, longitude: true, at: true },
    }),
    approvedRemoteFor(userId, date),
  ]);
  const check = evaluatePunch({
    kind,
    restrictions: ctx.restrictions,
    office: ctx.office,
    point,
    ip: getClientIp(req),
    deviceId,
    registeredDevices: devices,
    approvedRemote: remote !== null,
    localTime: localTimeOf(now, ctx.tz),
    firstPunchOfDay,
    previousPunch: previous ? { latitude: previous.latitude!, longitude: previous.longitude!, at: previous.at } : null,
    now,
  });
  if (check.blocked) throw new AppError(403, check.blocked.code, check.blocked.message);
  if (check.registerDevice && deviceId) {
    await prisma.device.create({ data: { userId, deviceId, label: req.header('user-agent')?.slice(0, 120) } });
  } else if (deviceId && ctx.restrictions.deviceBinding.enabled) {
    await prisma.device.updateMany({ where: { userId, deviceId }, data: { lastUsedAt: now } });
  }
  return { check, deviceId };
}

const needsReview = (flags: string[]) => flags.some((f) => (REVIEW_FLAGS as readonly string[]).includes(f));

/** Evidence stored with every individual punch. Inside the geo-fence the place is simply the office. */
function punchEvidence(
  req: Request,
  ctx: EmployeeContext,
  point: GeoPoint | undefined,
  distance: number | null,
  deviceId: string | undefined,
  flags: string[],
) {
  const atOffice = !!ctx.office && distance !== null && distance <= ctx.office.radiusMeters;
  return {
    address: atOffice ? ctx.office!.name : null,
    addressSource: atOffice ? 'OFFICE' : point ? null : 'NONE',
    latitude: point?.latitude,
    longitude: point?.longitude,
    accuracy: point?.accuracy,
    distanceMeters: distance,
    ip: getClientIp(req),
    deviceId,
    userAgent: req.header('user-agent')?.slice(0, 300),
    flags,
  };
}

/** Push the punch to live dashboards right away, then resolve its address / region in the background. */
function announcePunch(userId: string, ctx: EmployeeContext, punchId: string, hasLocation: boolean) {
  publishPunch({ kind: 'punch', userId, businessUnitId: ctx.attrs.businessUnitId, locationId: ctx.attrs.locationId, at: new Date().toISOString() });
  if (hasLocation) queueGeocode(punchId);
}

/**
 * Clock in. Darwinbox-style "first in, last out": after clocking out, an employee can clock in again
 * the same day (e.g. back from a client visit); the day keeps its first clock-in and the session reopens.
 */
export async function clockIn(req: Request, point: GeoPoint | undefined): Promise<PunchResult> {
  const userId = req.user!.id;
  const ctx = await loadContext(userId);
  const now = new Date();
  const date = todayIn(ctx.tz, now);

  const existing = await prisma.attendanceRecord.findUnique({ where: { userId_date: { userId, date: dateKeyToDb(date) } } });
  if (existing?.clockIn && !existing.clockOut) throw conflict('You are already clocked in.', 'ALREADY_CLOCKED_IN');
  const openYesterday = await prisma.attendanceRecord.findFirst({
    where: { userId, date: dateKeyToDb(addDays(date, -1)), clockIn: { not: null }, clockOut: null, ...notMissedPunch },
  });
  if (openYesterday && ctx.shift && ctx.shift.endTime <= ctx.shift.startTime) {
    throw conflict('You are still clocked in from your overnight shift. Please clock out first.', 'OPEN_OVERNIGHT_SHIFT');
  }

  const resuming = !!existing?.clockIn && !!existing.clockOut;
  const { check, deviceId } = await runChecks(req, 'IN', ctx, date, point, !resuming);
  const flags = [...new Set([...(existing?.flags ?? []), ...check.flags])];
  const reviewStatus =
    needsReview(check.flags) && existing?.reviewStatus !== 'REJECTED' ? ('PENDING' as const) : (existing?.reviewStatus ?? ('NONE' as const));

  const record = await prisma.$transaction(async (tx) => {
    let rec;
    if (resuming) {
      // Reopen the day: keep the first clock-in, clear the last clock-out until they clock out again.
      const { count } = await tx.attendanceRecord.updateMany({
        where: { id: existing!.id, clockOut: { not: null } },
        data: { clockOut: null, workMinutes: null, flags, reviewStatus },
      });
      if (count === 0) throw conflict('You are already clocked in.', 'ALREADY_CLOCKED_IN');
      rec = existing!;
    } else {
      const data = {
        clockIn: now,
        inLat: point?.latitude,
        inLng: point?.longitude,
        inAccuracy: point?.accuracy,
        inDistanceMeters: check.distanceMeters,
        inIp: getClientIp(req),
        inDeviceId: deviceId,
        flags,
        source: 'APP' as const,
        shiftSnapshot: shiftSnapshot(ctx),
        reviewStatus,
      };
      // Unique (userId, date) makes double-taps safe: the second insert fails instead of duplicating.
      rec = existing
        ? await tx.attendanceRecord.update({ where: { id: existing.id }, data })
        : await tx.attendanceRecord.create({ data: { userId, date: dateKeyToDb(date), ...data } });
    }
    const punch = await tx.attendancePunch.create({
      data: { recordId: rec.id, userId, type: 'IN', at: now, ...punchEvidence(req, ctx, point, check.distanceMeters, deviceId, check.flags) },
    });
    return { rec, punch };
  });
  announcePunch(userId, ctx, record.punch.id, !!point);
  const updated = (await recomputeDay(userId, date, { ctx, now }))!;

  const late = updated.lateMinutes;
  const lateText = late >= 60 ? `${Math.floor(late / 60)}h ${late % 60}m` : `${late} min`;
  const lateNote = !resuming && updated.flags.includes('LATE') ? ` You are ${lateText} late.` : '';
  return {
    record: toAttendanceDay(updated ?? record.rec),
    message: resuming
      ? `Clocked in again at ${localTimeOf(now, ctx.tz)}. Your day continues from your first clock-in at ${localTimeOf(updated.clockIn!, ctx.tz)}.`
      : `Clocked in at ${localTimeOf(now, ctx.tz)}.${lateNote}`,
    warnings: check.warnings,
  };
}

export async function clockOut(req: Request, point: GeoPoint | undefined): Promise<PunchResult> {
  const userId = req.user!.id;
  const ctx = await loadContext(userId);
  const now = new Date();
  const today = todayIn(ctx.tz, now);

  // The open session may belong to today or (overnight shifts) yesterday.
  const record = await prisma.attendanceRecord.findFirst({
    where: {
      userId,
      clockIn: { not: null },
      clockOut: null,
      date: { in: [dateKeyToDb(today), dateKeyToDb(addDays(today, -1))] },
      ...notMissedPunch,
    },
    orderBy: { date: 'desc' },
  });
  if (!record) {
    const done = await prisma.attendanceRecord.findUnique({ where: { userId_date: { userId, date: dateKeyToDb(today) } } });
    throw conflict(
      done?.clockOut ? 'You have already clocked out. Clock in again if you resumed work.' : 'You have not clocked in yet.',
      done?.clockOut ? 'ALREADY_CLOCKED_OUT' : 'NOT_CLOCKED_IN',
    );
  }
  const date = dbDateToKey(record.date);
  const { check, deviceId } = await runChecks(req, 'OUT', ctx, date, point, false);
  const flags = [...new Set([...record.flags, ...check.flags])];

  const punch = await prisma.$transaction(async (tx) => {
    // Conditional update guards against a concurrent double clock-out.
    const { count } = await tx.attendanceRecord.updateMany({
      where: { id: record.id, clockOut: null },
      data: {
        clockOut: now,
        outLat: point?.latitude,
        outLng: point?.longitude,
        outAccuracy: point?.accuracy,
        outDistanceMeters: check.distanceMeters,
        outIp: getClientIp(req),
        outDeviceId: deviceId,
        flags,
        reviewStatus: needsReview(check.flags) && record.reviewStatus !== 'REJECTED' ? 'PENDING' : record.reviewStatus,
      },
    });
    if (count === 0) throw conflict('You have already clocked out.', 'ALREADY_CLOCKED_OUT');
    return tx.attendancePunch.create({
      data: { recordId: record.id, userId, type: 'OUT', at: now, ...punchEvidence(req, ctx, point, check.distanceMeters, deviceId, check.flags) },
    });
  });
  announcePunch(userId, ctx, punch.id, !!point);
  const updated = (await recomputeDay(userId, date, { ctx, now }))!;
  const hours = Math.floor((updated.workMinutes ?? 0) / 60);
  const mins = (updated.workMinutes ?? 0) % 60;
  return {
    record: toAttendanceDay(updated),
    message: `Clocked out at ${localTimeOf(now, ctx.tz)}. Total today: ${hours}h ${mins}m.`,
    warnings: check.warnings,
  };
}

export async function getMonth(userId: string, month: string): Promise<MonthAttendance> {
  const ctx = await loadContext(userId);
  const { from, to } = monthRange(month);
  const records = await prisma.attendanceRecord.findMany({
    where: { userId, date: { gte: dateKeyToDb(from), lte: dateKeyToDb(to) } },
    orderBy: { date: 'asc' },
  });
  const summary: MonthAttendance['summary'] = { workMinutes: 0 };
  for (const r of records) {
    if (r.status) summary[r.status as AttendanceStatus] = (summary[r.status as AttendanceStatus] ?? 0) + 1;
    summary.workMinutes += r.workMinutes ?? 0;
  }
  return { month, timezone: ctx.tz, days: records.map((r) => toAttendanceDay(r)), summary, weeklyOffs: ctx.policy.weeklyOffs };
}
