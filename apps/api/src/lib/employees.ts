import { Prisma } from '@prisma/client';
import type { SessionUser } from '@app/shared';
import { canAccessDashboard } from '../middleware/auth';
import type { AuthUser } from '../types/express';
import { prisma, type Tx } from './prisma';
import { getCompanySettings } from './settings';

export const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();

/** Next free employee code like EMP0042. */
export async function nextEmployeeCode(tx: Tx = prisma): Promise<string> {
  const rows = await tx.$queryRaw<{ max: number | null }[]>(
    Prisma.sql`SELECT MAX(CAST(SUBSTRING("employeeCode" FROM 4) AS INTEGER)) AS max FROM "User" WHERE "employeeCode" ~ '^EMP[0-9]+$'`,
  );
  const next = (rows[0]?.max ?? 0) + 1;
  return `EMP${String(next).padStart(4, '0')}`;
}

/** Retries an insert when two requests race for the same generated employee code. */
export async function withCodeRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const isCodeClash =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        JSON.stringify(err.meta?.target ?? '').includes('employeeCode');
      if (!isCodeClash || i >= attempts - 1) throw err;
    }
  }
}

export async function toSessionUser(user: AuthUser, status: SessionUser['status'] = 'ACTIVE'): Promise<SessionUser> {
  const { security } = await getCompanySettings();
  return {
    id: user.id,
    employeeCode: user.employeeCode,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    status,
    permissions: user.permissions,
    scope: user.scope,
    profileName: user.profileName,
    hasReports: user.hasReports,
    canAccessDashboard: canAccessDashboard(user),
    dashboardIdleMinutes: security.dashboardIdleMinutes,
  };
}

export async function notify(tx: Tx, userIds: string[], title: string, body: string, link?: string) {
  if (userIds.length === 0) return;
  await tx.notification.createMany({ data: [...new Set(userIds)].map((userId) => ({ userId, title, body, link })) });
}

/** Active users holding a permission (e.g. all HR approvers). */
export async function usersWithPermission(permission: string, tx: Tx = prisma) {
  return tx.user.findMany({
    where: { status: 'ACTIVE', profile: { permissions: { has: permission } } },
    select: { id: true, email: true, firstName: true, lastName: true, hrScopeBusinessUnitIds: true, hrScopeLocationIds: true, profile: { select: { scope: true } } },
  });
}
