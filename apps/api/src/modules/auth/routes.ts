import { Router } from 'express';
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from '@app/shared';
import { getCompanySettings } from '../../lib/settings';
import { param, parse } from '../../lib/validate';
import { authenticate } from '../../middleware/auth';
import { authLimiter, requireSameOrigin } from '../../middleware/security';
import * as auth from './service';

export const authRouter = Router();

/** Public settings needed by the sign-in / sign-up screens. */
authRouter.get('/config', async (_req, res) => {
  const { name, security } = await getCompanySettings();
  res.json({
    companyName: name,
    signupEnabled: security.signupMode === 'INVITE_AND_SIGNUP',
    allowedEmailDomains: security.allowedEmailDomains,
    passwordRules: {
      passwordMinLength: security.passwordMinLength,
      passwordRequireNumber: security.passwordRequireNumber,
      passwordRequireUppercase: security.passwordRequireUppercase,
      passwordRequireSymbol: security.passwordRequireSymbol,
    },
  });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  res.json(await auth.login(req, res, email, password));
});

authRouter.post('/refresh', requireSameOrigin, async (req, res) => {
  res.json(await auth.refresh(req, res));
});

authRouter.post('/logout', requireSameOrigin, async (req, res) => {
  await auth.logout(req, res);
  res.status(204).end();
});

authRouter.post('/signup', authLimiter, async (req, res) => {
  const input = parse(signupSchema, req.body);
  await auth.signup(req, input);
  res.status(201).json({ message: 'Thanks! Your request has been sent to HR. You can sign in once it is approved.' });
});

authRouter.get('/invite/:token', authLimiter, async (req, res) => {
  res.json(await auth.inviteInfo(param(req, 'token')));
});

authRouter.post('/accept-invite', authLimiter, async (req, res) => {
  const { token, password } = parse(acceptInviteSchema, req.body);
  res.json(await auth.acceptInvite(req, res, token, password));
});

authRouter.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = parse(forgotPasswordSchema, req.body);
  await auth.forgotPassword(email);
  res.json({ message: 'If an active account exists for this email, a reset link has been sent.' });
});

authRouter.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = parse(resetPasswordSchema, req.body);
  await auth.resetPassword(req, token, password);
  res.json({ message: 'Your password has been reset. Please sign in.' });
});

authRouter.post('/change-password', authenticate, authLimiter, async (req, res) => {
  const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
  await auth.changePassword(req, currentPassword, newPassword);
  res.json({ message: 'Password changed. Other devices have been signed out.' });
});
