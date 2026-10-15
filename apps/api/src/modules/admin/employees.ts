import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import {
  bulkInviteSchema,
  employeeListQuerySchema,
  employeeStatusActionSchema,
  inviteEmployeeSchema,
  PERMISSIONS,
  restrictionOverrideSchema,
  updateEmployeeSchema,
  type EmployeeListItem,
  type InviteEmployeeInput,
} from '@app/shared';
import { env } from '../../config/env';
import { getPolicySet, loadContext, resolveContext } from '../../engine/context';
import { audit } from '../../lib/audit';
import { actionEmail, sendEmail } from '../../lib/email';
import { fullName, nextEmployeeCode, notify, withCodeRetry } from '../../lib/employees';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors';
import { prisma, type Tx } from '../../lib/prisma';
import { employeeScopeWhere } from '../../lib/scope';
import { getCompanySettings } from '../../lib/settings';
import { dateKeyToDb } from '../../lib/time';
import { param, parse } from '../../lib/validate';
import { requirePermission } from '../../middleware/auth';
import type { AuthUser } from '../../types/express';
import { createUserToken } from '../auth/service';

const { EMPLOYEES_VIEW, EMPLOYEES_MANAGE, SECURITY_MANAGE } = PERMISSIONS;
const INVITE_TTL_HOURS = 72;

export const employeesRouter = Router();

const listInclude = {
  department: { select: { name: true } },
  designation: { select: { name: true } },
  location: { select: { name: true } },
  manager: { select: { firstName: true, lastName: true } },
  profile: { select: { name: true } },
} satisfies Prisma.UserInclude;

function toListItem(u: Prisma.UserGetPayload<{ include: typeof listInclude }>): EmployeeListItem {
  return {
    id: u.id,
    employeeCode: u.employeeCode,
    name: fullName(u),
    email: u.email,
    status: u.status,
    employeeType: u.employeeType,
    department: u.department?.name ?? null,
    designation: u.designation?.name ?? null,
    location: u.location?.name ?? null,
    manager: u.manager ? fullName(u.manager) : null,
    profile: u.profile.name,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

/** Loads an employee the actor is allowed to see (HR scope), else 404. */
async function findInScope(actor: AuthUser, id: string) {
  const user = await prisma.user.findFirst({ where: { id, ...employeeScopeWhere(actor) }, include: { profile: true } });
  if (!user) throw notFound('Employee');
  return user;
}

/** Prevent privilege escalation: you cannot grant or manage permissions you do not hold yourself. */
function assertWithinOwnPermissions(actor: AuthUser, permissions: string[], what: string) {
  const missing = permissions.filter((p) => !actor.permissions.includes(p as never));
  if (missing.length) throw forbidden(`You cannot ${what} with permissions you do not have yourself.`, 'PRIVILEGE_ESCALATION');
}

async function assertProfileAssignable(actor: AuthUser, profileId: string | null | undefined) {
  if (!profileId) return;
  const profile = await prisma.permissionProfile.findUnique({ where: { id: profileId } });
  if (!profile) throw badRequest('Unknown permission profile');
  assertWithinOwnPermissions(actor, profile.permissions, 'assign a profile');
}

/** A manager cannot be the employee themself or anyone who reports up to them. */
async function assertNoManagerCycle(userId: string, managerId: string | null | undefined) {
  if (!managerId) return;
  if (managerId === userId) throw badRequest('An employee cannot be their own manager');
  let current: string | null = managerId;
  for (let i = 0; i < 20 && current; i++) {
    const row: { managerId: string | null } | null = await prisma.user.findUnique({ where: { id: current }, select: { managerId: true } });
    if (row?.managerId === userId) throw badRequest('This manager reports to the employee — that would create a loop');
    current = row?.managerId ?? null;
  }
}

function userData(input: Partial<InviteEmployeeInput>): Prisma.UserUncheckedUpdateInput {
  const { joiningDate, employeeCode: _code, ...rest } = input;
  return {
    ...rest,
    ...(joiningDate !== undefined ? { joiningDate: joiningDate ? dateKeyToDb(joiningDate) : null } : {}),
  } as Prisma.UserUncheckedUpdateInput;
}

async function sendInvite(user: { id: string; email: string; firstName: string }, tx: Tx = prisma) {
  const token = await createUserToken(tx, user.id, 'INVITE', INVITE_TTL_HOURS);
  const link = `${env.APP_URL}/accept-invite?token=${token}`;
  const { name } = await getCompanySettings();
  return { link, send: () => sendEmail(actionEmail({
    to: user.email,
    subject: `You're invited to ${name} Attendance`,
    heading: `Welcome, ${user.firstName}!`,
    body: `${name} has invited you to the attendance app. Set your password to get started. This link is valid for ${INVITE_TTL_HOURS / 24} days.`,
    actionLabel: 'Set my password',
    actionUrl: link,
  })) };
}

employeesRouter.get('/', requirePermission(EMPLOYEES_VIEW, EMPLOYEES_MANAGE), async (req, res) => {
  const q = parse(employeeListQuerySchema, req.query);
  const where: Prisma.UserWhereInput = {
    AND: [
      employeeScopeWhere(req.user!),
      q.status ? { status: q.status } : {},
      q.departmentId ? { departmentId: q.departmentId } : {},
      q.locationId ? { locationId: q.locationId } : {},
      q.q
        ? {
            OR: [
              { firstName: { contains: q.q, mode: 'insensitive' } },
              { lastName: { contains: q.q, mode: 'insensitive' } },
              { email: { contains: q.q, mode: 'insensitive' } },
              { employeeCode: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: listInclude,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  res.json({ items: rows.map(toListItem), total, page: q.page, pageSize: q.pageSize });
});

employeesRouter.get('/:id', requirePermission(EMPLOYEES_VIEW, EMPLOYEES_MANAGE), async (req, res) => {
  await findInScope(req.user!, param(req, 'id'));
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: param(req, 'id') },
    include: {
      ...listInclude,
      devices: { orderBy: { lastUsedAt: 'desc' } },
      _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } }, reports: true } },
    },
  });
  const ctx = await loadContext(u.id);
  // Restrictions this person would have without their individual override (shown as "inherits").
  const withLocation = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { location: true } });
  const inherited = resolveContext({ ...withLocation, restrictionOverride: null }, await getPolicySet(), await getCompanySettings()).restrictions;
  const pendingInvite = await prisma.userToken.findFirst({ where: { userId: u.id, type: 'INVITE', usedAt: null, expiresAt: { gt: new Date() } } });
  res.json({
    ...toListItem(u),
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    joiningDate: u.joiningDate?.toISOString().slice(0, 10) ?? null,
    businessUnitId: u.businessUnitId,
    departmentId: u.departmentId,
    designationId: u.designationId,
    gradeId: u.gradeId,
    locationId: u.locationId,
    shiftId: u.shiftId,
    managerId: u.managerId,
    profileId: u.profileId,
    hrScopeBusinessUnitIds: u.hrScopeBusinessUnitIds,
    hrScopeLocationIds: u.hrScopeLocationIds,
    restrictionOverride: u.restrictionOverride,
    restrictionOverrideReason: u.restrictionOverrideReason,
    devices: u.devices.map((d) => ({ id: d.id, label: d.label, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt })),
    activeSessions: u._count.sessions,
    reportsCount: u._count.reports,
    invitePending: !!pendingInvite,
    effective: { shift: ctx.shiftInfo, policy: ctx.policy, restrictions: ctx.restrictions, inheritedRestrictions: inherited, timezone: ctx.tz, office: ctx.office?.name ?? null },
  });
});

employeesRouter.post('/', requirePermission(EMPLOYEES_MANAGE), async (req, res) => {
  const input = parse(inviteEmployeeSchema, req.body);
  const actor = req.user!;
  await assertProfileAssignable(actor, input.profileId);
  const defaultProfile = await prisma.permissionProfile.findFirstOrThrow({ where: { name: 'Employee' } });
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw new AppError(409, 'EMAIL_EXISTS', 'An employee with this email already exists');
  }

  const { user, invite } = await withCodeRetry(() =>
    prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          ...(userData(input) as Prisma.UserUncheckedCreateInput),
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          employeeCode: input.employeeCode || (await nextEmployeeCode(tx)),
          profileId: input.profileId ?? defaultProfile.id,
          status: 'INVITED',
        },
      });
      const inv = await sendInvite(created, tx);
      await audit(req, { action: 'employee.invited', entityType: 'User', entityId: created.id, summary: `Invited ${created.email}`, after: input }, tx);
      return { user: created, invite: inv };
    }),
  );
  const emailed = await invite.send();
  res.status(201).json({ id: user.id, employeeCode: user.employeeCode, inviteLink: invite.link, emailed });
});

employeesRouter.post('/bulk', requirePermission(EMPLOYEES_MANAGE), async (req, res) => {
  const { employees, sendEmails } = parse(bulkInviteSchema, req.body);
  const [departments, designations, locations, profile, existing] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.designation.findMany({ select: { id: true, name: true } }),
    prisma.location.findMany({ select: { id: true, name: true } }),
    prisma.permissionProfile.findFirstOrThrow({ where: { name: 'Employee' } }),
    prisma.user.findMany({ select: { id: true, email: true } }),
  ]);
  const byName = (list: { id: string; name: string }[], name?: string) =>
    name ? list.find((x) => x.name.toLowerCase() === name.toLowerCase())?.id : undefined;
  const emails = new Map(existing.map((u) => [u.email, u.id]));

  const results: { row: number; email: string; ok: boolean; error?: string; inviteLink?: string }[] = [];
  for (const [i, e] of employees.entries()) {
    const row = i + 1;
    try {
      if (emails.has(e.email)) throw new Error('Email already exists');
      const departmentId = byName(departments, e.department);
      const designationId = byName(designations, e.designation);
      const locationId = byName(locations, e.location);
      if (e.department && !departmentId) throw new Error(`Unknown department "${e.department}"`);
      if (e.designation && !designationId) throw new Error(`Unknown designation "${e.designation}"`);
      if (e.location && !locationId) throw new Error(`Unknown location "${e.location}"`);
      const managerId = e.managerEmail ? emails.get(e.managerEmail) : undefined;
      if (e.managerEmail && !managerId) throw new Error(`Manager ${e.managerEmail} not found`);

      const { user, invite } = await withCodeRetry(() =>
        prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: {
              firstName: e.firstName,
              lastName: e.lastName,
              email: e.email,
              phone: e.phone || null,
              employeeCode: e.employeeCode || (await nextEmployeeCode(tx)),
              employeeType: e.employeeType ?? 'PERMANENT',
              departmentId,
              designationId,
              locationId,
              managerId,
              profileId: profile.id,
              status: 'INVITED',
            },
          });
          return { user: created, invite: await sendInvite(created, tx) };
        }),
      );
      emails.set(user.email, user.id);
      if (sendEmails) await invite.send();
      results.push({ row, email: e.email, ok: true, inviteLink: invite.link });
    } catch (err) {
      results.push({ row, email: e.email, ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  }
  const created = results.filter((r) => r.ok).length;
  await audit(req, { action: 'employee.bulk_invited', entityType: 'User', summary: `Bulk invite: ${created} created, ${results.length - created} failed` });
  res.json({ created, failed: results.length - created, results });
});

employeesRouter.put('/:id', requirePermission(EMPLOYEES_MANAGE), async (req, res) => {
  const actor = req.user!;
  const before = await findInScope(actor, param(req, 'id'));
  assertWithinOwnPermissions(actor, before.profile.permissions, 'edit an employee');
  const input = parse(updateEmployeeSchema, req.body);
  if (input.profileId && input.profileId !== before.profileId) {
    if (before.id === actor.id) throw forbidden('You cannot change your own permission profile.', 'SELF_PROFILE_CHANGE');
    await assertProfileAssignable(actor, input.profileId);
  }
  await assertNoManagerCycle(before.id, input.managerId);
  if (input.email && input.email !== before.email && (await prisma.user.findUnique({ where: { email: input.email } }))) {
    throw new AppError(409, 'EMAIL_EXISTS', 'Another employee already uses this email');
  }
  const updated = await prisma.user.update({
    where: { id: before.id },
    data: { ...userData(input), ...(input.employeeCode ? { employeeCode: input.employeeCode } : {}) },
  });
  const { passwordHash: _a, ...safeBefore } = before;
  const { passwordHash: _b, ...safeAfter } = updated;
  await audit(req, { action: 'employee.updated', entityType: 'User', entityId: updated.id, summary: `Updated ${updated.email}`, before: safeBefore, after: safeAfter });
  res.json({ id: updated.id });
});

employeesRouter.post('/:id/status', requirePermission(EMPLOYEES_MANAGE), async (req: Request, res) => {
  const actor = req.user!;
  const { action, reason } = parse(employeeStatusActionSchema, req.body);
  const user = await findInScope(actor, param(req, 'id'));
  assertWithinOwnPermissions(actor, user.profile.permissions, 'change the status of an employee');
  if (user.id === actor.id) throw forbidden('You cannot change your own account status.', 'SELF_STATUS_CHANGE');

  const transitions: Record<typeof action, { from: string[]; to?: 'ACTIVE' | 'SUSPENDED' | 'EXITED' | 'INVITED' }> = {
    APPROVE: { from: ['PENDING'], to: 'ACTIVE' },
    REJECT: { from: ['PENDING'] },
    SUSPEND: { from: ['ACTIVE', 'INVITED'], to: 'SUSPENDED' },
    REACTIVATE: { from: ['SUSPENDED', 'EXITED'], to: user.passwordHash ? 'ACTIVE' : 'INVITED' },
    EXIT: { from: ['ACTIVE', 'SUSPENDED', 'INVITED'], to: 'EXITED' },
  };
  const t = transitions[action];
  if (!t.from.includes(user.status)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot ${action.toLowerCase()} an employee who is ${user.status.toLowerCase()}`);
  }

  await prisma.$transaction(async (tx) => {
    if (action === 'REJECT') {
      // A rejected sign-up never had access; remove it so the person can be invited properly later.
      await tx.user.delete({ where: { id: user.id } });
    } else {
      await tx.user.update({ where: { id: user.id }, data: { status: t.to } });
      if (t.to === 'SUSPENDED' || t.to === 'EXITED') {
        await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: action } });
      }
      if (action === 'APPROVE') {
        await notify(tx, [user.id], 'Access approved', 'Your account has been approved. Welcome aboard!', '/');
      }
    }
    await audit(req, { action: `employee.${action.toLowerCase()}`, entityType: 'User', entityId: user.id, summary: `${action} ${user.email}${reason ? `: ${reason}` : ''}`, before: { status: user.status }, after: { status: t.to ?? 'DELETED' } }, tx);
  });
  if (action === 'APPROVE') {
    const { name } = await getCompanySettings();
    await sendEmail(actionEmail({
      to: user.email,
      subject: `Your ${name} account is approved`,
      heading: `Hi ${user.firstName}, you're in!`,
      body: 'HR has approved your account. You can now sign in and start marking attendance.',
      actionLabel: 'Sign in',
      actionUrl: `${env.APP_URL}/login`,
    }));
  }
  res.json({ ok: true });
});

employeesRouter.post('/:id/resend-invite', requirePermission(EMPLOYEES_MANAGE), async (req, res) => {
  const user = await findInScope(req.user!, param(req, 'id'));
  if (user.status !== 'INVITED') throw new AppError(409, 'NOT_INVITED', 'This employee has already set up their account');
  const invite = await sendInvite(user);
  const emailed = await invite.send();
  await audit(req, { action: 'employee.invite_resent', entityType: 'User', entityId: user.id, summary: `Resent invite to ${user.email}` });
  res.json({ inviteLink: invite.link, emailed });
});

employeesRouter.post('/:id/reset-devices', requirePermission(EMPLOYEES_MANAGE, SECURITY_MANAGE), async (req, res) => {
  const user = await findInScope(req.user!, param(req, 'id'));
  const { count } = await prisma.device.deleteMany({ where: { userId: user.id } });
  await audit(req, { action: 'employee.devices_reset', entityType: 'User', entityId: user.id, summary: `Reset ${count} registered device(s) for ${user.email}` });
  res.json({ removed: count });
});

employeesRouter.post('/:id/force-logout', requirePermission(EMPLOYEES_MANAGE, SECURITY_MANAGE), async (req, res) => {
  const user = await findInScope(req.user!, param(req, 'id'));
  assertWithinOwnPermissions(req.user!, user.profile.permissions, 'sign out an employee');
  const { count } = await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'FORCE_LOGOUT' },
  });
  await audit(req, { action: 'employee.force_logout', entityType: 'User', entityId: user.id, summary: `Signed out ${count} session(s) for ${user.email}` });
  res.json({ revoked: count });
});

employeesRouter.put('/:id/restriction-override', requirePermission(SECURITY_MANAGE), async (req, res) => {
  const user = await findInScope(req.user!, param(req, 'id'));
  const { settings, reason } = parse(restrictionOverrideSchema, req.body);
  const clean = settings && Object.keys(settings).length > 0 ? settings : null;
  await prisma.user.update({
    where: { id: user.id },
    data: { restrictionOverride: clean ?? Prisma.DbNull, restrictionOverrideReason: clean ? (reason ?? null) : null },
  });
  await audit(req, { action: 'employee.restriction_override', entityType: 'User', entityId: user.id, summary: clean ? `Set restriction override for ${user.email}` : `Removed restriction override for ${user.email}`, before: user.restrictionOverride, after: clean });
  res.json({ ok: true });
});
