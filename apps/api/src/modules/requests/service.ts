import type { Prisma } from '@prisma/client';
import {
  PERMISSIONS,
  REQUEST_TYPE_LABELS,
  type ApproverType,
  type CreateRequestInput,
  type RequestDto,
  type RequestType,
} from '@app/shared';
import type { Request as ExpressRequest } from 'express';
import { loadContext } from '../../engine/context';
import { audit } from '../../lib/audit';
import { fullName, notify, usersWithPermission } from '../../lib/employees';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';
import { inHrScope } from '../../lib/scope';
import { atLocalTime, dateKeyToDb, dbDateToKey, diffDays, eachDate, minutesOfDay, monthRange, todayIn } from '../../lib/time';
import type { AuthUser } from '../../types/express';
import { recomputeDay } from '../attendance/service';

export const DEFAULT_LEVELS: { approverType: ApproverType }[] = [
  { approverType: 'REPORTING_MANAGER' },
  { approverType: 'HR' },
];

export async function workflowLevels(type: RequestType, tx: Tx = prisma) {
  const wf = await tx.workflowDefinition.findUnique({ where: { requestType: type } });
  return (wf?.levels as { approverType: ApproverType }[] | undefined) ?? DEFAULT_LEVELS;
}

const requestInclude = {
  user: { select: { id: true, firstName: true, lastName: true, employeeCode: true, managerId: true, businessUnitId: true, locationId: true, department: { select: { name: true } } } },
  approvals: { include: { approver: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.RequestInclude;

type RequestWithRelations = Prisma.RequestGetPayload<{ include: typeof requestInclude }>;

export function toRequestDto(r: RequestWithRelations): RequestDto {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    startDate: dbDateToKey(r.startDate),
    endDate: dbDateToKey(r.endDate),
    reason: r.reason,
    payload: r.payload as Record<string, unknown>,
    currentLevel: r.currentLevel,
    levels: r.levels as { approverType: ApproverType }[],
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    user: { id: r.user.id, name: fullName(r.user), employeeCode: r.user.employeeCode, department: r.user.department?.name ?? null },
    approvals: r.approvals.map((a) => ({
      level: a.level,
      decision: a.decision,
      comment: a.comment,
      approver: fullName(a.approver),
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

/** Can `actor` act on the request's current level? */
export function canAct(actor: AuthUser, r: RequestWithRelations, level = r.currentLevel): boolean {
  if (r.status !== 'PENDING' || r.user.id === actor.id) return false;
  const lvl = (r.levels as { approverType: ApproverType }[])[level];
  if (!lvl) return false;
  if (lvl.approverType === 'REPORTING_MANAGER') return r.user.managerId === actor.id;
  return actor.permissions.includes(PERMISSIONS.REQUESTS_APPROVE_HR) && inHrScope(actor, r.user);
}

/** Users who should be notified that a request is waiting at `level`. */
async function approverIdsFor(tx: Tx, r: { userId: string; levels: unknown }, level: number) {
  const lvl = (r.levels as { approverType: ApproverType }[])[level];
  if (!lvl) return [];
  const user = await tx.user.findUniqueOrThrow({ where: { id: r.userId }, select: { managerId: true, businessUnitId: true, locationId: true } });
  if (lvl.approverType === 'REPORTING_MANAGER') return user.managerId ? [user.managerId] : [];
  const hr = await usersWithPermission(PERMISSIONS.REQUESTS_APPROVE_HR, tx);
  return hr
    .filter((h) => h.id !== r.userId)
    .filter((h) =>
      h.profile.scope === 'COMPANY' ||
      (h.profile.scope === 'ASSIGNED' &&
        ((!!user.businessUnitId && h.hrScopeBusinessUnitIds.includes(user.businessUnitId)) ||
          (!!user.locationId && h.hrScopeLocationIds.includes(user.locationId)))),
    )
    .map((h) => h.id);
}

export async function createRequest(req: ExpressRequest, input: CreateRequestInput): Promise<RequestDto> {
  const userId = req.user!.id;
  const ctx = await loadContext(userId);
  const today = todayIn(ctx.tz);
  const startDate = input.type === 'REGULARIZATION' ? input.date : input.startDate;
  const endDate = input.type === 'REGULARIZATION' ? input.date : input.endDate;
  let payload: Record<string, string> = {};

  if (diffDays(startDate, today) > ctx.limits.regularizationWindowDays) {
    throw unprocessable(`Requests can only be raised for the last ${ctx.limits.regularizationWindowDays} days.`, 'OUTSIDE_WINDOW');
  }

  if (input.type === 'REGULARIZATION') {
    if (input.date > today) throw unprocessable('You cannot correct attendance for a future date.', 'FUTURE_DATE');
    const overnight = ctx.shift ? minutesOfDay(ctx.shift.endTime) <= minutesOfDay(ctx.shift.startTime) : false;
    if (minutesOfDay(input.clockOut) <= minutesOfDay(input.clockIn) && !overnight) {
      throw unprocessable('Clock-out time must be after clock-in time.', 'INVALID_TIMES');
    }
    const month = monthRange(input.date.slice(0, 7));
    const used = await prisma.request.count({
      where: {
        userId,
        type: 'REGULARIZATION',
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { gte: dateKeyToDb(month.from), lte: dateKeyToDb(month.to) },
      },
    });
    if (ctx.limits.maxRegularizationsPerMonth > 0 && used >= ctx.limits.maxRegularizationsPerMonth) {
      throw unprocessable(`You have reached the limit of ${ctx.limits.maxRegularizationsPerMonth} corrections for this month.`, 'LIMIT_REACHED');
    }
    payload = { clockIn: input.clockIn, clockOut: input.clockOut };
  } else {
    if (endDate < startDate) throw unprocessable('End date must be on or after start date.', 'INVALID_RANGE');
    if (diffDays(startDate, endDate) > 30) throw unprocessable('A single request can cover at most 31 days.', 'RANGE_TOO_LONG');
  }

  const overlap = await prisma.request.findFirst({
    where: {
      userId,
      type: input.type,
      status: { in: ['PENDING', 'APPROVED'] },
      startDate: { lte: dateKeyToDb(endDate) },
      endDate: { gte: dateKeyToDb(startDate) },
    },
  });
  if (overlap) throw conflict(`You already have a ${overlap.status.toLowerCase()} ${REQUEST_TYPE_LABELS[input.type]} request for these dates.`, 'DUPLICATE_REQUEST');

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { manager: { select: { status: true } } } });
  let levels = await workflowLevels(input.type);
  // Skip the manager level when there is no active reporting manager.
  if (!user.managerId || user.manager?.status !== 'ACTIVE') levels = levels.filter((l) => l.approverType !== 'REPORTING_MANAGER');
  if (levels.length === 0) levels = [{ approverType: 'HR' }];

  const created = await prisma.$transaction(async (tx) => {
    const r = await tx.request.create({
      data: {
        userId,
        type: input.type,
        startDate: dateKeyToDb(startDate),
        endDate: dateKeyToDb(endDate),
        reason: input.reason,
        payload,
        levels,
      },
      include: requestInclude,
    });
    await notify(
      tx,
      await approverIdsFor(tx, r, 0),
      `${REQUEST_TYPE_LABELS[r.type]} request`,
      `${fullName(r.user)} requested ${REQUEST_TYPE_LABELS[r.type].toLowerCase()} for ${startDate === endDate ? startDate : `${startDate} → ${endDate}`}.`,
      '/admin/approvals',
    );
    await audit(req, { action: 'request.created', entityType: 'Request', entityId: r.id, summary: `${REQUEST_TYPE_LABELS[r.type]} ${startDate}`, after: { type: r.type, startDate, endDate, payload } }, tx);
    return r;
  });
  return toRequestDto(created);
}

/** Apply the effect of a fully approved request to attendance. */
async function applyApproved(tx: Tx, r: RequestWithRelations) {
  const ctx = await loadContext(r.userId);
  const start = dbDateToKey(r.startDate);
  const end = dbDateToKey(r.endDate);
  const today = todayIn(ctx.tz);

  if (r.type === 'REGULARIZATION') {
    const p = r.payload as { clockIn: string; clockOut: string };
    const overnight = minutesOfDay(p.clockOut) <= minutesOfDay(p.clockIn);
    const clockIn = atLocalTime(start, p.clockIn, ctx.tz);
    const clockOut = atLocalTime(start, p.clockOut, ctx.tz, overnight ? 1 : 0);
    const existing = await tx.attendanceRecord.findUnique({ where: { userId_date: { userId: r.userId, date: r.startDate } } });
    const data = {
      clockIn,
      clockOut,
      source: 'REGULARIZED' as const,
      // The approval chain counts as the review of any flagged punch.
      reviewStatus: existing?.reviewStatus === 'PENDING' || existing?.reviewStatus === 'REJECTED' ? ('APPROVED' as const) : (existing?.reviewStatus ?? 'NONE'),
      shiftSnapshot: existing?.shiftSnapshot ?? (ctx.shift as unknown as Prisma.InputJsonValue) ?? undefined,
    };
    if (existing) await tx.attendanceRecord.update({ where: { id: existing.id }, data });
    else await tx.attendanceRecord.create({ data: { userId: r.userId, date: r.startDate, ...data } });
    await recomputeDay(r.userId, start, { tx, ctx, createIfMissing: true });
    return;
  }
  // WFH / On-duty: recompute every elapsed day in the range; future days pick it up when they happen.
  for (const date of eachDate(start, end > today ? today : end)) {
    await recomputeDay(r.userId, date, { tx, ctx, createIfMissing: true });
  }
}

async function loadRequest(id: string, tx: Tx = prisma) {
  const r = await tx.request.findUnique({ where: { id }, include: requestInclude });
  if (!r) throw notFound('Request');
  return r;
}

export async function approve(req: ExpressRequest, id: string, comment?: string): Promise<RequestDto> {
  const actor = req.user!;
  const result = await prisma.$transaction(async (tx) => {
    let r = await loadRequest(id, tx);
    if (!canAct(actor, r)) throw forbidden('You cannot approve this request at its current stage.', 'NOT_APPROVER');
    const levels = r.levels as { approverType: ApproverType }[];

    let level = r.currentLevel;
    // Record this approval, and auto-approve following levels the same person is also eligible for.
    do {
      await tx.approval.create({
        data: { requestId: r.id, level, approverId: actor.id, decision: 'APPROVED', comment: level === r.currentLevel ? comment : 'Auto-approved (same approver)' },
      });
      level++;
    } while (level < levels.length && canAct(actor, r, level));

    const isFinal = level >= levels.length;
    // Conditional update: if someone else acted concurrently, nothing matches and we abort.
    const { count } = await tx.request.updateMany({
      where: { id: r.id, status: 'PENDING', currentLevel: r.currentLevel },
      data: isFinal ? { status: 'APPROVED', currentLevel: level - 1, decidedAt: new Date() } : { currentLevel: level },
    });
    if (count === 0) throw conflict('This request was already handled by someone else.', 'ALREADY_DECIDED');

    r = await loadRequest(id, tx);
    if (isFinal) {
      await applyApproved(tx, r);
      await notify(tx, [r.userId], `${REQUEST_TYPE_LABELS[r.type]} approved`, `Your request for ${dbDateToKey(r.startDate)} was approved.`, '/requests');
    } else {
      await notify(tx, await approverIdsFor(tx, r, level), `${REQUEST_TYPE_LABELS[r.type]} request`, `${fullName(r.user)}'s request is waiting for your approval.`, '/admin/approvals');
    }
    await audit(req, { action: isFinal ? 'request.approved' : 'request.level_approved', entityType: 'Request', entityId: r.id, summary: `${REQUEST_TYPE_LABELS[r.type]} for ${fullName(r.user)}`, after: { level: level - 1, comment } }, tx);
    return r;
  }, { timeout: 20_000 });
  return toRequestDto(result);
}

export async function reject(req: ExpressRequest, id: string, comment: string): Promise<RequestDto> {
  const actor = req.user!;
  const result = await prisma.$transaction(async (tx) => {
    const r = await loadRequest(id, tx);
    if (!canAct(actor, r)) throw forbidden('You cannot reject this request at its current stage.', 'NOT_APPROVER');
    const { count } = await tx.request.updateMany({
      where: { id: r.id, status: 'PENDING', currentLevel: r.currentLevel },
      data: { status: 'REJECTED', decidedAt: new Date() },
    });
    if (count === 0) throw conflict('This request was already handled by someone else.', 'ALREADY_DECIDED');
    await tx.approval.create({ data: { requestId: r.id, level: r.currentLevel, approverId: actor.id, decision: 'REJECTED', comment } });
    await notify(tx, [r.userId], `${REQUEST_TYPE_LABELS[r.type]} rejected`, `Your request for ${dbDateToKey(r.startDate)} was rejected: ${comment}`, '/requests');
    await audit(req, { action: 'request.rejected', entityType: 'Request', entityId: r.id, summary: `${REQUEST_TYPE_LABELS[r.type]} for ${fullName(r.user)}`, after: { comment } }, tx);
    return loadRequest(id, tx);
  });
  return toRequestDto(result);
}

export async function cancel(req: ExpressRequest, id: string): Promise<RequestDto> {
  const r = await loadRequest(id);
  if (r.userId !== req.user!.id) throw forbidden();
  if (r.status !== 'PENDING') throw new AppError(409, 'NOT_PENDING', 'Only pending requests can be cancelled.');
  await prisma.request.update({ where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() } });
  await audit(req, { action: 'request.cancelled', entityType: 'Request', entityId: id, summary: 'Cancelled by employee' });
  return toRequestDto(await loadRequest(id));
}

export async function listMine(userId: string, status?: string) {
  const rows = await prisma.request.findMany({
    where: { userId, ...(status ? { status: status as never } : {}) },
    include: requestInclude,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map(toRequestDto);
}

/** Requests waiting for this user's decision (manager level and/or HR level). */
export async function inbox(actor: AuthUser) {
  const isHr = actor.permissions.includes(PERMISSIONS.REQUESTS_APPROVE_HR);
  const rows = await prisma.request.findMany({
    where: {
      status: 'PENDING',
      userId: { not: actor.id },
      ...(isHr ? {} : { user: { managerId: actor.id } }),
    },
    include: requestInclude,
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  return rows.filter((r) => canAct(actor, r)).map(toRequestDto);
}

/** Requests the actor has already acted on, or (HR) all decided requests in scope. */
export async function history(actor: AuthUser) {
  const rows = await prisma.request.findMany({
    where: { approvals: { some: { approverId: actor.id } } },
    include: requestInclude,
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return rows.map(toRequestDto);
}

export async function getOne(actor: AuthUser, id: string) {
  const r = await loadRequest(id);
  const allowed =
    r.userId === actor.id ||
    r.user.managerId === actor.id ||
    r.approvals.some((a) => a.approverId === actor.id) ||
    ((actor.permissions.includes(PERMISSIONS.REQUESTS_APPROVE_HR) || actor.permissions.includes(PERMISSIONS.ATTENDANCE_VIEW)) && inHrScope(actor, r.user));
  if (!allowed) throw notFound('Request');
  return toRequestDto(r);
}
