import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { forbidden } from '../lib/errors';
import { getClientIp } from '../lib/ip';

const handler = (_req: Request, res: Response) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a moment and try again.' } });

const base = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  keyGenerator: (req: Request) => getClientIp(req),
  handler,
  skip: () => env.isTest,
};

/** Login, sign-up, password reset: 20 per 15 minutes per IP (account lockout adds a per-account limit). */
export const authLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 20 });

/** Clock-in / clock-out: 300 per 5 minutes per IP (a whole office shares one IP, so keep this generous). */
export const punchLimiter = rateLimit({ ...base, windowMs: 5 * 60_000, limit: 300 });

/** General API: 600 requests per minute per IP. */
export const apiLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 600 });

/**
 * CSRF defence for cookie-authenticated endpoints (refresh / logout): the request must come from
 * our own origin. Combined with SameSite cookies this blocks cross-site requests.
 */
export function requireSameOrigin(req: Request, _res: Response, next: NextFunction) {
  const origin = req.header('origin');
  const site = req.header('sec-fetch-site');
  if (site && !['same-origin', 'same-site', 'none'].includes(site)) throw forbidden('Cross-site request blocked', 'CSRF');
  if (origin) {
    const allowed = new Set([new URL(env.APP_URL).origin, ...env.CORS_ORIGINS]);
    const self = `${req.protocol}://${req.get('host')}`;
    if (!allowed.has(origin) && origin !== self) throw forbidden('Cross-site request blocked', 'CSRF');
  }
  next();
}
