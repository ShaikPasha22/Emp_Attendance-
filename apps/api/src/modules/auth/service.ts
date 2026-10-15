import type { Request, Response } from 'express';
import { checkPassword, PERMISSIONS, type LoginResponse, type PasswordRules } from '@app/shared';
import { env } from '../../config/env';
import { audit } from '../../lib/audit';
import { burnPasswordCheck, hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { actionEmail, sendEmail } from '../../lib/email';
import { fullName, nextEmployeeCode, notify, toSessionUser, usersWithPermission, withCodeRetry } from '../../lib/employees';
import { AppError, badRequest, forbidden, unauthorized } from '../../lib/errors';
import { getClientIp } from '../../lib/ip';
import { signAccessToken } from '../../lib/jwt';
import { prisma, type Tx } from '../../lib/prisma';
import { getCompanySettings } from '../../lib/settings';
import { toAuthUser } from '../../middleware/auth';

export const REFRESH_COOKIE = 'rt';
const COOKIE_PATH = '/api/v1/auth';
/** Window in which a just-rotated refresh token is treated as a benign race (two tabs) rather than theft. */
const ROTATION_GRACE_MS = 30_000;

const userInclude = {
  profile: true,
  _count: { select: { reports: { where: { status: 'ACTIVE' as const } } } },
};

function setRefreshCookie(res: Response, token: string, days: number) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: days * 86_400_000,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.isProd, sameSite: 'lax', path: COOKIE_PATH });
}

export function assertPassword(password: string, rules: PasswordRules) {
  const result = checkPassword(password, rules);
  if (!result.ok) {
    const failed = result.checks.filter((c) => !c.ok).map((c) => c.label);
    throw new AppError(422, 'WEAK_PASSWORD', `Password must meet: ${failed.join(', ') || 'max 128 characters'}`);
  }
}

/** Creates a session, enforces the concurrent-session limit and returns the login payload. */
async function startSession(req: Request, res: Response, userId: string): Promise<LoginResponse> {
  const { security } = await getCompanySettings();
  const token = randomToken();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      userAgent: req.header('user-agent')?.slice(0, 300),
      ip: getClientIp(req),
      expiresAt: new Date(Date.now() + security.appSessionDays * 86_400_000),
    },
  });

  if (security.maxConcurrentSessions > 0) {
    const active = await prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: { id: true },
    });
    const excess = active.slice(security.maxConcurrentSessions).map((s) => s.id);
    if (excess.length) {
      await prisma.session.updateMany({
        where: { id: { in: excess } },
        data: { revokedAt: new Date(), revokedReason: 'SESSION_LIMIT' },
      });
    }
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
    include: userInclude,
  });
  setRefreshCookie(res, token, security.appSessionDays);
  const authUser = toAuthUser(user, session.id);
  return { accessToken: await signAccessToken({ sub: userId, sid: session.id }), user: await toSessionUser(authUser) };
}

export async function login(req: Request, res: Response, email: string, password: string): Promise<LoginResponse> {
  const { security } = await getCompanySettings();
  const ip = getClientIp(req);

  // Account lockout: failed attempts since the last success, inside the lockout window.
  const windowStart = new Date(Date.now() - security.lockoutMinutes * 60_000);
  const lastSuccess = await prisma.loginAttempt.findFirst({
    where: { email, success: true, createdAt: { gt: windowStart } },
    orderBy: { createdAt: 'desc' },
  });
  const failures = await prisma.loginAttempt.findMany({
    where: { email, success: false, createdAt: { gt: lastSuccess?.createdAt ?? windowStart } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  if (failures.length >= security.lockoutMaxAttempts) {
    const unlockAt = failures[failures.length - security.lockoutMaxAttempts]!.createdAt.getTime() + security.lockoutMinutes * 60_000;
    const minutes = Math.max(1, Math.ceil((unlockAt - Date.now()) / 60_000));
    throw new AppError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(user.passwordHash, password) : (await burnPasswordCheck(password), false);
  if (!user || !valid) {
    await prisma.loginAttempt.create({ data: { email, ip, success: false } });
    const left = security.lockoutMaxAttempts - failures.length - 1;
    if (left <= 0) {
      throw new AppError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Your account is locked for ${security.lockoutMinutes} minutes.`);
    }
    throw unauthorized(
      left > 0 && left <= 2
        ? `Incorrect email or password. ${left} attempt${left > 1 ? 's' : ''} left before your account is locked.`
        : 'Incorrect email or password.',
      'INVALID_CREDENTIALS',
    );
  }

  const statusMessages: Record<string, string> = {
    PENDING: 'Your account is awaiting HR approval. You will be able to sign in once approved.',
    INVITED: 'Please use the link in your invitation email to set your password first.',
    SUSPENDED: 'Your account has been suspended. Please contact HR.',
    EXITED: 'Your account is no longer active.',
  };
  if (user.status !== 'ACTIVE') throw forbidden(statusMessages[user.status], `ACCOUNT_${user.status}`);

  await prisma.loginAttempt.create({ data: { email, ip, success: true } });
  return startSession(req, res, user.id);
}

export async function refresh(req: Request, res: Response): Promise<LoginResponse> {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw unauthorized('Please sign in', 'NO_SESSION');
  const hash = sha256(token);

  const session = await prisma.session.findUnique({ where: { tokenHash: hash } });
  if (!session) {
    const previous = await prisma.session.findUnique({ where: { previousTokenHash: hash } });
    if (previous && !previous.revokedAt) {
      if (previous.rotatedAt && Date.now() - previous.rotatedAt.getTime() < ROTATION_GRACE_MS) {
        // Another tab refreshed a moment ago; the browser already holds the new cookie.
        throw unauthorized('Session refreshed elsewhere, retry', 'REFRESH_RACE');
      }
      // An old token was replayed: treat as theft and end this session.
      await prisma.session.update({
        where: { id: previous.id },
        data: { revokedAt: new Date(), revokedReason: 'TOKEN_REUSE' },
      });
    }
    clearRefreshCookie(res);
    throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_REVOKED');
  }
  if (session.revokedAt || session.expiresAt < new Date()) {
    clearRefreshCookie(res);
    throw unauthorized('Your session has ended. Please sign in again.', 'SESSION_REVOKED');
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId }, include: userInclude });
  if (!user || user.status !== 'ACTIVE') {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: 'ACCOUNT_INACTIVE' } });
    clearRefreshCookie(res);
    throw unauthorized('Your account is not active. Contact HR.', 'ACCOUNT_INACTIVE');
  }

  const { security } = await getCompanySettings();
  const next = randomToken();
  await prisma.session.update({
    where: { id: session.id },
    data: {
      tokenHash: sha256(next),
      previousTokenHash: hash,
      rotatedAt: new Date(),
      lastUsedAt: new Date(),
      ip: getClientIp(req),
      expiresAt: new Date(Date.now() + security.appSessionDays * 86_400_000),
    },
  });
  setRefreshCookie(res, next, security.appSessionDays);
  return {
    accessToken: await signAccessToken({ sub: user.id, sid: session.id }),
    user: await toSessionUser(toAuthUser(user, session.id)),
  };
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
    });
  }
  clearRefreshCookie(res);
}

export async function signup(
  req: Request,
  input: { firstName: string; lastName: string; email: string; phone?: string; password: string },
) {
  const { security } = await getCompanySettings();
  if (security.signupMode !== 'INVITE_AND_SIGNUP') {
    throw forbidden('Self sign-up is disabled. Please ask HR to invite you.', 'SIGNUP_DISABLED');
  }
  const domain = input.email.split('@')[1] ?? '';
  if (security.allowedEmailDomains.length > 0 && !security.allowedEmailDomains.includes(domain)) {
    throw forbidden(`Please use your work email (${security.allowedEmailDomains.join(', ')}).`, 'DOMAIN_NOT_ALLOWED');
  }
  assertPassword(input.password, security);
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists. Try signing in or resetting your password.');
  }
  const profile = await prisma.permissionProfile.findFirstOrThrow({ where: { name: 'Employee' } });
  const passwordHash = await hashPassword(input.password);

  const user = await withCodeRetry(() =>
    prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          employeeCode: await nextEmployeeCode(tx),
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone || null,
          passwordHash,
          status: 'PENDING',
          profileId: profile.id,
        },
      });
      const hr = await usersWithPermission(PERMISSIONS.EMPLOYEES_MANAGE, tx);
      await notify(
        tx,
        hr.map((h) => h.id),
        'New access request',
        `${fullName(created)} (${created.email}) signed up and is waiting for approval.`,
        `/admin/employees/${created.id}`,
      );
      await audit(req, { action: 'user.signup', entityType: 'User', entityId: created.id, summary: `${created.email} signed up` }, tx);
      return created;
    }),
  );
  return { id: user.id };
}

export async function createUserToken(tx: Tx, userId: string, type: 'INVITE' | 'PASSWORD_RESET', ttlHours: number) {
  const token = randomToken();
  await tx.userToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  await tx.userToken.create({
    data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlHours * 3_600_000) },
  });
  return token;
}

async function consumeToken(token: string, type: 'INVITE' | 'PASSWORD_RESET') {
  const row = await prisma.userToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) {
    throw badRequest(
      type === 'INVITE'
        ? 'This invitation link is invalid or has expired. Ask HR to resend it.'
        : 'This reset link is invalid or has expired. Please request a new one.',
      'INVALID_TOKEN',
    );
  }
  return row;
}

export async function inviteInfo(token: string) {
  const row = await consumeToken(token, 'INVITE');
  return { firstName: row.user.firstName, email: row.user.email };
}

export async function acceptInvite(req: Request, res: Response, token: string, password: string) {
  const { security } = await getCompanySettings();
  const row = await consumeToken(token, 'INVITE');
  if (row.user.status !== 'INVITED' && row.user.status !== 'ACTIVE') {
    throw forbidden('Your account is not active. Please contact HR.', 'ACCOUNT_INACTIVE');
  }
  assertPassword(password, security);
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash, status: 'ACTIVE' } }),
    prisma.userToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
  await audit(req, { action: 'user.invite_accepted', entityType: 'User', entityId: row.userId, summary: `${row.user.email} accepted invite` });
  return startSession(req, res, row.userId);
}

export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') return; // never reveal whether the account exists
  const token = await createUserToken(prisma, user.id, 'PASSWORD_RESET', 1);
  await sendEmail(
    actionEmail({
      to: user.email,
      subject: 'Reset your password',
      heading: `Hi ${user.firstName}, reset your password`,
      body: 'We received a request to reset your password. This link is valid for 1 hour. If you did not request this, you can ignore this email.',
      actionLabel: 'Reset password',
      actionUrl: `${env.APP_URL}/reset-password?token=${token}`,
    }),
  );
}

export async function resetPassword(req: Request, token: string, password: string) {
  const { security } = await getCompanySettings();
  const row = await consumeToken(token, 'PASSWORD_RESET');
  assertPassword(password, security);
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    prisma.userToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' } }),
  ]);
  await audit(req, { action: 'user.password_reset', entityType: 'User', entityId: row.userId, summary: 'Password reset via email link' });
}

export async function changePassword(req: Request, currentPassword: string, newPassword: string) {
  const { security } = await getCompanySettings();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError(422, 'WRONG_PASSWORD', 'Your current password is incorrect.');
  }
  assertPassword(newPassword, security);
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    // Sign out every other device.
    prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: req.user!.sessionId } },
      data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
    }),
  ]);
  await audit(req, { action: 'user.password_changed', entityType: 'User', entityId: user.id, summary: 'Changed own password' });
}
