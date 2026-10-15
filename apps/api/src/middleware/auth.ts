import type { NextFunction, Request, Response } from 'express';
import type { Permission, ProfileScope } from '@app/shared';
import { forbidden, unauthorized } from '../lib/errors';
import { getClientIp, ipMatches } from '../lib/ip';
import { verifyAccessToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { getCompanySettings } from '../lib/settings';
import type { AuthUser } from '../types/express';

/** Verifies the bearer token AND that the session + account are still valid (suspension is immediate). */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();
  const claims = await verifyAccessToken(token);
  if (!claims) throw unauthorized('Your session has expired', 'TOKEN_EXPIRED');

  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    include: {
      user: {
        include: {
          profile: true,
          _count: { select: { reports: { where: { status: 'ACTIVE' } } } },
        },
      },
    },
  });
  if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt < new Date()) {
    throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_REVOKED');
  }
  const u = session.user;
  if (u.status !== 'ACTIVE') throw unauthorized('Your account is not active. Contact HR.', 'ACCOUNT_INACTIVE');

  req.user = toAuthUser(u, session.id);
  next();
}

export function toAuthUser(
  u: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    email: string;
    hrScopeBusinessUnitIds: string[];
    hrScopeLocationIds: string[];
    profile: { name: string; permissions: string[]; scope: ProfileScope };
    _count: { reports: number };
  },
  sessionId: string,
): AuthUser {
  return {
    id: u.id,
    sessionId,
    employeeCode: u.employeeCode,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    permissions: u.profile.permissions as Permission[],
    scope: u.profile.scope,
    profileName: u.profile.name,
    hrScopeBusinessUnitIds: u.hrScopeBusinessUnitIds,
    hrScopeLocationIds: u.hrScopeLocationIds,
    hasReports: u._count.reports > 0,
  };
}

export const hasPermission = (user: AuthUser | undefined, p: Permission) => !!user?.permissions.includes(p);

export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!perms.some((p) => hasPermission(req.user, p))) throw forbidden();
    next();
  };
}

/** Managers (anyone with reports) and anyone holding at least one admin permission. */
export const canAccessDashboard = (user: AuthUser) => user.hasReports || user.permissions.length > 0;

/** Guards every dashboard route: dashboard access + optional IP allowlist set by HR. */
export async function requireDashboard(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || !canAccessDashboard(req.user)) throw forbidden();
  const { security } = await getCompanySettings();
  if (security.dashboardIpAllowlist.length > 0 && !ipMatches(getClientIp(req), security.dashboardIpAllowlist)) {
    throw forbidden('The dashboard can only be opened from the office network.', 'DASHBOARD_IP_BLOCKED');
  }
  next();
}
