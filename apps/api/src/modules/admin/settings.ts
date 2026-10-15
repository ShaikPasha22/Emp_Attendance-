import { Router } from 'express';
import {
  attendanceRestrictionsSchema,
  PERMISSIONS,
  permissionProfileSchema,
  REQUEST_TYPES,
  requestTypeSchema,
  securitySettingsSchema,
  workflowSchema,
} from '@app/shared';
import { z } from 'zod';
import { invalidatePolicies } from '../../engine/context';
import { audit } from '../../lib/audit';
import { fullName } from '../../lib/employees';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { getClientIp, ipMatches } from '../../lib/ip';
import { prisma } from '../../lib/prisma';
import { getCompanySettings, invalidateCompanySettings } from '../../lib/settings';
import { isValidTimezone } from '../../lib/time';
import { param, parse } from '../../lib/validate';
import { requirePermission } from '../../middleware/auth';
import { DEFAULT_LEVELS } from '../requests/service';

const { SETTINGS_MANAGE, SECURITY_MANAGE, PROFILES_MANAGE, EMPLOYEES_VIEW, EMPLOYEES_MANAGE, ATTENDANCE_VIEW, REPORTS_VIEW, REQUESTS_APPROVE_HR } = PERMISSIONS;

export const settingsRouter = Router();

// ---------- Company profile ----------
settingsRouter.get('/company', requirePermission(SETTINGS_MANAGE, SECURITY_MANAGE), async (_req, res) => {
  const { name, timezone } = await getCompanySettings();
  res.json({ name, timezone });
});

settingsRouter.put('/company', requirePermission(SETTINGS_MANAGE), async (req, res) => {
  const input = parse(z.object({ name: z.string().trim().min(1).max(100), timezone: z.string().trim().min(1).max(60) }), req.body);
  if (!isValidTimezone(input.timezone)) throw badRequest(`Unknown timezone "${input.timezone}"`);
  const before = await getCompanySettings();
  await prisma.company.update({ where: { id: 'company' }, data: input });
  invalidateCompanySettings();
  invalidatePolicies();
  await audit(req, { action: 'company.updated', entityType: 'Company', entityId: 'company', summary: 'Updated company profile', before: { name: before.name, timezone: before.timezone }, after: input });
  res.json(input);
});

// ---------- Restrictions Center: login & account ----------
/** The caller's IP as the server sees it (helps HR build allowlists without locking themselves out). */
settingsRouter.get('/my-ip', requirePermission(SECURITY_MANAGE), (req, res) => {
  res.json({ ip: getClientIp(req) });
});

settingsRouter.get('/security', requirePermission(SECURITY_MANAGE), async (_req, res) => {
  res.json((await getCompanySettings()).security);
});

settingsRouter.put('/security', requirePermission(SECURITY_MANAGE), async (req, res) => {
  const input = parse(securitySettingsSchema, req.body);
  // Safety net: never let an admin lock themselves out of the dashboard.
  if (input.dashboardIpAllowlist.length > 0 && !ipMatches(getClientIp(req), input.dashboardIpAllowlist)) {
    throw new AppError(
      422,
      'WOULD_LOCK_OUT',
      `Your current IP (${getClientIp(req)}) is not in the allowlist. Add it first, or you would lock yourself out.`,
    );
  }
  const before = (await getCompanySettings()).security;
  await prisma.company.update({ where: { id: 'company' }, data: { security: input } });
  invalidateCompanySettings();
  await audit(req, { action: 'security.updated', entityType: 'Company', entityId: 'company', summary: 'Updated login & account restrictions', before, after: input });
  res.json(input);
});

// ---------- Restrictions Center: company-default attendance restrictions ----------
settingsRouter.get('/attendance-restrictions', requirePermission(SECURITY_MANAGE), async (_req, res) => {
  res.json((await getCompanySettings()).attendanceRestrictions);
});

settingsRouter.put('/attendance-restrictions', requirePermission(SECURITY_MANAGE), async (req, res) => {
  const input = parse(attendanceRestrictionsSchema, req.body);
  const before = (await getCompanySettings()).attendanceRestrictions;
  await prisma.company.update({ where: { id: 'company' }, data: { attendanceRestrictions: input } });
  invalidateCompanySettings();
  invalidatePolicies();
  await audit(req, { action: 'restrictions.updated', entityType: 'Company', entityId: 'company', summary: 'Updated default attendance restrictions', before, after: input });
  res.json(input);
});

// ---------- Workflows ----------
settingsRouter.get('/workflows', requirePermission(SETTINGS_MANAGE, REQUESTS_APPROVE_HR), async (_req, res) => {
  const rows = await prisma.workflowDefinition.findMany();
  res.json(
    REQUEST_TYPES.map((type) => {
      const row = rows.find((r) => r.requestType === type);
      return { requestType: type, levels: row?.levels ?? DEFAULT_LEVELS, escalationDays: row?.escalationDays ?? null };
    }),
  );
});

settingsRouter.put('/workflows/:type', requirePermission(SETTINGS_MANAGE), async (req, res) => {
  const type = parse(requestTypeSchema, param(req, 'type'));
  const input = parse(workflowSchema, req.body);
  const before = await prisma.workflowDefinition.findUnique({ where: { requestType: type } });
  const row = await prisma.workflowDefinition.upsert({
    where: { requestType: type },
    create: { requestType: type, levels: input.levels, escalationDays: input.escalationDays ?? null },
    update: { levels: input.levels, escalationDays: input.escalationDays ?? null },
  });
  await audit(req, { action: 'workflow.updated', entityType: 'WorkflowDefinition', entityId: row.id, summary: `Updated ${type} workflow`, before, after: row });
  res.json({ requestType: type, levels: row.levels, escalationDays: row.escalationDays });
});

// ---------- Permission profiles ----------
settingsRouter.get('/profiles', requirePermission(EMPLOYEES_VIEW, PROFILES_MANAGE), async (_req, res) => {
  res.json(await prisma.permissionProfile.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } }));
});

settingsRouter.post('/profiles', requirePermission(PROFILES_MANAGE), async (req, res) => {
  const input = parse(permissionProfileSchema, req.body);
  const row = await prisma.permissionProfile.create({ data: input });
  await audit(req, { action: 'profile.created', entityType: 'PermissionProfile', entityId: row.id, summary: `Created profile ${row.name}`, after: row });
  res.status(201).json(row);
});

settingsRouter.put('/profiles/:id', requirePermission(PROFILES_MANAGE), async (req, res) => {
  const before = await prisma.permissionProfile.findUnique({ where: { id: param(req, 'id') } });
  if (!before) throw notFound('Profile');
  if (before.isSystem) throw new AppError(409, 'SYSTEM_PROFILE', 'Built-in profiles cannot be edited. Create a custom profile instead.');
  const input = parse(permissionProfileSchema, req.body);
  const row = await prisma.permissionProfile.update({ where: { id: before.id }, data: input });
  await audit(req, { action: 'profile.updated', entityType: 'PermissionProfile', entityId: row.id, summary: `Updated profile ${row.name}`, before, after: row });
  res.json(row);
});

settingsRouter.delete('/profiles/:id', requirePermission(PROFILES_MANAGE), async (req, res) => {
  const before = await prisma.permissionProfile.findUnique({ where: { id: param(req, 'id') }, include: { _count: { select: { users: true } } } });
  if (!before) throw notFound('Profile');
  if (before.isSystem) throw new AppError(409, 'SYSTEM_PROFILE', 'Built-in profiles cannot be deleted.');
  if (before._count.users > 0) throw new AppError(409, 'IN_USE', `This profile is assigned to ${before._count.users} employees.`);
  await prisma.permissionProfile.delete({ where: { id: before.id } });
  await audit(req, { action: 'profile.deleted', entityType: 'PermissionProfile', entityId: before.id, summary: `Deleted profile ${before.name}`, before });
  res.status(204).end();
});

// ---------- Lookups: every dropdown option in one round-trip ----------
settingsRouter.get(
  '/lookups',
  requirePermission(EMPLOYEES_VIEW, EMPLOYEES_MANAGE, SETTINGS_MANAGE, SECURITY_MANAGE, ATTENDANCE_VIEW, REPORTS_VIEW),
  async (_req, res) => {
    const select = { id: true, name: true, isActive: true };
    const [businessUnits, departments, designations, grades, locations, shifts, profiles, managers] = await Promise.all([
      prisma.businessUnit.findMany({ select, orderBy: { name: 'asc' } }),
      prisma.department.findMany({ select, orderBy: { name: 'asc' } }),
      prisma.designation.findMany({ select, orderBy: { name: 'asc' } }),
      prisma.grade.findMany({ select, orderBy: { name: 'asc' } }),
      prisma.location.findMany({ select, orderBy: { name: 'asc' } }),
      prisma.shift.findMany({ select, orderBy: { name: 'asc' } }),
      prisma.permissionProfile.findMany({ select: { id: true, name: true, scope: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, employeeCode: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 2000,
      }),
    ]);
    res.json({
      businessUnits,
      departments,
      designations,
      grades,
      locations,
      shifts,
      profiles,
      employees: managers.map((m) => ({ id: m.id, name: `${fullName(m)} (${m.employeeCode})` })),
    });
  },
);
